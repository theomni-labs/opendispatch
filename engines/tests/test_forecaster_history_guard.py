# SPDX-License-Identifier: AGPL-3.0-only
import copy
from datetime import datetime, timedelta, timezone

import pytest

from opendispatch_engines.forecaster import MODELS, handle
from opendispatch_engines.forecaster.guard import CODE, before_origin

from test_forecaster_engine import _split, _validate


def _codes(out):
    return [w["code"] for w in out.get("warnings", [])]


def _leaky(req, rows):
    # the clean request plus the held-out week
    bad = copy.deepcopy(req)
    start = req["horizon"]["start_date"]
    bad["history"]["records"] = req["history"]["records"] + [
        r for r in rows if r["interval_start"][:10] >= start]
    return bad


@pytest.mark.parametrize("version", sorted(MODELS))
def test_history_after_origin_is_ignored(load, version):
    req, _, rows, _ = _split(n_sub=2)
    req["model"]["model_version"] = version
    clean, leaky = handle(req), handle(_leaky(req, rows))
    _validate(load, leaky)
    assert CODE in _codes(leaky) and CODE not in _codes(clean)
    assert leaky["values"] == clean["values"]
    assert leaky["model_info"] == clean["model_info"]


def test_guard_uses_riyadh_date_and_aggregates():
    req, _, _, _ = _split(n_sub=1)
    start = req["horizon"]["start_date"]
    sid = req["zones"][0]["sub_zones"][0]["sub_zone_id"]
    day = datetime.fromisoformat(start).replace(tzinfo=timezone.utc)
    late_utc = (day - timedelta(hours=2)).isoformat()  # 01:00 +03:00 on start
    early_utc = (day - timedelta(hours=4)).isoformat()  # 23:00 +03:00 before
    req["history"]["records"] = [
        {"sub_zone_id": sid, "interval_start": late_utc, "cases_total": 5, "cases_field": 1},
        {"sub_zone_id": sid, "interval_start": early_utc, "cases_total": 5, "cases_field": 1}]
    req["history"]["aggregated_records"] = [
        {"sub_zone_id": sid, "period_start": start + "T00:00:00+03:00", "period_minutes": 1440,
         "cases_total": 9, "cases_field": 3},
        {"sub_zone_id": sid, "period_start": "2026-01-01T00:00:00+03:00", "period_minutes": 1440,
         "cases_total": 9, "cases_field": 3}]
    before = copy.deepcopy(req)
    out, warn = before_origin(req)
    assert req == before
    assert warn["code"] == CODE and warn["message"].startswith("2 ")
    assert [r["interval_start"] for r in out["history"]["records"]] == [early_utc]
    assert [r["period_start"][:10] for r in out["history"]["aggregated_records"]] == ["2026-01-01"]


def test_clean_history_passes_unchanged():
    req, *_ = _split(n_sub=1)
    out, warn = before_origin(req)
    assert out is req and warn is None


@pytest.mark.parametrize("version", sorted(MODELS))
def test_all_zero_day_does_not_crash(load, version):
    req, *_ = _split(n_sub=2)
    req["model"]["model_version"] = version
    day = req["history"]["records"][len(req["history"]["records"]) // 2]["interval_start"][:10]
    for r in req["history"]["records"]:
        if r["interval_start"][:10] == day:
            r["cases_total"] = r["cases_field"] = 0
    out = handle(req)
    _validate(load, out)
    assert sum(v["expected"] for v in out["values"]) > 0


def test_all_zero_history_is_no_history(load):
    req, *_ = _split(n_sub=1)
    for r in req["history"]["records"]:
        r["cases_total"] = r["cases_field"] = 0
    req["model"]["model_version"] = "seasonal-profile-1"
    out = handle(req)
    _validate(load, out)
    assert "NO_HISTORY" in _codes(out)
