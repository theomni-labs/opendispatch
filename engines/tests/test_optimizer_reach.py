# SPDX-License-Identifier: AGPL-3.0-only
import copy
import hashlib
import json
import random
import time

from jsonschema import Draft202012Validator, FormatChecker

from opendispatch_engines.optimizer import handle
from test_optimizer_engine import STABLE, _build, _check_hard_rules

K = 111320.0
Z = "3f6f1b1e-7a55-4c27-9d0a-0000000000a1"
S1 = "3f6f1b1e-7a55-4c27-9d0a-0000000000b1"
S2 = "3f6f1b1e-7a55-4c27-9d0a-0000000000b2"
S3 = "3f6f1b1e-7a55-4c27-9d0a-0000000000b3"
PA = "3f6f1b1e-7a55-4c27-9d0a-0000000000c1"
PB = "3f6f1b1e-7a55-4c27-9d0a-0000000000c2"
PAT = "3f6f1b1e-7a55-4c27-9d0a-0000000000f1"
RULE = "3f6f1b1e-7a55-4c27-9d0a-0000000000f9"
LAT, LON = 24.70, 46.70

# Frozen greedy-ls-0.1 outputs
FROZEN = {
    "example": "629218568c8b8b36fb1322cc0715fb364eb49b39b0dc311c92298510673e7683",
    "realistic": "446973a4a981740d0e7dfcd257dbf5564171dd7e16289a04f012708c7f418a85",
    "two": "da8a0ecf8fa25412356efcb196d1a69ba68f0195d1cb2d96b5f5fd2004f4ea2b",
}


def _validate(load, out):
    v = Draft202012Validator(load("optimizer.output.schema.json"), format_checker=FormatChecker())
    v.validate(out)


def _validate_in(load, req):
    v = Draft202012Validator(load("optimizer.input.schema.json"), format_checker=FormatChecker())
    v.validate(req)


def _strip(out):
    out = copy.deepcopy(out)
    for k in STABLE:
        out.pop(k, None)
    out.get("engine", {}).pop("version", None)  # release bumps
    out.pop("solver_status", None)  # added in 0.7.0
    out.pop("break_cost", None)  # added in 0.7.0
    return out


def _hash(out):
    return hashlib.sha256(json.dumps(_strip(out), sort_keys=True).encode()).hexdigest()


def _sid(n):
    return "3f6f1b1e-7a55-4c27-9d0a-%012x" % (0xd00 + n)


def _geo(n_agents=2, target=0.95, d1=0.4, d2=0.4, centres=True, sl=True):
    """S1 3 km north of A; S2 9 km north, at B."""
    vals = []
    for i in range(32, 64):
        h, m = divmod(i * 15, 60)
        at = "2026-09-14T%02d:%02d:00+03:00" % (h, m)
        for sub, d in ((S1, d1), (S2, d2)):
            vals.append({"zone_id": Z, "sub_zone_id": sub, "interval_start": at,
                         "low": d, "expected": d, "high": d,
                         "field_expected": d, "remote_inferred_expected": 0})
    req = {
        "schema_version": "1.0",
        "request_id": "3f6f1b1e-7a55-4c27-9d0a-000000000002",
        "requested_at": "2026-09-13T06:00:00+03:00",
        "data_source": "SYNTHETIC",
        "roster_date": "2026-09-14",
        "zone_ids": [Z], "planning_level": "zone", "calendar_mode": "normal",
        "objective": {"seed": 1},
        "forecast": {"forecast_run_ref": "geo", "values": vals},
        "agents": [{"agent_id": _sid(i), "kind": "field", "home_zone_id": Z,
                       "skills": [], "default_vehicle_id": None, "available": True}
                      for i in range(n_agents)],
        "vehicles": [],
        "shift_patterns": [{"shift_pattern_id": PAT, "code": "DAY", "kind": "field",
                            "normal": {"applies": True, "start_time": "08:00", "end_time": "16:00"},
                            "ramadan": {"applies": True, "start_time": "08:00", "end_time": "16:00"},
                            "break_rule_id": RULE}],
        "break_rules": [{"break_rule_id": RULE, "break_minutes": 30, "after_consecutive_hours": 9}],
        "prayer_times": {"fajr": "04:17", "dhuhr": "11:52", "asr": "15:20",
                         "maghrib": "18:07", "isha": "19:37"},
        "standby_points": [
            {"standby_point_id": PA, "zone_id": Z, "latitude": LAT, "longitude": LON},
            {"standby_point_id": PB, "zone_id": Z, "latitude": LAT + 9000 / K, "longitude": LON},
        ],
    }
    if sl:
        cs = [{"sub_zone_id": S1, "zone_id": Z, "latitude": LAT + 3000 / K, "longitude": LON},
              {"sub_zone_id": S2, "zone_id": Z, "latitude": LAT + 9000 / K, "longitude": LON}]
        req["objective"]["service_level"] = {
            "threshold_seconds": 600, "target_share": target,
            "sub_zone_centres": cs if centres else cs[:1]}
        req["travel_model"] = {"average_speed_kmh": 40, "detour_factor": 1.3}
    return req


