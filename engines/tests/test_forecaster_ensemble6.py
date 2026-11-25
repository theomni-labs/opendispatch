# SPDX-License-Identifier: AGPL-3.0-only
"""Forecaster ensemble-6: the segment average in quiet zones.

SYNTHETIC worlds with known truth only; nothing here says anything
about real accuracy.
"""
import copy
import random
import uuid
from datetime import date, datetime, timedelta

import pytest
from jsonschema import Draft202012Validator, FormatChecker

import test_forecaster_long_history as LH
import test_forecaster_v2 as T
from opendispatch_engines.forecaster import ensemble, handle

from test_forecaster_engine import _invariants

BUSY, QUIET, GONE = (str(uuid.UUID(int=0xD100 + z)) for z in range(3))
SUBS = {z: [str(uuid.UUID(int=0xD200 + 10 * i + k)) for k in range(n)]
        for i, (z, n) in enumerate(((BUSY, 2), (QUIET, 2), (GONE, 1)))}
SIZE = {BUSY: (70.0, 50.0), QUIET: (4.0, 2.0), GONE: (25.0,)}  # cases a day per sub-zone
GONE_FROM = LH.N_HIST - 300  # then a retired code: almost no cases
CUT = LH.N_HIST - LH.DETAIL
NIGHT = [LH._shape((s / 4 + 12) % 24) for s in range(96)]


