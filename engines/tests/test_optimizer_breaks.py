# SPDX-License-Identifier: AGPL-3.0-only
import copy
from datetime import datetime, timedelta

import pytest

from opendispatch_engines.optimizer import cpsat, handle
from test_optimizer_cpsat import _small, _strict_rules
from test_optimizer_engine import DAY, _build, _check_hard_rules, _validate
from test_optimizer_reach import _validate_in

NEEDS_CP = pytest.mark.skipif(cpsat.load() is None, reason="ortools not installed")
MODELS = ["greedy-ls-0.3", pytest.param("cpsat-1", marks=NEEDS_CP)]


def _q(s):
    return (datetime.fromisoformat(s) - DAY) // timedelta(minutes=15)


def _breaks(out):
    on = [0] * 96
    for a in out["roster_assignments"]:
        if a["break_start_at"]:
            for t in range(_q(a["break_start_at"]), min(96, _q(a["break_end_at"]))):
                on[t] += 1
    return on


def _six_on_a(model, need=5, dip=()):
    """Six agents on A (06-14); need 5 then."""
    req = _small(6, 6)
    req["shift_patterns"] = req["shift_patterns"][:1]
    req["objective"]["model_version"] = model
    vals = [v for v in req["forecast"]["values"] if _q(v["interval_start"]) < 56]
    for v in vals:
        x = 0 if _q(v["interval_start"]) in dip else need
        for k in ("low", "expected", "high", "field_expected"):
            v[k] = x
    req["forecast"]["values"] = vals
    return req


@pytest.mark.parametrize("model", MODELS)
def test_breaks_staggered(load, model):
    req = _six_on_a(model)
    out = handle(req)
    _validate(load, out)
    _strict_rules(req, out)
    assert out["model_version"] == model
    assert len(out["roster_assignments"]) == 6
    assert max(_breaks(out)) == 1
    assert not any(c["delta"] < 0 for c in out["gap_cells"])
    assert out["break_cost"] == [{"zone_id": req["zone_ids"][0], "breaks": 6,
                                  "lost_agent_intervals": 0, "max_concurrent_breaks": 1}]


def _fixed_six(model):
    """Six fixed on A with need 1: breaks are free."""
    req = _six_on_a(model, need=1)
    pid = req["shift_patterns"][0]["shift_pattern_id"]
    req["fixed_assignments"] = [{"agent_id": x["agent_id"], "shift_pattern_id": pid,
                                 "zone_id": req["zone_ids"][0]} for x in req["agents"]]
    return req


@pytest.mark.parametrize("model", MODELS)
def test_surplus_breaks_staggered(load, model):
    old = handle(_fixed_six("greedy-ls-0.1"))
    out = handle(_fixed_six(model))
    _validate(load, out)
    assert len(out["roster_assignments"]) == 6
    assert out["break_cost"][0]["max_concurrent_breaks"] == 1
    assert old["break_cost"][0]["max_concurrent_breaks"] > 1
    print("fixed six: %s max at once 1, greedy-ls-0.1 %d"
          % (model, old["break_cost"][0]["max_concurrent_breaks"]))


@pytest.mark.parametrize("model", MODELS)
def test_break_goes_to_low_demand(load, model):
    req = _six_on_a(model, need=1, dip={40, 41})
    req["agents"] = req["agents"][:1]
    out = handle(req)
    _validate(load, out)
    a = out["roster_assignments"][0]
    assert _q(a["break_start_at"]) == 40
    assert not any(c["delta"] < 0 for c in out["gap_cells"])
    assert out["break_cost"][0]["lost_agent_intervals"] == 0


@pytest.mark.parametrize("model", MODELS)
def test_stagger_on_synthetic_zone(load, model):
    req = _build(zones=1, field=20, vehicles=20, remote=0, demand=0.6, leave=0)
    req["objective"]["model_version"] = model
    out = handle(req)
    _validate(load, out)
    _check_hard_rules(req, out)
    old = copy.deepcopy(req)
    old["objective"].pop("model_version")
    base = handle(old)
    bc, bc0 = out["break_cost"][0], base["break_cost"][0]
    assert bc["lost_agent_intervals"] <= bc0["lost_agent_intervals"]
    assert bc["max_concurrent_breaks"] <= bc0["max_concurrent_breaks"]
    assert bc["max_concurrent_breaks"] == max(_breaks(out))
    print("%s: break_cost %s; greedy-ls-0.1 %s" % (model, bc, bc0))


@pytest.mark.parametrize("model", ["greedy-ls-0.1", "greedy-ls-0.3",
                                   pytest.param("cpsat-1", marks=NEEDS_CP)])
@pytest.mark.parametrize("window,start", [(20, 54), (30, None), (None, None)])
def test_prayer_window_minutes(load, model, window, start):
    """M (10-18), asr 13:05, demand dips at 13:30-14:00."""
    req = _small(1, 1)
    req["shift_patterns"] = req["shift_patterns"][2:]
    req["objective"]["model_version"] = model
    req["prayer_times"]["asr"] = "13:05"
    if window:
        req["prayer_window_minutes"] = window
    for v in req["forecast"]["values"]:
        q = _q(v["interval_start"])
        x = 0 if q in (54, 55) or not 40 <= q < 72 else 1
        for k in ("low", "expected", "high", "field_expected"):
            v[k] = x
    _validate_in(load, req)
    out = handle(req)
    _validate(load, out)
    b = _q(out["roster_assignments"][0]["break_start_at"])
    # 20 min blocks 13:00-13:30 only; 30 min also 13:30-13:45
    if start is not None:
        assert b == start
        assert out["break_cost"][0]["lost_agent_intervals"] == 0
    else:
        assert b != 54 and not {b, b + 1} & {52, 53, 54}