def _zone_cells(out):
    return [c for c in out["gap_cells"] if 32 <= c["interval_index"] < 64]


def _codes(out):
    return {v["code"] for v in out["violations"]}


def test_two_points_reach_everything(load):
    req = _geo(n_agents=2)
    _validate_in(load, req)
    out = handle(req)
    _validate(load, out)
    _check_hard_rules(req, out)
    assert out["model_version"] == "greedy-ls-0.2"
    assert sorted(a["standby_point_id"] for a in out["roster_assignments"]) == [PA, PB]
    cells = _zone_cells(out)
    assert len(cells) == 32
    assert all(c["required"] == 2 and c["reach_share"] == 1.0 for c in cells)
    assert "SERVICE_LEVEL_REACH" not in _codes(out)
    assert out["status"] == "feasible"


def test_one_agent_is_a_geography_gap(load):
    out = handle(_geo(n_agents=1))
    _validate(load, out)
    cells = _zone_cells(out)
    assert all(c["required"] == 2 and c["planned"] == 1 for c in cells)
    assert all(c["cause"] == "geography" and c["reach_share"] == 0.5 for c in cells)
    assert "reach 50% of field demand within 10 min; target 95%" in cells[0]["cause_detail"]
    v = [x for x in out["violations"] if x["code"] == "SERVICE_LEVEL_REACH"]
    assert len(v) == 1 and v[0]["zone_id"] == Z
    assert "32 intervals" in v[0]["message"] and "lowest 50%" in v[0]["message"]
    assert out["status"] == "partial"


def test_lower_target_needs_one_point(load):
    out = handle(_geo(n_agents=1, target=0.5))
    _validate(load, out)
    cells = _zone_cells(out)
    assert all(c["required"] == 1 and c["kind"] == "balanced" for c in cells)
    assert "SERVICE_LEVEL_REACH" not in _codes(out)
    assert out["status"] == "feasible"


def test_point_follows_demand():
    old = handle(_geo(n_agents=1, d1=0.2, d2=0.6, sl=False))
    new = handle(_geo(n_agents=1, d1=0.2, d2=0.6, target=0.7))
    assert old["roster_assignments"][0]["standby_point_id"] == PA
    assert new["roster_assignments"][0]["standby_point_id"] == PB
    assert all(c["reach_share"] == 0.75 for c in _zone_cells(new))


def test_sub_zone_without_centre_is_not_reached():
    out = handle(_geo(n_agents=2, centres=False))
    cells = _zone_cells(out)
    assert all(c["reach_share"] == 0.5 for c in cells)
    assert "SERVICE_LEVEL_REACH" in _codes(out)


