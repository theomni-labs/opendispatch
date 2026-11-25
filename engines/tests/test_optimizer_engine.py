# SPDX-License-Identifier: AGPL-3.0-only
import copy
import json
import random
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from jsonschema import Draft202012Validator, FormatChecker

from opendispatch_engines import optimizer as opt
from opendispatch_engines.optimizer import handle, required_staffing

TZ = timezone(timedelta(hours=3))
DAY = datetime(2026, 9, 14, tzinfo=TZ)
STABLE = ("generated_at", "run_seconds")


def _validate(load, out):
    v = Draft202012Validator(load("optimizer.output.schema.json"), format_checker=FormatChecker())
    v.validate(out)


def _uid(rng):
    return str(uuid.UUID(int=rng.getrandbits(128), version=4))


def _build(zones=1, field=12, remote=2, vehicles=8, seed=7, demand=1.0, leave=0.1, budget=None,
           n_subs=2, points=3):
    rng = random.Random(seed)
    rule = _uid(rng)
    pats = []
    for code, s, e in (("DAY-A", "06:00", "14:00"), ("DAY-B", "14:00", "22:00"),
                       ("MID", "10:00", "18:00"), ("NIGHT", "22:00", "06:00")):
        pats.append({"shift_pattern_id": _uid(rng), "code": code, "kind": "field",
                     "normal": {"applies": True, "start_time": s, "end_time": e},
                     "ramadan": {"applies": True, "start_time": s, "end_time": e},
                     "break_rule_id": rule})
    for code, s, e in (("R-A", "06:00", "14:00"), ("R-B", "14:00", "22:00"),
                       ("R-C", "18:00", "00:00")):
        pats.append({"shift_pattern_id": _uid(rng), "code": code, "kind": "remote",
                     "normal": {"applies": True, "start_time": s, "end_time": e},
                     "ramadan": {"applies": True, "start_time": s, "end_time": e},
                     "break_rule_id": rule})
    req = {
        "schema_version": "1.0", "request_id": _uid(rng),
        "requested_at": "2026-09-13T06:00:00+03:00", "data_source": "SYNTHETIC",
        "input_data_sources": ["SYNTHETIC"], "roster_date": "2026-09-14",
        "zone_ids": [], "planning_level": "zone", "calendar_mode": "normal",
        "objective": {"seed": 3},
        "forecast": {"forecast_run_ref": "synthetic", "values": []},
        "agents": [], "vehicles": [], "shift_patterns": pats,
        "break_rules": [{"break_rule_id": rule, "break_minutes": 30, "after_consecutive_hours": 5}],
        "prayer_times": {"fajr": "04:17", "dhuhr": "11:52", "asr": "15:20",
                         "maghrib": "18:07", "isha": "19:37"},
        "standby_points": [],
    }
    if budget:
        req["objective"]["max_run_seconds"] = budget
    for _ in range(zones):
        z = _uid(rng)
        req["zone_ids"].append(z)
        subs = [_uid(rng) for _ in range(n_subs)]
        for i in range(96):
            hour = i / 4
            if hour < 6:
                continue
            level = demand * (0.5 + 1.5 * max(0, 1 - abs(hour - 9) / 3) + 1.5 * max(0, 1 - abs(hour - 18) / 3))
            for sz in subs:
                x = level * (0.6 + 0.2 * rng.random())
                req["forecast"]["values"].append({
                    "zone_id": z, "sub_zone_id": sz,
                    "interval_start": (DAY + timedelta(minutes=15 * i)).isoformat(),
                    "low": x * .7, "expected": x, "high": x * 1.4,
                    "field_expected": x * .7, "remote_inferred_expected": x * .3})
        for i in range(field):
            veh = _uid(rng) if i < vehicles else None
            if veh:
                req["vehicles"].append({"vehicle_id": veh, "zone_id": z, "available": True})
            req["agents"].append({
                "agent_id": _uid(rng), "kind": "field", "home_zone_id": z,
                "skills": ["general"], "default_vehicle_id": veh,
                "available": rng.random() > leave})
        for k in range(points):
            req["standby_points"].append({
                "standby_point_id": _uid(rng), "zone_id": z,
                "latitude": 24.7 + k * 0.02, "longitude": 46.7 + k * 0.01,
                "coverage_radius_m": 3000})
    for i in range(remote * zones):
        req["agents"].append({"agent_id": _uid(rng), "kind": "remote",
                                 "home_zone_id": None, "skills": ["general"],
                                 "default_vehicle_id": None, "available": True})
    return req


