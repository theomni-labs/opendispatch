# SPDX-License-Identifier: AGPL-3.0-only
import copy
import json
import time
from datetime import datetime, timedelta

import pytest

from opendispatch_engines import optimizer as opt
from opendispatch_engines.optimizer import cpsat, handle
from test_optimizer_engine import DAY, STABLE, _build, _check_hard_rules, _validate
from test_optimizer_reach import PA, PB, _geo, _validate_in, _with_sl, _zone_cells

pytestmark = pytest.mark.skipif(cpsat.load() is None, reason="ortools not installed")

U = "3f6f1b1e-7a55-4c27-9d0a-%012x"
ZONE = U % 0xa1
RULE = U % 0xf9


def _cp(req, budget=None):
    req = copy.deepcopy(req)
    req.setdefault("objective", {})["model_version"] = "cpsat-1"
    if budget:
        req["objective"]["max_run_seconds"] = budget
    return req


def _short(out):
    return sum(-c["delta"] for c in out["gap_cells"] if c["delta"] < 0)


def _over(out):
    return sum(c["delta"] for c in out["gap_cells"] if c["delta"] > 0)


def _strict_rules(req, out):
    """Hard rules plus zone, vehicle count and fixed lines."""
    _check_hard_rules(req, out)
    svs = {s["agent_id"]: s for s in req["agents"]}
    fixed = {f["agent_id"]: f for f in req.get("fixed_assignments", [])}
    for a in out["roster_assignments"]:
        s = svs[a["agent_id"]]
        if s["kind"] == "remote":
            assert a["zone_id"] is None
        else:
            f = fixed.get(a["agent_id"])
            assert a["zone_id"] == (f["zone_id"] if f else s["home_zone_id"])
    for z in req["zone_ids"]:
        vl = [v for v in req["vehicles"] if v["zone_id"] == z]
        if not vl:
            continue
        cap = sum(1 for v in vl if v["available"])
        live = {v["vehicle_id"] for v in vl if v["available"]}
        assert all(v["vehicle_id"] in live for v in out["vehicle_assignments"] if v["zone_id"] == z)
        on = [0] * 96
        for a in out["roster_assignments"]:
            if a["zone_id"] != z:
                continue
            s = (datetime.fromisoformat(a["start_at"]) - DAY) // timedelta(minutes=15)
            e = (datetime.fromisoformat(a["end_at"]) - DAY) // timedelta(minutes=15)
            for t in range(s, min(e, 96)):
                on[t] += 1
        assert max(on) <= cap


def _small(n_agents, n_vehicles):
    """Need 1 from 06:00 to 22:00; patterns A 06-14, B 14-22, M 10-18."""
    vals = []
    for i in range(24, 88):
        vals.append({"zone_id": ZONE, "sub_zone_id": U % 0xb1,
                     "interval_start": (DAY + timedelta(minutes=15 * i)).isoformat(),
                     "low": 1, "expected": 1, "high": 1,
                     "field_expected": 1, "remote_inferred_expected": 0})
    pats = []
    for k, (code, s, e) in enumerate((("A", "06:00", "14:00"), ("B", "14:00", "22:00"),
                                       ("M", "10:00", "18:00"))):
        h = {"applies": True, "start_time": s, "end_time": e}
        pats.append({"shift_pattern_id": U % (0xf1 + k), "code": code, "kind": "field",
                     "normal": h, "ramadan": h, "break_rule_id": RULE})
    veh = [{"vehicle_id": U % (0xe1 + k), "zone_id": ZONE, "available": True}
           for k in range(n_vehicles)]
    return {
        "schema_version": "1.0", "request_id": U % 2,
        "requested_at": "2026-09-13T06:00:00+03:00", "data_source": "SYNTHETIC",
        "roster_date": "2026-09-14", "zone_ids": [ZONE], "planning_level": "zone",
        "calendar_mode": "normal", "objective": {"seed": 1, "model_version": "cpsat-1"},
        "forecast": {"forecast_run_ref": "small", "values": vals},
        "agents": [{"agent_id": U % (0xd00 + i), "kind": "field", "home_zone_id": ZONE,
                       "skills": [], "default_vehicle_id": None, "available": True}
                      for i in range(n_agents)],
        "vehicles": veh, "shift_patterns": pats,
        "break_rules": [{"break_rule_id": RULE, "break_minutes": 30, "after_consecutive_hours": 5}],
        "prayer_times": {"fajr": "04:17", "dhuhr": "11:52", "asr": "15:20",
                         "maghrib": "18:07", "isha": "19:37"},
    }


