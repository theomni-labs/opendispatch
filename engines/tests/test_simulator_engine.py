# SPDX-License-Identifier: AGPL-3.0-only
import copy
import random
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from jsonschema import Draft202012Validator, FormatChecker

from opendispatch_engines.simulator import core, handle, handle_with_warnings
from opendispatch_engines.simulator.params import PLAIN

TZ = timezone(timedelta(hours=3))
DAY = datetime(2026, 9, 14, 0, 0, tzinfo=TZ)
ZONE = "091ff2b2-f0e1-4b97-bfc9-7cdd0698c32a"
ZONE2 = "eecf5c7f-237c-443c-b331-b75ba3fb26fc"


def uid(rnd):
    return str(uuid.UUID(int=rnd.getrandbits(128), version=4))


def iso(t):
    return t.isoformat()


def day(n_cases=150, n_surv=10, policy="nearest", seed=7, hours=8, zone=ZONE,
        on_scene=1200):
    rnd = random.Random(seed)
    cases = []
    for i in range(n_cases):
        t = DAY + timedelta(hours=6, seconds=rnd.uniform(0, hours * 3600))
        c = {"case_id": uid(rnd), "registered_at": iso(t.replace(microsecond=0)),
             "zone_id": zone, "latitude": 24.65 + rnd.random() * 0.1,
             "longitude": 46.65 + rnd.random() * 0.1,
             "handling": "remote_inferred" if i % 5 == 4 else "field"}
        if on_scene is not None:
            c["on_scene_seconds"] = on_scene
        cases.append(c)
    lines = []
    for _ in range(n_surv):
        lines.append({"agent_id": uid(rnd), "shift_pattern_id": uid(rnd), "zone_id": zone,
                      "start_at": iso(DAY + timedelta(hours=6)),
                      "end_at": iso(DAY + timedelta(hours=6 + hours + 2)),
                      "break_start_at": iso(DAY + timedelta(hours=11)),
                      "break_end_at": iso(DAY + timedelta(hours=11, minutes=30)),
                      "start_latitude": 24.65 + rnd.random() * 0.1,
                      "start_longitude": 46.65 + rnd.random() * 0.1})
    return {"schema_version": "1.0", "request_id": uid(rnd), "requested_at": iso(DAY),
            "data_source": "SYNTHETIC", "input_data_sources": ["SYNTHETIC"],
            "clock_start_primary": "assignment", "threshold_seconds": 600,
            "assignment_policy": policy, "seed": 42, "include_case_outcomes": True,
            "cases": cases, "roster": {"roster_ref": "r1", "assignments": lines}}


@pytest.fixture(scope="module")
def out_validator(load):
    return Draft202012Validator(load("simulator.output.schema.json"),
                                format_checker=FormatChecker())


@pytest.fixture(scope="module")
def in_validator(load):
    return Draft202012Validator(load("simulator.input.schema.json"),
                                format_checker=FormatChecker())


@pytest.mark.parametrize("policy", ["nearest", "scorer", "replay_actual"])
def test_output_validates(policy, out_validator, in_validator):
    req = day(policy=policy)
    in_validator.validate(req)
    out = handle(req)
    out_validator.validate(out)
    assert out["illustrative"] is True and out["assignment_policy"] == policy


def test_example_input_validates(load, out_validator):
    req = load("examples/simulator.input.json")
    out = handle(req)
    out_validator.validate(out)
    assert out["overall"]["field_case_count"] == 4


def test_conservation_and_readings():
    req = day(n_cases=200, n_surv=3)
    out = handle(req)
    o = out["overall"]
    assert o["case_count"] == 200
    assert o["field_case_count"] + o["remote_case_count"] == 200
    served = sum(1 for c in out["case_outcomes"] if c["served"])
    assert served + out["unserved_cases"] == o["field_case_count"]
    assert o["from_registration"]["case_count"] == o["from_assignment"]["case_count"] \
        == o["field_case_count"]
    z = out["zones"][0]["service_level"]
    assert z["field_case_count"] == o["field_case_count"]
    iv = out["intervals"]
    assert sum(i["service_level"]["case_count"] for i in iv) == 200
    assert sum(i["service_level"]["from_assignment"]["within_count"] for i in iv) \
        == o["from_assignment"]["within_count"]
    for k in ("from_registration", "from_assignment"):
        r = o[k]
        assert r["within_count"] <= r["case_count"]
        assert r["share"] == pytest.approx(r["within_count"] / r["case_count"], abs=1e-6)
    # the registration reading can never beat the assignment reading
    assert o["from_registration"]["within_count"] <= o["from_assignment"]["within_count"]
    for c in out["case_outcomes"]:
        if c["served"]:
            assert c["registered_to_arrived_seconds"] >= c["assigned_to_arrived_seconds"] - 1


