# SPDX-License-Identifier: AGPL-3.0-only
import dataclasses
import os
import uuid
from datetime import datetime, timedelta

import pytest
from jsonschema import Draft202012Validator, FormatChecker

from opendispatch_engines.assignment import DEFAULT_WEIGHTS, DemandCell, Weights, handle, peak, rank
from opendispatch_engines.simulator.core import Sim
from opendispatch_engines.travel import TravelModel

NOW = datetime.fromisoformat("2026-09-14T09:12:01+03:00")
ZONE = "091ff2b2-f0e1-4b97-bfc9-7cdd0698c32a"
OTHER = "0595d130-3c2c-44a7-85b5-b315bb4f4519"
LAT, LON = 24.70, 46.70


def iso(t):
    return t.isoformat()


def cand(i, dlat=0.0, dlon=0.0, **kw):
    c = {"agent_id": str(uuid.UUID(int=i + 1)), "status": "available",
         "latitude": LAT + dlat, "longitude": LON + dlon,
         "position_at": iso(NOW), "roster_zone_id": ZONE,
         "shift_end_at": iso(NOW + timedelta(hours=6)), "skills": ["general"],
         "has_vehicle": True, "cases_today": 1}
    c.update(kw)
    return c


def req(cands, **kw):
    r = {"schema_version": "1.0", "request_id": str(uuid.UUID(int=999)),
         "requested_at": iso(NOW), "data_source": "SYNTHETIC", "now": iso(NOW),
         "top_n": 5,
         "case": {"case_id": str(uuid.UUID(int=998)), "registered_at": iso(NOW),
                  "zone_id": ZONE, "latitude": LAT, "longitude": LON,
                  "handling": "field", "required_skills": []},
         "candidates": cands}
    r.update(kw)
    return r


@pytest.fixture(scope="module")
def out_validator(load):
    return Draft202012Validator(load("assignment.output.schema.json"),
                                format_checker=FormatChecker())


def test_weights_are_named_and_frozen():
    names = {f.name for f in dataclasses.fields(Weights)}
    assert {"travel", "wait", "coverage", "workload_seconds_per_case", "prayer_seconds",
            "strip_seconds", "max_wait_seconds"} <= names
    with pytest.raises(dataclasses.FrozenInstanceError):
        DEFAULT_WEIGHTS.travel = 2.0


def test_travel_model_is_the_simulators():
    tm = TravelModel({"average_speed_kmh": 40, "detour_factor": 1.3})
    sim = Sim({"travel_model": {"average_speed_kmh": 40, "detour_factor": 1.3},
               "cases": [], "roster": {"assignments": []}})
    a, b = (24.70, 46.70), (24.75, 46.62)
    assert tm.seconds(*a, *b) == pytest.approx(sim.travel(a, b), rel=1e-12)
    assert TravelModel(None).speed == 40.0


def test_finishing_nearby_beats_free_far(out_validator):
    busy = cand(0, 0.005, status="on_scene", busy_until=iso(NOW + timedelta(minutes=2)))
    far = cand(1, 0.12)
    out = handle(req([far, busy]))
    out_validator.validate(out)
    top = out["ranking"][0]
    assert top["agent_id"] == busy["agent_id"]
    assert "FINISHING_CURRENT_CASE" in top["reason_codes"]


def test_coverage_keeps_the_only_cover_of_a_hotspot(out_validator):
    a = cand(0, 0.01)
    b = cand(1, -0.01)
    hot = [DemandCell(LAT + 0.05, LON, 3.0)]
    plain = rank(req([a, b]))
    looked = rank(req([a, b]), demand=hot)
    out_validator.validate(looked)
    assert plain["ranking"][0]["agent_id"] == a["agent_id"]
    assert looked["ranking"][0]["agent_id"] == b["agent_id"]
    assert "keeps cover" in looked["ranking"][0]["reason_text"]
    off = rank(req([a, b]), dataclasses.replace(DEFAULT_WEIGHTS, coverage=0), hot)
    assert off["ranking"][0]["agent_id"] == a["agent_id"]


def test_does_not_strip_another_zone():
    lone = cand(0, 0.004, roster_zone_id=OTHER)
    home = cand(1, 0.006)
    out = handle(req([lone, home]))
    assert out["ranking"][0]["agent_id"] == home["agent_id"]
    assert "last free agent" in out["ranking"][1]["reason_text"]