@pytest.mark.parametrize("n_surv,n_veh,unmet,over,lines", [
    (2, 2, 4, 0, 2),   # A + B; the two breaks are uncovered
    (3, 3, 0, 26, 3),  # M covers both breaks: 90 duty quarters for 64
    (3, 1, 4, 0, 2),   # one vehicle: A and B share it, M cannot go out
])
def test_known_small_optimum(load, n_surv, n_veh, unmet, over, lines):
    req = _small(n_surv, n_veh)
    _validate_in(load, req)
    out = handle(req)
    _validate(load, out)
    _strict_rules(req, out)
    assert out["model_version"] == "cpsat-1" and out["solver_status"] == "optimal"
    assert (_short(out), _over(out), len(out["roster_assignments"])) == (unmet, over, lines)


def test_example_request(load):
    req = _cp(load("examples/optimizer.input.json"))
    _validate_in(load, req)
    out = handle(req)
    _validate(load, out)
    _strict_rules(req, out)
    assert out["model_version"] == "cpsat-1"
    assert out["solver_status"] in ("optimal", "feasible")
    assert out["illustrative"] is True and out["roster_assignments"]


def test_hard_rules_realistic_and_fixed(load):
    req = _cp(_build(zones=2, field=20, vehicles=12, remote=3))
    sid = next(s["agent_id"] for s in req["agents"] if s["kind"] == "field" and s["available"])
    pid = req["shift_patterns"][1]["shift_pattern_id"]
    req["fixed_assignments"] = [{"agent_id": sid, "shift_pattern_id": pid,
                                 "zone_id": req["zone_ids"][0]}]
    out = handle(req)
    _validate(load, out)
    _strict_rules(req, out)
    got = [a for a in out["roster_assignments"] if a["agent_id"] == sid]
    assert got and got[0]["shift_pattern_id"] == pid
    assert any(a["zone_id"] is None for a in out["roster_assignments"])
    assert any(a["standby_point_id"] for a in out["roster_assignments"])


def test_leave_and_vehicle_cause(load):
    req = _cp(_build(zones=1, field=40, vehicles=2, demand=3.0, leave=0.3))
    out = handle(req)
    _validate(load, out)
    _strict_rules(req, out)
    assert any(c["cause"] == "vehicles" for c in out["gap_cells"])


def test_deterministic(load):
    req = _cp(_with_sl(_build(zones=2, field=15, vehicles=10, n_subs=5, points=4, demand=0.5)))
    a, b = handle(req), handle(copy.deepcopy(req))
    _validate(load, a)
    for o in (a, b):
        for k in STABLE:
            o.pop(k)
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def test_reach_two_points(load):
    req = _cp(_geo(n_agents=2))
    out = handle(req)
    _validate(load, out)
    _strict_rules(req, out)
    assert sorted(a["standby_point_id"] for a in out["roster_assignments"]) == [PA, PB]
    assert all(c["reach_share"] == 1.0 for c in _zone_cells(out))
    assert out["status"] == "feasible" and out["solver_status"] == "optimal"


def test_reach_shortfall_reported(load):
    out = handle(_cp(_geo(n_agents=1)))
    _validate(load, out)
    assert all(c["cause"] == "geography" and c["reach_share"] == 0.5 for c in _zone_cells(out))
    assert "SERVICE_LEVEL_REACH" in {v["code"] for v in out["violations"]}


def test_reach_point_follows_demand():
    out = handle(_cp(_geo(n_agents=1, d1=0.2, d2=0.6, target=0.7)))
    assert out["roster_assignments"][0]["standby_point_id"] == PB
    assert all(c["reach_share"] == 0.75 for c in _zone_cells(out))


def test_missing_ortools_falls_back(load, monkeypatch):
    monkeypatch.setattr(opt, "_load_cpsat", lambda: (cpsat, None))
    req = _cp(load("examples/optimizer.input.json"))
    out = handle(req)
    _validate(load, out)
    plain = handle(load("examples/optimizer.input.json"))
    assert out["model_version"] == "greedy-ls-0.1" and out["solver_status"] == "heuristic"
    assert out["violations"][-1]["code"] == "MODEL_UNAVAILABLE"
    assert "ortools" in out["violations"][-1]["message"]
    assert out["status"] == plain["status"]
    assert out["roster_assignments"] == plain["roster_assignments"]


