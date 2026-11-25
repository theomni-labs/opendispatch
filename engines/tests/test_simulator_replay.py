# SPDX-License-Identifier: AGPL-3.0-only
"""replay held-out SYNTHETIC days tolerance.

Ground truth: tests/data/sim_groundtruth, written by the opendispatch
generator (scripts/synthetic/sim-groundtruth.ts). Days 1-7 train
the parameters (fitted.py); days 8-14 are held out. Synthetic only:
no claim about the customer's real outcomes.
"""
import os

import pytest
from jsonschema import Draft202012Validator, FormatChecker

from opendispatch_engines.simulator import handle, replay_report
from opendispatch_engines.simulator.calibrate import fit, load_days
from opendispatch_engines.simulator.params import DEFAULTS, PLAIN

DATA = os.path.join(os.path.dirname(__file__), "data", "sim_groundtruth")
TRAIN = 7


@pytest.fixture(scope="module")
def train():
    return load_days(DATA, 0, TRAIN)


@pytest.fixture(scope="module")
def held_out():
    days = load_days(DATA, TRAIN)
    assert len(days) == 7
    return days


def merged(days):
    cases = [c for d in days for c in d["cases"]]
    seen, lines = set(), []
    for d in days:
        for a in d["roster"]["assignments"]:
            k = (a["agent_id"], a["start_at"])
            if k not in seen:
                seen.add(k)
                lines.append(a)
    return dict(days[0], cases=cases,
                roster={"roster_ref": "held-out", "assignments": lines})


def within(d):
    return all(abs(d[k]["median_dev_pct"]) <= 10 and abs(d[k]["share_pp"]) <= 5
               for k in ("from_assignment", "from_registration"))


def test_ground_truth_validates(load, held_out):
    v = Draft202012Validator(load("simulator.input.schema.json"),
                             format_checker=FormatChecker())
    for d in held_out[:1]:
        v.validate(d)
        assert d["data_source"] == "SYNTHETIC"
        assert d["assignment_policy"] == "replay_actual"


def test_defaults_are_the_training_fit(train):
    assert fit(train) == DEFAULTS


def test_each_held_out_day_within_tolerance(held_out):
    for d in held_out:
        rep = replay_report(d)[None]
        assert rep["cases"] > 700
        assert within(rep), (d["roster"]["roster_ref"], rep)


def test_held_out_week_within_tolerance(held_out):
    rep = replay_report(merged(held_out))[None]
    assert within(rep), rep
    a = rep["from_assignment"]
    # mean response time, reported alongside
    assert abs(a["simulated_mean"] - a["recorded_mean"]) / a["recorded_mean"] <= 0.10


def test_sampled_on_scene_still_within_tolerance(held_out):
    days = [dict(d, cases=[{k: v for k, v in c.items() if k != "on_scene_seconds"}
                           for c in d["cases"]]) for d in held_out]
    assert within(replay_report(merged(days))[None])


def test_uncalibrated_model_misses(held_out):
    assert not within(replay_report(merged(held_out), PLAIN)[None])


def _per_zone(rep):
    return {z: (round(d["from_assignment"]["median_dev_pct"], 1),
                round(d["from_assignment"]["share_pp"], 1),
                round(d["from_registration"]["median_dev_pct"], 1),
                round(d["from_registration"]["share_pp"], 1))
            for z, d in rep.items() if z is not None}


def test_held_out_week_per_zone_within_tolerance(held_out):
    rep = replay_report(merged(held_out))
    zones = {z: d for z, d in rep.items() if z is not None}
    assert len(zones) == 8
    assert all(within(d) for d in zones.values()), _per_zone(rep)


@pytest.mark.parametrize("seed", [2, 3, 4])
def test_per_zone_holds_for_other_seeds(held_out, seed):
    rep = replay_report(merged([dict(d, seed=seed) for d in held_out]))
    assert all(within(d) for z, d in rep.items()), _per_zone(rep)


def test_zone_factors_are_fitted_per_zone():
    zf = dict(DEFAULTS.speed_factor_by_zone)
    assert len(zf) == 8
    assert max(zf.values()) / min(zf.values()) > 1.2


def test_without_zone_factors_some_zone_misses(held_out):
    flat = DEFAULTS.with_(speed_factor_by_zone=())
    rep = replay_report(merged(held_out), flat)
    assert not all(within(d) for z, d in rep.items() if z is not None)


def test_output_carries_both_clocks_and_deviation(held_out):
    out = handle(held_out[0])
    o = out["overall"]
    assert o["from_registration"]["case_count"] == o["from_assignment"]["case_count"]
    assert out["illustrative"] is True
    assert out["model_version"] == "des-replay_actual-0.3"
    assert any(w["code"] == "REPLAY_DEVIATION" for w in out["warnings"])