def test_slower_travel_shrinks_reach():
    req = _geo(n_agents=2)
    req["travel_model"] = {"average_speed_kmh": 20, "detour_factor": 1.3}
    out = handle(req)
    # 20 km/h: 2.56 km, S1 (3 km) out of reach
    assert all(c["reach_share"] == 0.5 for c in _zone_cells(out))


def test_absent_service_level_is_unchanged(load):
    ex = load("examples/optimizer.input.json")
    assert _hash(handle(ex)) == FROZEN["example"]
    assert _hash(handle(_build(zones=1, field=20, vehicles=12, remote=3))) == FROZEN["realistic"]
    assert _hash(handle(_build(zones=2, field=15, vehicles=10))) == FROZEN["two"]


def test_example_with_and_without(load):
    ex = load("examples/optimizer.input.json")
    plain = handle(copy.deepcopy(ex))
    ex["objective"]["service_level"] = {"threshold_seconds": 600, "target_share": 0.95}
    _validate_in(load, ex)
    with_sl = handle(ex)
    _validate(load, with_sl)
    assert plain["model_version"] == "greedy-ls-0.1"
    assert with_sl["model_version"] == "greedy-ls-0.2"
    assert all("reach_share" not in c for c in plain["gap_cells"])
    # no centres: no field demand is reached
    assert all(c.get("reach_share") == 0.0 for c in with_sl["gap_cells"]
               if c["required"] > 0)
    assert "SERVICE_LEVEL_REACH" in _codes(with_sl)


def _with_sl(req, target=0.95, seed=5):
    rng = random.Random(seed)
    subs = {}
    for v in req["forecast"]["values"]:
        subs.setdefault(v["sub_zone_id"], v["zone_id"])
    cs = [{"sub_zone_id": s, "zone_id": z,
           "latitude": 24.72 + rng.uniform(-0.06, 0.06),
           "longitude": 46.72 + rng.uniform(-0.06, 0.06)} for s, z in sorted(subs.items())]
    req["objective"]["service_level"] = {
        "threshold_seconds": 600, "target_share": target, "sub_zone_centres": cs}
    return req


def test_deterministic_with_service_level(load):
    req = _with_sl(_build(zones=2, field=15, vehicles=10, n_subs=5, points=4, demand=0.5))
    a, b = handle(req), handle(copy.deepcopy(req))
    _validate(load, a)
    assert json.dumps(_strip(a), sort_keys=True) == json.dumps(_strip(b), sort_keys=True)
    assert any("reach_share" in c for c in a["gap_cells"])


def test_realistic_zone_performance(load):
    base = _build(zones=1, field=40, vehicles=30, remote=3, n_subs=12, points=6, demand=0.25, leave=0)
    req = _with_sl(copy.deepcopy(base))
    _validate_in(load, req)
    t = time.perf_counter()
    plain = handle(base)
    t1 = time.perf_counter() - t
    t = time.perf_counter()
    out = handle(req)
    t2 = time.perf_counter() - t
    _validate(load, out)
    _check_hard_rules(req, out)
    assert t1 <= 20 and t2 <= 20, (t1, t2)
    shares = [c["reach_share"] for c in out["gap_cells"] if "reach_share" in c]
    assert shares and all(0 <= s <= 1 for s in shares)
    print("one zone: plain %.2f s (run %.3f), reach %.2f s (run %.3f), mean reach %.3f"
          % (t1, plain["run_seconds"], t2, out["run_seconds"], sum(shares) / len(shares)))


def test_36_zone_run_with_service_level(load):
    req = _with_sl(_build(zones=36, field=14, vehicles=10, remote=1, demand=1.2, budget=36))
    t = time.perf_counter()
    out = handle(req)
    took = time.perf_counter() - t
    assert took <= 36, took
    _validate(load, out)
    _check_hard_rules(req, out)
    print("36 zones with reach: %.2f s" % took)