def test_unknown_model_falls_back(load):
    req = load("examples/optimizer.input.json")
    req["objective"]["model_version"] = "gurobi-9"
    out = handle(req)
    _validate(load, out)
    assert out["model_version"] == "greedy-ls-0.1"
    assert out["violations"][-1]["code"] == "MODEL_UNAVAILABLE"


def test_greedy_reports_heuristic(load):
    out = handle(load("examples/optimizer.input.json"))
    assert out["solver_status"] == "heuristic"


def _metrics(out):
    shares = [c["reach_share"] for c in out["gap_cells"] if "reach_share" in c]
    return {"unmet_h": _short(out) / 4, "over_h": _over(out) / 4,
            "reach": round(sum(shares) / len(shares), 3) if shares else None,
            "min_reach": min(shares) if shares else None,
            "secs": out["run_seconds"], "solver": out["solver_status"]}


def _cases(load):
    ex = load("examples/optimizer.input.json")
    return [
        ("example", ex, None),
        ("realistic 1 zone", _build(zones=1, field=20, vehicles=12, remote=3), None),
        ("two zones", _build(zones=2, field=15, vehicles=10), None),
        ("6 zones tight", _build(zones=6, field=9, vehicles=6, demand=1.5, seed=11, leave=0), None),
        ("vehicle short", _build(zones=1, field=40, vehicles=2, demand=3.0, leave=0), None),
        ("geo 1 agent", _geo(n_agents=1, d1=0.2, d2=0.6, target=0.7), None),
        ("1 zone reach 12 subs", _with_sl(_build(zones=1, field=40, vehicles=30, remote=3, n_subs=12,
                                                   points=6, demand=0.25, leave=0)), None),
        ("36 zones", _build(zones=36, field=14, vehicles=10, remote=1, demand=1.2), 36),
        ("36 zones reach", _with_sl(_build(zones=36, field=14, vehicles=10, remote=1,
                                           demand=1.2)), 36),
    ]


def test_compare_with_greedy(load):
    rows = []
    for name, req, budget in _cases(load):
        g = copy.deepcopy(req)
        g["objective"]["model_version"] = "greedy-ls-0.2"
        if budget:
            g["objective"]["max_run_seconds"] = budget
        t = time.perf_counter()
        go = handle(g)
        tg = time.perf_counter() - t
        c = _cp(req, budget)
        t = time.perf_counter()
        co = handle(c)
        tc = time.perf_counter() - t
        _validate(load, co)
        _strict_rules(c, co)
        if budget:
            assert tc <= budget, (name, tc)
        gm, cm = _metrics(go), _metrics(co)
        if cm["solver"] == "optimal":
            assert cm["unmet_h"] <= gm["unmet_h"], name
        rows.append((name, gm, cm, tg, tc))
    print("\n%-22s %17s %17s %15s %13s" % ("case", "unmet h g/c", "over h g/c", "reach g/c",
                                            "secs g/c"))
    for name, gm, cm, tg, tc in rows:
        print("%-22s %8.2f/%-8.2f %8.2f/%-8.2f %7s/%-7s %6.2f/%-6.2f %s" % (
            name, gm["unmet_h"], cm["unmet_h"], gm["over_h"], cm["over_h"],
            gm["reach"], cm["reach"], tg, tc, cm["solver"]))


@pytest.mark.parametrize("model", ["greedy-ls-0.2", "cpsat-1"])
def test_fractional_capacity(load, model):
    req = _small(6, 6)
    req["objective"]["model_version"] = model
    req["objective"]["cases_per_agent_per_interval"] = 0.45
    for v in req["forecast"]["values"]:
        if v["interval_start"].startswith("2026-09-14T1"):
            for k in ("low", "expected", "high", "field_expected"):
                v[k] = 0.9
    _validate_in(load, req)
    out = handle(req)
    _validate(load, out)
    _strict_rules(req, out)
    need = {c["interval_index"]: c["required"] for c in out["gap_cells"]}
    # ceil(1 / 0.45) = 3 and ceil(0.9 / 0.45) = 2, as greedy-ls-0.2
    assert need[24] == 3 and need[40] == 2 and need[87] == 3
    assert need == {i: opt.required_staffing(req, ZONE)[i] for i in need}