def test_unserved_when_nobody_on_duty():
    req = day(n_cases=20, n_surv=1, hours=8)
    req["roster"]["assignments"][0]["end_at"] = iso(DAY + timedelta(hours=7))
    out = handle(req)
    assert out["unserved_cases"] > 0
    assert out["overall"]["from_assignment"]["within_count"] < out["overall"]["field_case_count"]


def test_deterministic_and_input_untouched():
    req = day(on_scene=None)
    before = copy.deepcopy(req)
    a, b = handle(req), handle(req)
    for x in (a, b):
        x.pop("generated_at")
    assert a == b and req == before


def test_queueing_when_busy():
    req = day(n_cases=60, n_surv=1, hours=1)
    _, warn = handle_with_warnings(req)
    assert any("waited in the queue" in w and not w.startswith("0 ") for w in warn)


def recorded_day(seed=3):
    rnd = random.Random(seed)
    req = day(n_cases=100, n_surv=20, policy="replay_actual", seed=seed, on_scene=1200)
    req["cases"].sort(key=lambda c: c["registered_at"])
    ids = [ln["agent_id"] for ln in req["roster"]["assignments"]]
    start = {ln["agent_id"]: (ln["start_latitude"], ln["start_longitude"])
             for ln in req["roster"]["assignments"]}
    pos = dict(start)
    k = 0
    for c in req["cases"]:
        if c["handling"] != "field":
            continue
        sid = ids[k % len(ids)]
        k += 1
        reg = datetime.fromisoformat(c["registered_at"])
        asg = reg + timedelta(seconds=rnd.randint(5, 90))
        p = (c["latitude"], c["longitude"])
        travel = core.haversine_km(pos[sid], p) * 1.3 / 40 * 3600 * rnd.uniform(0.92, 1.08)
        pos[sid] = p
        c["actual_agent_id"] = sid
        c["actual_assigned_at"] = iso(asg)
        c["actual_arrived_at"] = iso(asg + timedelta(seconds=travel))
    return req


def test_replay_actual_reproduces_recorded():
    # recorded times follow the pure travel model
    req = recorded_day()
    out, warn = handle_with_warnings(req, PLAIN)
    msgs = [w for w in warn if w.startswith("replay deviation")]
    assert msgs and all("met" in m and "NOT met" not in m for m in msgs)
    # direct check against the recorded times
    rec = sorted(
        (datetime.fromisoformat(c["actual_arrived_at"])
         - datetime.fromisoformat(c["actual_assigned_at"])).total_seconds()
        for c in req["cases"] if c["handling"] == "field")
    sim = out["overall"]["assigned_to_arrived"]["median_seconds"]
    rm = core.quantile(rec, 0.5)
    assert abs(sim - rm) / rm <= 0.10
    rs = sum(1 for x in rec if x <= 600) / len(rec)
    assert abs(out["overall"]["from_assignment"]["share"] - rs) <= 0.05
    # recorded agents and assignment times are reproduced
    by = {c["case_id"]: c for c in req["cases"]}
    for o in out["case_outcomes"]:
        assert o["agent_id"] == by[o["case_id"]]["actual_agent_id"]
        assert datetime.fromisoformat(o["assigned_at"]) == \
            datetime.fromisoformat(by[o["case_id"]]["actual_assigned_at"])


def test_replay_without_recorded_times_has_no_deviation():
    req = recorded_day()
    for c in req["cases"]:
        c.pop("actual_arrived_at", None)
    _, warn = handle_with_warnings(req)
    assert not any(w.startswith("replay deviation") for w in warn)


def strip(out):
    o = copy.deepcopy(out)
    for k in ("generated_at", "model_version", "assignment_policy"):
        o.pop(k)
    return o


def test_scorer_asks_the_assignment_engine(monkeypatch):
    import opendispatch_engines.assignment as engine
    calls = []
    real = engine.rank

    def spy(req, *a, **k):
        calls.append(req)
        return real(req, *a, **k)

    monkeypatch.setattr(engine, "rank", spy)
    req = day(policy="scorer")
    out, warn = handle_with_warnings(req)
    field = out["overall"]["field_case_count"]
    assert len(calls) >= field - out["unserved_cases"]
    assert all(r["case"]["zone_id"] == ZONE and r["candidates"] for r in calls)
    assert any(w.startswith("scorer: ") for w in warn)