def _t(s):
    return datetime.fromisoformat(s)


def _check_hard_rules(req, out):
    svs = {s["agent_id"]: s for s in req["agents"]}
    pats = {p["shift_pattern_id"]: p for p in req["shift_patterns"]}
    rules = {r["break_rule_id"]: r for r in req["break_rules"]}
    seen = set()
    blocked = []
    for k, v in req["prayer_times"].items():
        h, m = map(int, v.split(":"))
        a = DAY + timedelta(hours=h, minutes=m)
        blocked.append((a, a + timedelta(minutes=opt.PRAYER_WINDOW_MIN)))
    for a in out["roster_assignments"]:
        sid = a["agent_id"]
        assert sid not in seen
        seen.add(sid)
        s = svs[sid]
        assert s["available"]
        assert a["shift_pattern_id"] in pats
        assert pats[a["shift_pattern_id"]]["kind"] == s["kind"]
        ids = s.get("eligible_shift_pattern_ids")
        assert ids is None or a["shift_pattern_id"] in ids
        st, en = _t(a["start_at"]), _t(a["end_at"])
        rule = rules[pats[a["shift_pattern_id"]]["break_rule_id"]]
        limit = timedelta(hours=rule["after_consecutive_hours"])
        if a["break_start_at"]:
            bs, be = _t(a["break_start_at"]), _t(a["break_end_at"])
            assert st < bs and be <= en
            assert be - bs >= timedelta(minutes=rule["break_minutes"])
            assert bs - st <= limit and en - be <= limit
            for x, y in blocked:
                assert be <= x or bs >= y
        else:
            assert en - st <= limit
    veh = {}
    for v in out["vehicle_assignments"]:
        assert v["agent_id"] not in veh
        veh[v["agent_id"]] = v["vehicle_id"]
    spans = {}
    byid = {a["agent_id"]: a for a in out["roster_assignments"]}
    for sid, vid in veh.items():
        a = byid[sid]
        spans.setdefault(vid, []).append((_t(a["start_at"]), _t(a["end_at"])))
    for lst in spans.values():
        lst.sort()
        for x, y in zip(lst, lst[1:]):
            assert x[1] <= y[0]
    for a in out["roster_assignments"]:
        if a["zone_id"] and any(v["zone_id"] == a["zone_id"] for v in req["vehicles"]):
            assert a["agent_id"] in veh


def _short(out):
    return sum(-c["delta"] for c in out["gap_cells"] if c["delta"] < 0)


def test_example_request_is_feasible(load):
    req = load("examples/optimizer.input.json")
    out = handle(req)
    _validate(load, out)
    assert out["status"] in ("feasible", "partial")
    assert out["illustrative"] is True
    assert out["roster_assignments"]
    _check_hard_rules(req, out)


def test_fixture_request_hard_rules(load):
    req = load("examples/optimizer.input.json")
    req["agents"][0]["available"] = False
    out = handle(req)
    _validate(load, out)
    assert all(a["agent_id"] != req["agents"][0]["agent_id"]
               for a in out["roster_assignments"])


def test_realistic_day_hard_rules_and_valid(load):
    req = _build(zones=1, field=20, vehicles=12, remote=3)
    out = handle(req)
    _validate(load, out)
    _check_hard_rules(req, out)
    assert out["roster_assignments"]
    assert any(a["standby_point_id"] for a in out["roster_assignments"])
    assert any(a["zone_id"] is None for a in out["roster_assignments"])


def test_enough_supply_is_feasible(load):
    req = _build(zones=1, field=60, vehicles=60, remote=10, demand=0.4, leave=0)
    out = handle(req)
    _validate(load, out)
    assert out["status"] == "feasible", out["violations"]
    assert _short(out) == 0


def test_infeasible_reports_gaps_not_crash(load):
    req = _build(zones=1, field=3, vehicles=3, demand=8.0)
    out = handle(req)
    _validate(load, out)
    assert out["status"] in ("partial", "infeasible")
    assert any(c["kind"] == "gap" for c in out["gap_cells"])
    assert any(v["code"] == "COVERAGE_GAP" for v in out["violations"])
    _check_hard_rules(req, out)


