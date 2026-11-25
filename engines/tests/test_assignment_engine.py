# SPDX-License-Identifier: AGPL-3.0-only
import copy
import json
import random
import time
import uuid
from datetime import datetime, timedelta

import pytest
from jsonschema import Draft202012Validator, FormatChecker

from opendispatch_engines.assignment import handle

NOW = datetime.fromisoformat("2026-09-14T09:12:01+03:00")
ZONE = "091ff2b2-f0e1-4b97-bfc9-7cdd0698c32a"
OTHER_ZONE = "0595d130-3c2c-44a7-85b5-b315bb4f4519"
CASE_LAT, CASE_LON = 24.70, 46.70


def iso(t):
    return t.isoformat()


def cand(i, **kw):
    c = {
        "agent_id": str(uuid.UUID(int=i + 1)),
        "status": "available",
        "latitude": CASE_LAT + 0.01 * (i + 1),
        "longitude": CASE_LON,
        "position_at": iso(NOW - timedelta(seconds=10)),
        "roster_zone_id": ZONE,
        "shift_end_at": iso(NOW + timedelta(hours=5)),
        "skills": ["general"],
        "has_vehicle": True,
        "cases_today": 1,
    }
    c.update(kw)
    return c


def req(cands, **kw):
    r = {
        "schema_version": "1.0",
        "request_id": str(uuid.UUID(int=999)),
        "requested_at": iso(NOW),
        "data_source": "SYNTHETIC",
        "now": iso(NOW),
        "top_n": 5,
        "case": {"case_id": str(uuid.UUID(int=998)), "registered_at": iso(NOW),
                 "zone_id": ZONE, "latitude": CASE_LAT, "longitude": CASE_LON,
                 "handling": "field", "required_skills": []},
        "candidates": cands,
    }
    r.update(kw)
    return r


@pytest.fixture(scope="module")
def out_validator(load):
    return Draft202012Validator(load("assignment.output.schema.json"),
                                format_checker=FormatChecker())


def test_output_validates(out_validator, load):
    out = handle(load("examples/assignment.input.json"))
    out_validator.validate(out)
    assert out["illustrative"] is True and out["status"] == "ranked"
    out2 = handle(req([cand(0), cand(1, status="offline")],
                      prayer_window={"name": "dhuhr",
                                     "starts_at": iso(NOW), "ends_at": iso(NOW + timedelta(hours=1))}))
    out_validator.validate(out2)


def excl(c, request_kw=None, case_kw=None):
    r = req([c], **(request_kw or {}))
    r["case"].update(case_kw or {})
    out = handle(r)
    return out


def test_exclusion_codes(out_validator):
    t = NOW
    cases = {
        "OFFLINE": cand(0, status="offline"),
        "ON_BREAK": cand(0, status="on_break", on_break_until=iso(t + timedelta(minutes=10))),
        "BUSY": cand(0, status="en_route", busy_until=iso(t + timedelta(hours=1))),
        "STALE_POSITION": cand(0, position_at=iso(t - timedelta(hours=1))),
        "MISSING_SKILL": cand(0, skills=["general"]),
        "NO_VEHICLE": cand(0, has_vehicle=False),
        "OFF_SHIFT": cand(0, shift_end_at=iso(t + timedelta(minutes=20))),
    }
    for code, c in cases.items():
        kw = {"required_skills": ["towing"]} if code == "MISSING_SKILL" else {}
        out = excl(c, case_kw=kw)
        out_validator.validate(out)
        assert out["status"] == "no_eligible_agent", code
        assert out["excluded"][0]["exclusion_code"] == code
        assert out["excluded"][0]["text"]
    # break due before arrival clashes
    out = excl(cand(0, next_break_due_at=iso(t + timedelta(seconds=30))))
    assert out["excluded"][0]["exclusion_code"] == "ON_BREAK"
    # busy without busy_until
    out = excl(cand(0, status="on_scene"))
    assert out["excluded"][0]["exclusion_code"] == "BUSY"


def test_eligible_edge_cases():
    t = NOW
    out = handle(req([cand(0, status="en_route", busy_until=iso(t + timedelta(minutes=5)))]))
    assert out["status"] == "ranked"
    assert "FINISHING_CURRENT_CASE" in out["ranking"][0]["reason_codes"]
    r = req([cand(0, has_vehicle=False)])
    r["case"]["handling"] = "remote_inferred"
    assert handle(r)["status"] == "ranked"
    out = handle(req([cand(0, next_break_due_at=iso(t + timedelta(minutes=20)))]))
    assert "BREAK_DUE_SOON" in out["ranking"][0]["reason_codes"]