def test_scorer_follows_the_engine_pick(monkeypatch):
    import opendispatch_engines.assignment as engine
    req = day(n_cases=40, n_surv=5, policy="scorer")
    last = sorted(ln["agent_id"] for ln in req["roster"]["assignments"])[-1]

    def fake(r, *a, **k):
        ok = [c for c in r["candidates"] if c["agent_id"] == last]
        return {"status": "ranked", "ranking": [{"agent_id": last}]} if ok \
            else {"status": "no_eligible_agent", "ranking": []}

    monkeypatch.setattr(engine, "rank", fake)
    out = handle(req)
    picked = {c["agent_id"] for c in out["case_outcomes"] if c["served"]}
    assert picked == {last}


def test_scorer_falls_back_to_nearest(monkeypatch):
    import opendispatch_engines.assignment as engine
    monkeypatch.setattr(engine, "rank", lambda r, *a, **k: {
        "status": "no_eligible_agent", "ranking": []})
    n, _ = handle_with_warnings(day(policy="nearest"))
    s, warn = handle_with_warnings(day(policy="scorer"))
    assert strip(n) == strip(s)
    assert any("fell back to nearest" in w and not w.endswith(" 0 fell back to nearest")
               for w in warn)


def test_scorer_serves_at_least_as_many_cases():
    n = handle(day(n_cases=300, n_surv=15, policy="nearest"))
    s = handle(day(n_cases=300, n_surv=15, policy="scorer"))
    assert n["overall"]["field_case_count"] == s["overall"]["field_case_count"]
    assert s["unserved_cases"] <= n["unserved_cases"]
    assert strip(n) != strip(s)


def test_remote_lines_are_not_field_capacity():
    req = day(n_cases=20, n_surv=1, hours=8)
    req["roster"]["assignments"][0]["end_at"] = iso(DAY + timedelta(hours=7))
    alone = handle(req)
    remote = dict(req["roster"]["assignments"][0], zone_id=None,
                  agent_id=str(uuid.UUID(int=1)),
                  end_at=iso(DAY + timedelta(hours=20)))
    req["roster"]["assignments"].append(remote)
    out, warn = handle_with_warnings(req)
    assert out["unserved_cases"] == alone["unserved_cases"] > 0
    assert out["overall"]["agent_utilisation"] == alone["overall"]["agent_utilisation"]
    assert any("not field capacity" in w for w in warn)


def test_zone_factor_slows_only_its_zone():
    from opendispatch_engines.simulator.params import PLAIN
    req = day(n_cases=120, n_surv=8, on_scene=600)
    base, _ = handle_with_warnings(req, PLAIN)
    slow, _ = handle_with_warnings(req, PLAIN.with_(speed_factor_by_zone=((ZONE, 0.5),)))
    other, _ = handle_with_warnings(req, PLAIN.with_(speed_factor_by_zone=((ZONE2, 0.5),)))
    k = "assigned_to_arrived"
    assert slow["overall"][k]["median_seconds"] > base["overall"][k]["median_seconds"] * 1.5
    assert strip(other) == strip(base)


def test_more_agents_never_worse_median():
    prev = None
    for n in (2, 4, 6, 8, 12, 16):
        req = day(n_cases=250, n_surv=n, seed=11)
        # same first agents each time: roster grows by superset
        base = day(n_cases=250, n_surv=16, seed=11)
        req["roster"]["assignments"] = base["roster"]["assignments"][:n]
        out, _ = handle_with_warnings(req, PLAIN)
        m = out["overall"]["registered_to_arrived"]["median_seconds"]
        if prev is not None:
            assert m <= prev + 1e-6, (n, m, prev)
        prev = m


def test_performance_1500_cases():
    req = day(n_cases=1500, n_surv=60, hours=14, on_scene=None)
    req["include_case_outcomes"] = False
    t = time.perf_counter()
    out = handle(req)
    dt = time.perf_counter() - t
    assert out["overall"]["case_count"] == 1500
    assert dt < 10, dt


def test_handle_returns_coded_warnings():
    out = handle(recorded_day())
    assert all(set(w) == {"code", "message"} for w in out["warnings"])
    assert any(w["code"] == "REPLAY_DEVIATION" for w in out["warnings"])