def test_already_assigned_ignores_demand(out_validator):
    r = req([cand(0)])
    r["case"]["existing_assignment_id"] = str(uuid.UUID(int=5))
    out = rank(r, demand=[DemandCell(LAT, LON, 1.0)])
    out_validator.validate(out)
    assert out["status"] == "already_assigned" and out["ranking"] == []


def test_peak_p99_inside_deadline(out_validator):
    lat, exceeded = peak.in_process(n=300, rate=0)
    p99 = peak._pct(lat, 0.99)
    print(f"peak p99 decision ms: {p99:.1f} over {len(lat)} cases, "
          f"{peak.ZONES * peak.FIELD_PER_ZONE} candidates each")
    assert exceeded == 0
    assert p99 < 2000
    r, cells = peak.requests(1)[0]
    out_validator.validate(rank(r, demand=cells))


FIXTURES = os.environ.get("OPENDISPATCH_FIXTURES_DIR", "../fixtures")


@pytest.mark.skipif(not os.path.isdir(os.path.join(FIXTURES, "cases")),
                    reason="synthetic fixtures not found (set OPENDISPATCH_FIXTURES_DIR)")
def test_harness_replays_a_synthetic_day():
    from opendispatch_engines.assignment import harness
    demand = harness.demand_model(FIXTURES, ["2026-09-06"])
    near = harness.run_day(FIXTURES, "2026-09-10", "nearest")
    sc = harness.run_day(FIXTURES, "2026-09-10", "scorer", demand=demand)
    assert near["field_cases"] == sc["field_cases"] > 0
    assert near["served"] == sc["served"]
    for m in (near, sc):
        assert m["reg_p90"] >= m["reg_p50"] > 0
        assert 0 <= m["within_reg"] <= 1 and 0 <= m["within_asg"] <= 1
    assert sc["decisions"] >= sc["field_cases"] - sc["fallbacks"]


def test_reposition_spreads_idle_over_demand():
    from opendispatch_engines.assignment.reposition import Reposition, plan
    cells = [(LAT, LON, 1.0), (LAT + 0.1, LON, 1.0), (LAT + 0.05, LON, 0.0)]
    here = (LAT + 0.05, LON)
    idle = [("a", here, here), ("b", here, here)]
    moves = dict(plan(idle, cells, Reposition(max_move_km=0.0)))
    assert sorted(moves.values()) == [(LAT, LON), (LAT + 0.1, LON)]
    assert plan(idle, cells, Reposition(max_move_km=1.0)) == []  # 5.6 km away
    assert plan([], cells) == [] and plan(idle, []) == []


def test_reposition_skips_short_moves_and_is_deterministic():
    from opendispatch_engines.assignment.reposition import Reposition, plan
    cells = [(LAT, LON, 2.0), (LAT + 0.2, LON + 0.2, 1.0)]
    near = (LAT + 0.005, LON)
    far = (LAT + 0.19, LON + 0.2)
    idle = [("b", near, near), ("a", far, far)]
    s = Reposition(min_move_km=2.0, max_move_km=0.0)
    assert plan(idle, cells, s) == []
    assert plan(idle, cells, s) == plan(list(reversed(idle)), cells, s)


def test_reposition_round_is_fast_at_peak():
    ms, moves = peak.reposition_round()
    print(f"reposition all {peak.ZONES} zones: {ms:.1f} ms, {moves} moves")
    assert ms < 2000 and moves > 0


@pytest.mark.skipif(not os.path.isdir(os.path.join(FIXTURES, "cases")),
                    reason="synthetic fixtures not found (set OPENDISPATCH_FIXTURES_DIR)")
def test_harness_repositions_idle_only():
    from opendispatch_engines.assignment import harness
    train = ["2026-09-06"]
    demand = harness.demand_model(FIXTURES, train)
    cells = harness.cell_model(FIXTURES, train)
    near = harness.run_day(FIXTURES, "2026-09-10", "nearest")
    rp = harness.run_day(FIXTURES, "2026-09-10", "scorer_reposition",
                         demand=demand, cells=cells)
    assert rp["served"] == near["served"] == near["field_cases"]
    assert rp["moves"] > 0 and near["moves"] == 0
    assert rp["decisions"] >= rp["field_cases"] - rp["fallbacks"]
