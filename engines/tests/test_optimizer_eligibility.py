# SPDX-License-Identifier: AGPL-3.0-only
import copy

import pytest

from opendispatch_engines.optimizer import cpsat, handle
from test_optimizer_cpsat import U, _short, _small, _strict_rules
from test_optimizer_engine import _validate

MODELS = ["greedy-ls-0.3", pytest.param("cpsat-1", marks=pytest.mark.skipif(
    cpsat.load() is None, reason="ortools not installed"))]
PAT_A, PAT_B, PAT_M = U % 0xf1, U % 0xf2, U % 0xf3


def _req(model, elig, n=4):
    req = _small(n, n)
    req["objective"]["model_version"] = model
    for i, s in enumerate(req["agents"]):
        ids = elig.get(i)
        if ids is not None:
            s["eligible_shift_pattern_ids"] = ids
    return req


def _pats(out):
    return {a["agent_id"]: a["shift_pattern_id"] for a in out["roster_assignments"]}


@pytest.mark.parametrize("model", MODELS)
def test_each_agent_works_only_an_eligible_pattern(load, model):
    req = _req(model, {0: [PAT_A], 1: [PAT_A], 2: [PAT_B], 3: [PAT_B, PAT_M]})
    out = handle(copy.deepcopy(req))
    _validate(load, out)
    _strict_rules(req, out)
    elig = {s["agent_id"]: s["eligible_shift_pattern_ids"] for s in req["agents"]}
    got = _pats(out)
    assert got and all(p in elig[s] for s, p in got.items())
    assert _short(out) == 0


@pytest.mark.parametrize("model", MODELS)
def test_eligibility_leaves_a_gap_it_cannot_fill(load, model):
    only_a = _req(model, {i: [PAT_A] for i in range(4)})
    free = _req(model, {})
    a, b = handle(copy.deepcopy(only_a)), handle(copy.deepcopy(free))
    for r, o in ((only_a, a), (free, b)):
        _validate(load, o)
        _strict_rules(r, o)
    assert set(_pats(a).values()) == {PAT_A}
    assert _short(b) == 0 < _short(a)
    assert a["status"] == "partial"


@pytest.mark.parametrize("model", MODELS)
def test_no_usable_eligible_pattern_is_never_rostered(load, model):
    other = U % 0xfff
    req = _req(model, {0: [other], 1: []})
    out = handle(copy.deepcopy(req))
    _validate(load, out)
    _strict_rules(req, out)
    got = _pats(out)
    assert req["agents"][0]["agent_id"] not in got
    assert req["agents"][1]["agent_id"] not in got
    assert len(got) == 2


@pytest.mark.parametrize("model", MODELS)
def test_absent_eligibility_allows_every_pattern_of_the_kind(load, model):
    req = _req(model, {}, n=6)
    out = handle(copy.deepcopy(req))
    _validate(load, out)
    _strict_rules(req, out)
    assert len(set(_pats(out).values())) >= 2