def test_closer_is_better():
    cs = [cand(i) for i in (3, 0, 2, 1)]
    out = handle(req(cs))
    secs = [r["estimated_travel_seconds"] for r in out["ranking"]]
    assert secs == sorted(secs)
    assert out["ranking"][0]["agent_id"] == cs[1]["agent_id"]
    assert "NEAREST_BY_TRAVEL_TIME" in out["ranking"][0]["reason_codes"]
    assert [r["rank"] for r in out["ranking"]] == [1, 2, 3, 4]
    assert all(0 <= r["score"] <= 1 for r in out["ranking"])


def test_other_factors():
    a = cand(0, cases_today=6)
    b = cand(0, cases_today=0, agent_id=str(uuid.UUID(int=77)))
    assert handle(req([a, b]))["ranking"][0]["agent_id"] == b["agent_id"]
    a = cand(0, roster_zone_id=OTHER_ZONE)
    b = cand(0, agent_id=str(uuid.UUID(int=77)))
    out = handle(req([a, b]))
    assert out["ranking"][0]["agent_id"] == b["agent_id"]
    assert "OUTSIDE_ROSTER_ZONE" in out["ranking"][1]["reason_codes"]
    win = {"name": "asr", "starts_at": iso(NOW), "ends_at": iso(NOW + timedelta(minutes=5))}
    near = cand(0, latitude=CASE_LAT + 0.001)
    far = cand(1, latitude=CASE_LAT + 0.03)
    out = handle(req([near, far], prayer_window=win))
    assert "PRAYER_TIME_SOON" in out["ranking"][1]["reason_codes"]
    assert out["ranking"][0]["agent_id"] == far["agent_id"]


@pytest.mark.parametrize("window", ["absent", None])
def test_prayer_penalty_off_without_a_window(window):
    near = cand(0, latitude=CASE_LAT + 0.001)
    far = cand(1, latitude=CASE_LAT + 0.03)
    kw = {} if window == "absent" else {"prayer_window": None}
    out = handle(req([near, far], **kw))
    assert out["ranking"][0]["agent_id"] == near["agent_id"]
    assert all("PRAYER_TIME_SOON" not in r["reason_codes"] for r in out["ranking"])


def test_already_assigned_ranks_nothing(out_validator):
    r = req([cand(0)])
    r["case"]["existing_assignment_id"] = str(uuid.UUID(int=5))
    out = handle(r)
    out_validator.validate(out)
    assert out["status"] == "already_assigned" and out["ranking"] == []


def test_no_candidates(out_validator):
    out = handle(req([]))
    out_validator.validate(out)
    assert out["status"] == "no_eligible_agent"


def test_deterministic():
    cs = [cand(i, cases_today=i % 3) for i in range(30)]
    a, b = handle(req(cs)), handle(req(copy.deepcopy(cs)))
    for o in (a, b):
        o.pop("generated_at"), o.pop("decision_time_ms")
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def rand_cands(rng, n):
    out = []
    for i in range(n):
        out.append(cand(
            i, latitude=CASE_LAT + rng.uniform(-0.2, 0.2),
            longitude=CASE_LON + rng.uniform(-0.2, 0.2),
            status=rng.choice(["available"] * 5 + ["en_route", "on_break", "offline"]),
            busy_until=iso(NOW + timedelta(seconds=rng.randint(0, 900))),
            cases_today=rng.randint(0, 9),
            roster_zone_id=rng.choice([ZONE, OTHER_ZONE])))
    return out


def test_performance_p99(out_validator):
    rng = random.Random(1)
    times = []
    for _ in range(1000):
        t0 = time.perf_counter()
        handle(req(rand_cands(rng, 60)))
        times.append((time.perf_counter() - t0) * 1000)
    # includes request generation, so conservative
    times.sort()
    print(f"p99 decision ms: {times[989]:.2f}")
    assert times[989] < 200


def test_500_candidates_inside_deadline(out_validator):
    rng = random.Random(2)
    out = handle(req(rand_cands(rng, 500), decision_deadline_ms=2000))
    out_validator.validate(out)
    assert out["decision_time_ms"] < 2000 and out["deadline_exceeded"] is False


def test_deadline_exceeded_returns_partial(out_validator):
    rng = random.Random(3)
    out = handle(req(rand_cands(rng, 20000), decision_deadline_ms=50))
    out_validator.validate(out)
    assert out["deadline_exceeded"] is True
    assert out["decision_time_ms"] < 100
    if out["status"] == "ranked":
        assert "Partial" in out["ranking"][0]["reason_text"]
