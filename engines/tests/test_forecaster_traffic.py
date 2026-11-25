# SPDX-License-Identifier: AGPL-3.0-only
"""Forecaster traffic effect and a 30-day horizon, SYNTHETIC world."""
import copy
import math
import random
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from jsonschema import Draft202012Validator, FormatChecker

import test_forecaster_calendar_fields as C
import test_forecaster_v2 as T
from opendispatch_engines.forecaster import ensemble, handle, weather as W

TZ = timezone(timedelta(hours=3))
START = date(2026, 1, 5)
WEEKS = 30
H0 = WEEKS * 7
HORIZON = 30
HEAVY_LIFT = 1.25
CITY = str(uuid.UUID(int=0xF000))
ZID = [str(uuid.UUID(int=0xF100 + z)) for z in range(2)]
SUBS = [[str(uuid.UUID(int=0xF200 + z * 10 + k)) for k in range(2)] for z in range(2)]


def _index(i):
    """One city-day congestion; about 1 day in 6 is heavy."""
    rng = random.Random(f"tr-{i}")
    base = 1.0 + (0.08 if i % 7 in (0, 1, 2, 3) else -0.1)
    return round(base + (0.35 if rng.random() < 0.17 else rng.gauss(0, 0.04)), 2)


def _traffic(n):
    return [{"city_id": CITY, "date": (START + timedelta(days=i)).isoformat(),
             "congestion_index": _index(i), "source": "SYNTHETIC"} for i in range(n)]


def _lam(z, k, i, s):
    h = s / 4
    shape = 0.2 + 2.0 * math.exp(-((h - 9) ** 2) / 8) + 2.4 * math.exp(-((h - 17) ** 2) / 10)
    lift = HEAVY_LIFT if _index(i) >= W.TRAFFIC_HEAVY else 1.0
    return T.SCALES[k] * (1.0 + 0.2 * z) * shape * T.DOW[i % 7] * lift


def _rows(seed=7):
    rng = random.Random(seed)
    rows = []
    for i in range(H0):
        d = START + timedelta(days=i)
        for z in range(2):
            for k, sid in enumerate(SUBS[z]):
                for s in range(96):
                    n = T._poisson(rng, _lam(z, k, i, s))
                    ts = datetime(d.year, d.month, d.day, s // 4, s % 4 * 15, tzinfo=TZ).isoformat()
                    rows.append({"sub_zone_id": sid, "interval_start": ts, "cases_total": n, "cases_field": round(n * 0.6)})
    return rows


def _request(rows, traffic=True, days=HORIZON):
    cal = [{"date": (START + timedelta(days=i)).isoformat(), "is_holiday": False, "is_ramadan": False,
            "prayer_times": C.PT} for i in range(H0 + days)]
    req = {
        "schema_version": "1.0", "request_id": str(uuid.UUID(int=11)),
        "requested_at": "2026-08-01T02:00:00+03:00", "data_source": "SYNTHETIC", "input_data_sources": ["SYNTHETIC"],
        "horizon": {"start_date": (START + timedelta(days=H0)).isoformat(), "days": days},
        "model": {"model_version": "ensemble-4", "range_coverage": 0.8},
        "zones": [{"zone_id": ZID[z], "city_id": CITY, "sub_zones": [{"sub_zone_id": s} for s in SUBS[z]]} for z in range(2)],
        "calendar": cal, "history": {"records": rows},
    }
    if traffic:
        req["traffic"] = _traffic(H0 + days)
    return req


@pytest.fixture(scope="module")
def rows():
    return _rows()


@pytest.fixture(scope="module")
def runs(rows):
    with_t = handle(copy.deepcopy(_request(rows)))
    without = handle(copy.deepcopy(_request(rows, traffic=False)))
    return with_t, without


def test_schema_accepts_traffic_and_30_days(load, rows, runs):
    v_in = Draft202012Validator(load("forecaster.input.schema.json"), format_checker=FormatChecker())
    v_out = Draft202012Validator(load("forecaster.output.schema.json"), format_checker=FormatChecker())
    v_in.validate(_request(rows))
    for out in runs:
        v_out.validate(out)
        assert out["horizon"]["days"] == HORIZON
        assert len(out["values"]) == HORIZON * 96 * 4


def test_schema_refuses_31_days(load, rows):
    bad = _request(rows[:96], traffic=False, days=HORIZON)
    bad["horizon"]["days"] = 31
    assert not Draft202012Validator(load("forecaster.input.schema.json")).is_valid(bad)


def test_traffic_in_feature_set(runs):
    fs = runs[0]["model_info"]["feature_set"]
    assert "traffic" in fs and "traffic_heavy" in fs, fs
    assert "traffic" not in runs[1]["model_info"]["feature_set"]


def test_heavy_day_explained(runs):
    heavy = {(START + timedelta(days=i)).isoformat() for i in range(H0, H0 + HORIZON) if _index(i) >= W.TRAFFIC_HEAVY}
    assert heavy
    seen = []
    for e in runs[0]["explanations"]:
        for d in e["drivers"]:
            if d["driver"] == "traffic_heavy":
                seen.append((e["date"], d["multiplier"]))
    assert seen, "no traffic_heavy driver"
    assert {d for d, _ in seen} <= heavy
    est = sum(m for _, m in seen) / len(seen)
    print(f"SYNTHETIC heavy-traffic effect: true {HEAVY_LIFT:.2f}, explained mean {est:.3f}")
    assert abs(est / HEAVY_LIFT - 1) < 0.15


def test_traffic_lowers_horizon_error(runs):
    def err(values):
        day = {}
        for v in values:
            i = (date.fromisoformat(v["interval_start"][:10]) - START).days
            z = 0 if v["zone_id"] == ZID[0] else 1
            k = SUBS[z].index(v["sub_zone_id"])
            s = int(v["interval_start"][11:13]) * 4 + int(v["interval_start"][14:16]) // 15
            e = day.setdefault((z, i), [0.0, 0.0])
            e[0] += v["expected"]
            e[1] += _lam(z, k, i, s)
        return sum(abs(a - b) for a, b in day.values()) / sum(b for _, b in day.values())
    e1, e0 = err(runs[0]["values"]), err(runs[1]["values"])
    print(f"SYNTHETIC horizon zone-day error: with traffic {e1:.3f}, without {e0:.3f}")
    assert e1 < e0


def test_traffic_ignored_by_frozen_models(rows):
    req = _request(rows[: 8 * 7 * 96 * 4], traffic=True, days=7)
    req["horizon"]["start_date"] = (START + timedelta(days=56)).isoformat()
    req["calendar"] = req["calendar"][: 56 + 7]
    req["traffic"] = req["traffic"][: 56 + 7]
    a = ensemble.run(copy.deepcopy(req))
    assert a["values"]
    w = W.Weather(req)
    assert not w.active and "traffic_heavy" not in w.feats
