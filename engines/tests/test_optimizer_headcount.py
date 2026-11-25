# SPDX-License-Identifier: AGPL-3.0-only
import copy
import uuid
from datetime import datetime, timedelta

import pytest

from opendispatch_engines.optimizer import cpsat, handle
from test_optimizer_cpsat import _over, _short, _small, ZONE
from test_optimizer_engine import DAY, _build, _check_hard_rules, _validate
from test_optimizer_reach import _validate_in

MODELS = ["greedy-ls-0.3", pytest.param("cpsat-1", marks=pytest.mark.skipif(
    cpsat.load() is None, reason="ortools not installed"))]


def _run(req, model, delta=None):
    req = copy.deepcopy(req)
    req["objective"]["model_version"] = model
    if delta is not None:
        req["scenario_adjustments"] = {"headcount_delta": delta}
    return req, handle(req)


def _codes(out):
    return [v["code"] for v in out["violations"]]


def _ids(out):
    return {a["agent_id"] for a in out["roster_assignments"]}


def _scenario_rules(req, out):
    """Hard rules, counting engine-added people as known."""
    known = {s["agent_id"] for s in req["agents"]}
    extra = [a for a in out["roster_assignments"] if a["agent_id"] not in known]
    base = copy.deepcopy(req)
    for a in extra:
        assert uuid.UUID(a["agent_id"]).version == 5
        base["agents"].append({"agent_id": a["agent_id"],
                                  "kind": "remote" if a["zone_id"] is None else "field",
                                  "home_zone_id": a["zone_id"], "skills": [],
                                  "available": True})
    known_v = {v["vehicle_id"] for v in req["vehicles"]}
    for v in out["vehicle_assignments"]:
        if v["vehicle_id"] not in known_v:
            known_v.add(v["vehicle_id"])
            base["vehicles"].append({"vehicle_id": v["vehicle_id"], "zone_id": v["zone_id"],
                                     "available": True})
    _check_hard_rules(base, out)


@pytest.mark.parametrize("model", MODELS)
@pytest.mark.parametrize("start,delta,same_as", [
    ((2, 3), {"field_agents": 1}, (3, 3)),
    ((3, 3), {"field_agents": -1}, (2, 3)),
    ((3, 3), {"vehicles": -2}, (3, 1)),
    ((3, 1), {"vehicles": 2}, (3, 3)),
])
def test_delta_matches_the_real_headcount(load, model, start, delta, same_as):
    req, out = _run(_small(*start), model, [dict(delta, zone_id=ZONE)])
    _validate_in(load, req)
    _validate(load, out)
    _, ref = _run(_small(*same_as), model)
    assert (_short(out), _over(out), len(out["roster_assignments"])) == \
        (_short(ref), _over(ref), len(ref["roster_assignments"]))
    assert not any(c.startswith("HEADCOUNT") for c in _codes(out))


@pytest.mark.parametrize("model", MODELS)
def test_headcount_up_and_down_moves_the_gap(load, model):
    req = _build(zones=2, field=10, vehicles=10, remote=2, demand=2.0, leave=0, budget=8)
    z0, z1 = req["zone_ids"]
    _, base = _run(req, model)
    up_req, up = _run(req, model, [{"zone_id": z0, "field_agents": 6, "vehicles": 6}])
    dn_req, dn = _run(req, model, [{"zone_id": z0, "field_agents": -4}])
    for r, o in ((up_req, up), (dn_req, dn)):
        _validate(load, o)
        _scenario_rules(r, o)

    def short(o, z):
        return sum(-c["delta"] for c in o["gap_cells"] if c["zone_id"] == z and c["delta"] < 0)

    assert short(up, z0) < short(base, z0) < short(dn, z0)
    assert short(up, z1) == short(base, z1) == short(dn, z1)
    added = _ids(up) - {s["agent_id"] for s in req["agents"]}
    assert added and all(a["zone_id"] == z0 for a in up["roster_assignments"]
                         if a["agent_id"] in added)
    home = [s["agent_id"] for s in req["agents"] if s.get("home_zone_id") == z0]
    gone = sorted(home, reverse=True)[:4]
    assert not set(gone) & _ids(dn)


def test_added_ids_are_stable():
    req = _build(zones=1, field=4, vehicles=4, demand=3.0, leave=0)
    d = [{"zone_id": req["zone_ids"][0], "field_agents": 3}]
    _, a = _run(req, "greedy-ls-0.3", d)
    _, b = _run(req, "greedy-ls-0.3", d)
    assert _ids(a) == _ids(b)