def test_no_supply_is_infeasible(load):
    req = _build(zones=1, field=3, vehicles=3, demand=5.0)
    for s in req["agents"]:
        s["available"] = False
    out = handle(req)
    _validate(load, out)
    assert out["status"] == "infeasible"
    assert out["roster_assignments"] == []
    assert any(c["kind"] == "gap" for c in out["gap_cells"]) or out["violations"]


def test_vehicle_shortage_is_cause(load):
    req = _build(zones=1, field=40, vehicles=2, demand=3.0, leave=0)
    out = handle(req)
    _validate(load, out)
    _check_hard_rules(req, out)
    assert any(c["cause"] == "vehicles" for c in out["gap_cells"])


def test_deterministic():
    req = _build(zones=2, field=15, vehicles=10)
    a, b = handle(req), handle(copy.deepcopy(req))
    for k in STABLE:
        a.pop(k)
        b.pop(k)
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def test_leave_respected():
    req = _build(zones=1, field=20, vehicles=20, leave=0.5)
    out = handle(req)
    off = {s["agent_id"] for s in req["agents"] if not s["available"]}
    assert off and not off & {a["agent_id"] for a in out["roster_assignments"]}


def test_fixed_assignment_kept(load):
    req = _build(zones=1, field=10, vehicles=10, leave=0)
    sid = req["agents"][0]["agent_id"]
    pid = req["shift_patterns"][1]["shift_pattern_id"]
    req["fixed_assignments"] = [{"agent_id": sid, "shift_pattern_id": pid,
                                 "zone_id": req["zone_ids"][0]}]
    out = handle(req)
    _validate(load, out)
    got = [a for a in out["roster_assignments"] if a["agent_id"] == sid]
    assert got and got[0]["shift_pattern_id"] == pid


def test_budget_honoured_until_deadline(monkeypatch):
    monkeypatch.setattr(opt, "STALL_BASE", 10 ** 9)
    req = _build(zones=1, field=20, vehicles=15, budget=1)
    t = time.perf_counter()
    out = handle(req)
    took = time.perf_counter() - t
    assert took <= 1.0, took
    assert out["run_seconds"] <= 1.0
    assert out["run_seconds"] >= 0.5


def test_36_zone_synthetic_run(load):
    req = _build(zones=36, field=14, vehicles=10, remote=1, demand=1.2, budget=36)
    t = time.perf_counter()
    out = handle(req)
    took = time.perf_counter() - t
    assert took < 300
    assert took <= 36, took
    _validate(load, out)
    _check_hard_rules(req, out)
    zones_with_cells = {c["zone_id"] for c in out["gap_cells"]}
    assert len(zones_with_cells) == 36
    print("36 zones: %.2f s total, %.3f s per zone" % (took, took / 36))


def _baseline_short(req, zone):
    pats = [p for p in req["shift_patterns"] if p["kind"] == "field"]
    cov = [0] * 96
    svs = [s for s in req["agents"] if s["kind"] == "field" and s["available"]
           and s["home_zone_id"] == zone]
    vcount = sum(1 for v in req["vehicles"] if v["zone_id"] == zone and v["available"])
    for i, _ in enumerate(svs[:vcount]):
        h = pats[i % len(pats)]["normal"]
        s = int(h["start_time"][:2]) * 4
        e = int(h["end_time"][:2]) * 4
        e = e + 96 if e <= s else e
        for t in range(s, min(e, 96)):
            cov[t] += 1
    need = required_staffing(req, zone)
    return sum(max(0, need[t] - cov[t]) for t in range(96))


def test_coverage_at_least_baseline(load):
    req = _build(zones=6, field=9, vehicles=6, demand=1.5, seed=11, leave=0)
    out = handle(req)
    total_opt = _short(out)
    total_base = sum(_baseline_short(req, z) for z in req["zone_ids"])
    print("shortfall engine=%d baseline=%d" % (total_opt, total_base))
    assert total_opt <= total_base
    for z in req["zone_ids"]:
        mine = sum(-c["delta"] for c in out["gap_cells"]
                   if c["zone_id"] == z and c["delta"] < 0)
        assert mine <= _baseline_short(req, z)
