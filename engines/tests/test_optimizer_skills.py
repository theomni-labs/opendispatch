# SPDX-License-Identifier: AGPL-3.0-only
import copy
from datetime import datetime, timedelta

import pytest

from opendispatch_engines import optimizer as opt
from opendispatch_engines.optimizer import cpsat, handle
from test_optimizer_cpsat import U, ZONE, _short, _small, _strict_rules
from test_optimizer_engine import DAY, _build, _validate
from test_optimizer_reach import _validate_in

MODELS = ["greedy-ls-0.3", pytest.param("cpsat-1", marks=pytest.mark.skipif(
    cpsat.load() is None, reason="ortools not installed"))]
SKILL = "heavy_vehicle"


def _req(model, skilled, reqs=None, n=4):
    req = _small(n, n)
    req["objective"]["model_version"] = model
    for s in req["agents"]:
        if s["agent_id"] in skilled:
            s["skills"] = [SKILL]
    if reqs is not None:
        req["objective"]["skill_requirements"] = reqs
    return req


def _uncovered(req, out, skill=SKILL):
    """Intervals 06-22 with no skill holder on duty."""
    held = {s["agent_id"] for s in req["agents"] if skill in s["skills"]}
    on = [0] * 96
    for a in out["roster_assignments"]:
        if a["agent_id"] not in held:
            continue
        s = (datetime.fromisoformat(a["start_at"]) - DAY) // timedelta(minutes=15)
        e = (datetime.fromisoformat(a["end_at"]) - DAY) // timedelta(minutes=15)
        bs = be = -1
        if a["break_start_at"]:
            bs = (datetime.fromisoformat(a["break_start_at"]) - DAY) // timedelta(minutes=15)
            be = (datetime.fromisoformat(a["break_end_at"]) - DAY) // timedelta(minutes=15)
        for t in range(s, min(e, 96)):
            if not bs <= t < be:
                on[t] += 1
    return sum(1 for t in range(24, 88) if on[t] == 0)


def _skill_viol(out):
    return [v for v in out["violations"] if v["code"] == "SKILL_COVERAGE_GAP"]


@pytest.mark.parametrize("model", MODELS)
def test_skill_holders_go_where_the_skill_is_needed(load, model):
    skilled = {U % 0xd03, U % 0xd04}
    free = _req(model, skilled, n=5)
    need = _req(model, skilled, [{"skill": SKILL, "share": 1.0}], n=5)
    _validate_in(load, need)
    a, b = handle(copy.deepcopy(free)), handle(copy.deepcopy(need))
    for r, o in ((free, a), (need, b)):
        _validate(load, o)
        _strict_rules(r, o)
    assert _short(b) == _short(a)
    assert _uncovered(need, b) <= 4 < _uncovered(free, a)
    v = _skill_viol(b)
    assert len(v) == 1 and v[0]["zone_id"] == ZONE and SKILL in v[0]["message"]
    assert b["status"] == "partial" and not _skill_viol(a)


@pytest.mark.parametrize("model", MODELS)
def test_no_skill_gap_when_everyone_holds_it(load, model):
    everyone = {U % (0xd00 + i) for i in range(4)}
    req = _req(model, everyone, [{"skill": SKILL, "share": 1.0}])
    out = handle(req)
    _validate(load, out)
    assert not _skill_viol(out)
    assert _uncovered(req, out) == _short(out)


@pytest.mark.parametrize("model", MODELS)
def test_no_holder_is_a_gap_and_another_zone_is_ignored(load, model):
    out = handle(_req(model, set(), [{"skill": SKILL, "share": 0.5}]))
    v = _skill_viol(out)
    assert len(v) == 1 and "0 available hold it" in v[0]["message"]
    other = handle(_req(model, set(), [{"skill": SKILL, "share": 1.0, "zone_id": U % 0xa2}]))
    assert not _skill_viol(other)


@pytest.mark.parametrize("model", MODELS)
def test_skills_in_a_bigger_day_keep_the_hard_rules(load, model):
    req = _build(zones=2, field=10, vehicles=10, remote=2, demand=2.0, leave=0, budget=8)
    req["objective"]["model_version"] = model
    for i, s in enumerate(req["agents"]):
        if s["kind"] == "field" and i % 3 == 0:
            s["skills"] = ["general", SKILL]
    base = handle(copy.deepcopy(req))
    req["objective"]["skill_requirements"] = [
        {"skill": SKILL, "share": 0.2, "case_type_id": U % 0xc1},
        {"skill": SKILL, "share": 0.1, "zone_id": req["zone_ids"][0], "case_type_id": U % 0xc2}]
    _validate_in(load, req)
    out = handle(copy.deepcopy(req))
    _validate(load, out)
    for z in req["zone_ids"]:
        def held(o):
            ids = {s["agent_id"] for s in req["agents"] if SKILL in s["skills"]}
            return sum(1 for a in o["roster_assignments"] if a["zone_id"] == z and a["agent_id"] in ids)
        assert held(out) >= held(base)


def test_shares_add_up_and_stop_at_the_requirement():
    req = _small(1, 1)
    for v in req["forecast"]["values"]:
        v.update(low=2, expected=2, high=2, field_expected=2)
    one = [{"skill": "a", "share": 0.3}]
    req["objective"]["skill_requirements"] = one
    reqs = opt._requirements(req, [ZONE])
    assert opt._skill_needs(req, [ZONE], reqs)[ZONE]["a"][30] == 1
    req["objective"]["skill_requirements"] = one + [{"skill": "a", "share": 0.3}]
    assert opt._skill_needs(req, [ZONE], reqs)[ZONE]["a"][30] == 2
    req["objective"]["skill_requirements"] = one * 5
    assert opt._skill_needs(req, [ZONE], reqs)[ZONE]["a"][30] == 2
    assert opt._skill_needs(req, [ZONE], reqs)[ZONE]["a"][0] == 0
