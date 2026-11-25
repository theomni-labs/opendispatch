# SPDX-License-Identifier: AGPL-3.0-only
"""Forecaster explanations: drivers per zone and day (ensemble-4).

SYNTHETIC data only; nothing here says anything about real accuracy.
"""
import copy
import math
from datetime import date

import pytest
from jsonschema import Draft202012Validator, FormatChecker

import test_forecaster_v2 as T
from opendispatch_engines.forecaster import ensemble, ensemble3, ensemble4, handle


@pytest.fixture(scope="module")
def world():
    req, _, _, event_day, _ = T._gen(seed=5, n_zones=3, horizon_days=7)
    return {"req": req, "out": handle(copy.deepcopy(req)), "events": event_day}


def _totals(out):
    tot = {}
    for v in out["values"]:
        k = (v["zone_id"], v["interval_start"][:10])
        tot[k] = tot.get(k, 0.0) + v["expected"]
    return tot


def test_valid_and_one_per_zone_day(load, world):
    out = world["out"]
    Draft202012Validator(load("forecaster.output.schema.json"), format_checker=FormatChecker()).validate(out)
    ex = out["explanations"]
    keys = {(e["zone_id"], e["date"]) for e in ex}
    assert len(keys) == len(ex) == 3 * 7
    assert keys == set(_totals(out))


def test_drivers_multiply_to_the_total(world):
    tot = _totals(world["out"])
    for e in world["out"]["explanations"]:
        names = [d["driver"] for d in e["drivers"]]
        assert names[:2] == ["weekday", "trend"] and names[-1] == "model_other"
        prod = e["base"] * math.prod(d["multiplier"] for d in e["drivers"])
        assert abs(prod - e["expected"]) <= 0.002 * e["expected"] + 0.01
        assert abs(e["expected"] - tot[(e["zone_id"], e["date"])]) < 0.01


def test_calendar_days_name_their_effect(world):
    req = world["req"]
    cal = {c["date"]: c for c in req["calendar"]}
    seen = set()
    for e in world["out"]["explanations"]:
        c = cal[e["date"]]
        names = {d["driver"] for d in e["drivers"]}
        if c.get("is_payday"):
            assert "payday" in names
            seen.add("payday")
        if c.get("is_holiday"):
            assert "holiday" in names
        if not c.get("is_payday"):
            assert "payday" not in names
    assert "payday" in seen
    days = {e["date"] for e in world["out"]["explanations"]}
    wd = {}
    for e in world["out"]["explanations"]:
        if e["zone_id"] == world["req"]["zones"][0]["zone_id"]:
            wd[date.fromisoformat(e["date"]).weekday()] = e["drivers"][0]["multiplier"]
    assert len(days) == 7 and max(wd.values()) > min(wd.values())


def test_unknown_calendar_value_is_marked():
    req, *_ = T._gen(seed=5, n_zones=2, horizon_days=3)
    start = req["horizon"]["start_date"]
    for c in req["calendar"]:
        if c["date"] >= start:
            c.pop("is_payday", None)
    out = handle(req)
    flagged = [d for e in out["explanations"] for d in e["drivers"] if d["driver"] == "payday"]
    assert flagged and all(d.get("unknown") for d in flagged)


def test_other_models_and_values_unchanged(world):
    req = copy.deepcopy(world["req"])
    a = ensemble4.run(copy.deepcopy(req))
    assert set(a) == {"values", "warnings", "info", "debug", "explanations"}
    assert "explanations" in ensemble.run(copy.deepcopy(req))
    assert a["values"] == world["out"]["values"]
    for v in ("ensemble-3", "ensemble-2", "seasonal-profile-1"):
        r = copy.deepcopy(req)
        r["model"]["model_version"] = v
        assert "explanations" not in handle(r)
    assert "explanations" not in ensemble3.run(copy.deepcopy(req))


def test_profile_fallback_has_none():
    req, *_ = T._gen(seed=5, n_zones=1, horizon_days=2, weeks=4)
    out = handle(req)
    assert "ENSEMBLE_FALLBACK" in [w["code"] for w in out["warnings"]]
    assert "explanations" not in out