@pytest.mark.parametrize("model", MODELS)
def test_remote_delta(load, model):
    req = _build(zones=1, field=10, vehicles=10, remote=2, leave=0)
    z = req["zone_ids"][0]
    remote = {s["agent_id"] for s in req["agents"] if s["kind"] == "remote"}

    def rows(o):
        return [a for a in o["roster_assignments"] if a["zone_id"] is None]

    _, base = _run(req, model)
    up_req, up = _run(req, model, [{"zone_id": z, "remote_agents": 3}])
    _, dn = _run(req, model, [{"zone_id": z, "remote_agents": -2}])
    _validate(load, up)
    _scenario_rules(up_req, up)
    assert len(rows(up)) > len(rows(base))
    assert not rows(dn) and not remote & _ids(dn)


@pytest.mark.parametrize("model", MODELS)
def test_more_removed_than_exist_is_capped(load, model):
    req = _build(zones=1, field=6, vehicles=6, remote=0, leave=0, demand=1.0)
    z = req["zone_ids"][0]
    keep = req["agents"][0]["agent_id"]
    pid = req["shift_patterns"][0]["shift_pattern_id"]
    req["fixed_assignments"] = [{"agent_id": keep, "shift_pattern_id": pid, "zone_id": z}]
    _, out = _run(req, model, [{"zone_id": z, "field_agents": -50, "vehicles": -50}])
    _validate(load, out)
    capped = [v for v in out["violations"] if v["code"] == "HEADCOUNT_DELTA_CAPPED"]
    assert len(capped) == 2 and all(v["zone_id"] == z for v in capped)
    # every vehicle gone: nobody can go out, not even the fixed line
    assert out["roster_assignments"] == []
    assert "FIXED_ASSIGNMENT_NOT_APPLIED" in _codes(out)
    assert out["status"] == "infeasible"


def test_vehicles_for_a_zone_without_vehicles_not_applied(load):
    req = _build(zones=1, field=6, vehicles=0, leave=0)
    _, out = _run(req, "greedy-ls-0.3", [{"zone_id": req["zone_ids"][0], "vehicles": 3}])
    _validate(load, out)
    assert "HEADCOUNT_DELTA_NOT_APPLIED" in _codes(out)
    assert not out["vehicle_assignments"]


def test_zone_outside_the_run_is_ignored(load):
    req = _build(zones=1, field=6, vehicles=6, leave=0)
    other = "3f6f1b1e-7a55-4c27-9d0a-00000000ffff"
    _, a = _run(req, "greedy-ls-0.3")
    _, b = _run(req, "greedy-ls-0.3", [{"zone_id": other, "field_agents": 9}])
    assert a["roster_assignments"] == b["roster_assignments"] and a["status"] == b["status"]


def _quarter(c):
    return (datetime.fromisoformat(c["interval_start"]) - DAY) // timedelta(minutes=15)


@pytest.mark.parametrize("model", MODELS)
def test_shortfall_is_placed_per_zone_and_interval(load, model):
    req = _build(zones=2, field=8, vehicles=8, remote=1, demand=2.5, leave=0, budget=8)
    z0, z1 = req["zone_ids"]
    _, out = _run(req, model, [{"zone_id": z1, "field_agents": -50}])
    _validate(load, out)
    assert out["status"] == "partial"
    for z in (z0, z1):
        cells = [c for c in out["gap_cells"] if c["zone_id"] == z]
        assert [c["interval_index"] for c in cells] == sorted({c["interval_index"] for c in cells})
        assert all(_quarter(c) == c["interval_index"] for c in cells)
        assert all(c["delta"] == c["planned"] - c["required"] for c in cells)
    empty = [c for c in out["gap_cells"] if c["zone_id"] == z1]
    assert empty and all(c["kind"] == "gap" and c["planned"] == 0 and c["cause"] == "people"
                         for c in empty)
    gap = [v for v in out["violations"] if v["code"] == "COVERAGE_GAP"]
    assert {v["zone_id"] for v in gap} == {z0, z1}
    rem = [v for v in out["violations"] if v["code"] == "REMOTE_COVERAGE_GAP"]
    assert rem and ": " in rem[0]["message"] and "(up to " in rem[0]["message"]