def _world(seed=3):
    rng = random.Random(seed)
    rec, agg = [], []
    for i in range(LH.N_HIST):
        d = LH.START + timedelta(days=i)
        m = LH._mult(d)
        for z, subs in SUBS.items():
            for k, sid in enumerate(subs):
                size = SIZE[z][k] if z != GONE or i < GONE_FROM else 0.05
                sh = NIGHT if k else LH.BASE96
                if i < CUT:
                    n = T._poisson(rng, size * m)
                    if n:
                        ts = datetime(d.year, d.month, d.day, tzinfo=LH.TZ).isoformat()
                        agg.append({"sub_zone_id": sid, "period_start": ts, "period_minutes": 1440,
                                    "cases_total": n, "cases_field": round(n * 0.6)})
                    continue
                for s in range(96):
                    n = T._poisson(rng, size * m * sh[s] / sum(sh))
                    if n:
                        ts = datetime(d.year, d.month, d.day, s // 4, s % 4 * 15, tzinfo=LH.TZ).isoformat()
                        rec.append({"sub_zone_id": sid, "interval_start": ts, "cases_total": n,
                                    "cases_field": round(n * 0.6)})
    req = LH._request(rec, agg)
    req["zones"] = [{"zone_id": z, "sub_zones": [{"sub_zone_id": s} for s in ss]} for z, ss in SUBS.items()]
    return req


@pytest.fixture(scope="module")
def world():
    req = _world()
    return {"req": req, "v5": ensemble.run(copy.deepcopy(req)),
            "v6": ensemble.run(copy.deepcopy(req), low_volume=True)}


def _kind(o):
    d = date.fromordinal(o)
    return {3: "thu", 4: "fri", 5: "sat"}.get(d.weekday(), "wk"), LH._kind(d)


def _expected(req, zone):
    """The segment average from the records alone."""
    h0 = date.fromisoformat(req["horizon"]["start_date"]).toordinal()
    days, slots, first = {}, {}, h0
    for r in req["history"]["records"]:
        o = date.fromisoformat(r["interval_start"][:10]).toordinal()
        first = min(first, o)
        if r["sub_zone_id"] in SUBS[zone]:
            sl = int(r["interval_start"][11:13]) * 4 + int(r["interval_start"][14:16]) // 15
            slots.setdefault((r["sub_zone_id"], o), [0.0] * 96)[sl] += r["cases_total"]
            days[o] = days.get(o, 0) + r["cases_total"]
    for r in req["history"]["aggregated_records"]:
        o = date.fromisoformat(r["period_start"][:10]).toordinal()
        first = min(first, o)
        if r["sub_zone_id"] in SUBS[zone]:
            days[o] = days.get(o, 0) + r["cases_total"]
    out = {}
    for o in range(h0, h0 + req["horizon"]["days"]):
        same = [x for x in range(first, h0) if _kind(x) == _kind(o)]
        level = sum(days.get(x, 0) for x in same) / len(same)
        # no recent day of the kind: the day group's shape
        recent = [x for x in same if x >= h0 - LH.DETAIL]
        recent = recent or [x for x in range(h0 - LH.DETAIL, h0) if _kind(x)[0] == _kind(o)[0]]
        shape = {s: [sum(slots.get((s, x), [0.0] * 96)[i] for x in recent) for i in range(96)] for s in SUBS[zone]}
        t = sum(sum(v) for v in shape.values())
        for s in SUBS[zone]:
            out[(s, o)] = [level * v / t for v in shape[s]]
    return out


def _by_sub(out):
    res = {}
    for v in out["values"]:
        k = (v["sub_zone_id"], date.fromisoformat(v["interval_start"][:10]).toordinal())
        res.setdefault(k, [0.0] * 96)[v["interval_index"]] = v["expected"]
    return res


def _zone_values(out, zone):
    return [v for v in out["values"] if v["zone_id"] == zone]


def test_quiet_zone_takes_the_segment_average(world):
    assert world["v6"]["debug"]["low_volume"] == [QUIET]
    got, want = _by_sub(world["v6"]), _expected(world["req"], QUIET)
    kinds = set()
    for (s, o), arr in want.items():
        kinds.add(_kind(o)[1])
        assert max(abs(a - b) for a, b in zip(got[(s, o)], arr)) < 2e-3, (s, date.fromordinal(o))
    # ordinary days and Ramadan, which has no recent day
    assert kinds == {None, "ramadan"}
    v5 = _by_sub(world["v5"])
    assert any(abs(sum(got[k]) - sum(v5[k])) > 0.1 for k in want)


def test_busy_zone_and_retired_code_keep_ensemble5(world):
    # the retired code's old level is far above its recent one
    for z in (BUSY, GONE):
        assert _zone_values(world["v6"], z) == _zone_values(world["v5"], z)


def test_switch_is_named_and_not_explained(world):
    v5, v6 = world["v5"], world["v6"]
    assert v6["info"]["feature_set"] == v5["info"]["feature_set"] + ["low_volume_segment_average"]
    low = [w for w in v6["warnings"] if w["code"] == "LOW_VOLUME_SEGMENT_AVERAGE"]
    assert len(low) == 1 and low[0]["message"].startswith("1 zone(s) under 20 cases a day") and QUIET in low[0]["message"]
    assert [w for w in v6["warnings"] if w not in low] == v5["warnings"]
    zones = lambda out: {e["zone_id"] for e in out["explanations"]}
    assert zones(v5) == {BUSY, QUIET, GONE} and zones(v6) == {BUSY, GONE}
    assert [e for e in v6["explanations"] if e["zone_id"] == BUSY] == [e for e in v5["explanations"] if e["zone_id"] == BUSY]


def test_same_as_ensemble5_without_quiet_zones(world, monkeypatch):
    monkeypatch.setattr(ensemble, "LOW_VOL", 0.0)
    a = ensemble.run(copy.deepcopy(world["req"]), low_volume=True)
    b = world["v5"]
    assert a["values"] == b["values"] and a["warnings"] == b["warnings"] and a["info"] == b["info"]
    assert a["explanations"] == b["explanations"] and a["debug"]["low_volume"] == []


def test_ensemble6_through_the_contract(load, world):
    req = copy.deepcopy(world["req"])
    req["model"]["model_version"] = "ensemble-6"
    out = handle(req)
    Draft202012Validator(load("forecaster.output.schema.json"), format_checker=FormatChecker()).validate(out)
    _invariants(out, req)
    assert out["model_version"] == "ensemble-6" and out["values"] == world["v6"]["values"]
