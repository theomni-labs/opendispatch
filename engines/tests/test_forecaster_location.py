# SPDX-License-Identifier: AGPL-3.0-only
"""Forecaster location distributions on SYNTHETIC counts with known hot spots.

Nothing here says anything about real places or real accuracy.
"""
import copy
import random
import time
import uuid

from jsonschema import Draft202012Validator, FormatChecker

import test_forecaster_engine as E
from opendispatch_engines.forecaster import handle, location

B32 = "0123456789bcdefghjkmnpqrstuvwxyz"
GROUPS = location.DAY_GROUPS
DAYS = {"weekday": 4, "thursday": 1, "friday": 1, "saturday": 1}


def _cells(n, prefix="th"):
    out = []
    for i in range(n):
        a, b = divmod(i, 32 * 32)
        b, c = divmod(b, 32)
        out.append(prefix + B32[a % 32] + B32[b] + B32[c] + B32[i % 7])
    return out


def _truth(cells, h, g):
    # hot spots move by hour and day group
    w = [1.0] * len(cells)
    w[3] += 5
    if g == "weekday" and 6 <= h <= 9:
        w[0] += 40
    if 15 <= h <= 19:
        w[1] += 40
    if g in ("friday", "saturday") and (h >= 20 or h <= 2):
        w[2] += 60
    s = sum(w)
    return [x / s for x in w]


def _records(sub, cells, weeks, seed, per_hour=3.0):
    rng = random.Random(seed)
    recs = []
    for h in range(24):
        for g in GROUPS:
            n = int(per_hour * DAYS[g] * weeks)
            got = {}
            for c in rng.choices(cells, weights=_truth(cells, h, g), k=n):
                got[c] = got.get(c, 0) + 1
            recs += [{"sub_zone_id": sub, "cell_id": c, "hour": h, "day_group": g, "cases": k} for c, k in sorted(got.items())]
    return recs


def _request(subs_cells, weeks=8, seed=3):
    req, *_ = E._split()
    req["zones"] = [{"zone_id": E.ZONE, "sub_zones": [{"sub_zone_id": s} for s in subs_cells]}]
    recs = []
    for i, (sub, cells) in enumerate(subs_cells.items()):
        recs += _records(sub, cells, weeks, seed + i)
    req["history"]["location_records"] = recs
    return req


def _sub(i):
    return str(uuid.UUID(int=0xC000 + i))


def _by_group(dist):
    return {(d["sub_zone_id"], d["hour"], d["day_group"]): {c["cell_id"]: c["probability"] for c in d["cells"]} for d in dist}


def _tv(p, cells, truth):
    return 0.5 * sum(abs(p.get(c, 0.0) - t) for c, t in zip(cells, truth))


def test_absent_records_unchanged_forecast(load):
    req, *_ = E._split()
    base = handle(req)
    assert "location_distributions" not in base
    assert location.FEATURE not in base["model_info"]["feature_set"]
    with_loc = copy.deepcopy(req)
    cells = _cells(30)
    with_loc["history"]["location_records"] = _records(req["zones"][0]["sub_zones"][0]["sub_zone_id"], cells, 2, 1)
    Draft202012Validator(load("forecaster.input.schema.json"), format_checker=FormatChecker()).validate(with_loc)
    out = handle(with_loc)
    E._validate(load, out)
    assert out["values"] == base["values"]
    assert out.get("warnings") == base.get("warnings")
    assert out["model_info"]["feature_set"] == base["model_info"]["feature_set"] + [location.FEATURE]
    rest = {k: v for k, v in out["model_info"].items() if k != "feature_set"}
    assert rest == {k: v for k, v in base["model_info"].items() if k != "feature_set"}
    assert len(out["location_distributions"]) == 96


def test_recovers_moving_hot_spots():
    cells = _cells(120)
    sub = _sub(1)
    dist = _by_group(location.distributions(_request({sub: cells})))
    tv, tv_raw = [], []
    recs = _records(sub, cells, 8, 3)
    for h in range(24):
        for g in GROUPS:
            truth = _truth(cells, h, g)
            p = dist[(sub, h, g)]
            if max(truth) > 0.2:
                assert max(p, key=lambda c: (p[c], c)) == cells[truth.index(max(truth))]
            tv.append(_tv(p, cells, truth))
            raw = {r["cell_id"]: r["cases"] for r in recs if r["hour"] == h and r["day_group"] == g}
            n = sum(raw.values())
            tv_raw.append(_tv({c: k / n for c, k in raw.items()}, cells, truth))
    mean, mean_raw = sum(tv) / len(tv), sum(tv_raw) / len(tv_raw)
    print(f"\nlocation TV distance: shrunk {mean:.3f}, raw group shares {mean_raw:.3f} (SYNTHETIC)")
    assert mean < 0.6 * mean_raw
    assert mean < 0.3


def test_sums_to_one_and_cap():
    many = _cells(600, "tk")
    req = _request({_sub(2): many, _sub(3): _cells(50)}, weeks=12)
    dist = location.distributions(req)
    assert len(dist) == 2 * 96
    for d in dist:
        ps = [c["probability"] for c in d["cells"]]
        assert abs(sum(ps) - 1) < 1e-9
        assert all(0 <= p <= 1 for p in ps)
        ids = [c["cell_id"] for c in d["cells"]]
        assert ids == sorted(ids)
        assert len(d["cells"]) <= location.MAX_CELLS
    assert max(len(d["cells"]) for d in dist if d["sub_zone_id"] == _sub(2)) == location.MAX_CELLS


def test_min_count_and_deterministic():
    sub = _sub(4)
    req = _request({sub: _cells(40)}, weeks=4)
    req["history"]["location_records"].append({"sub_zone_id": sub, "cell_id": "thzzzzz", "hour": 3, "day_group": "friday", "cases": 1})
    a = location.distributions(req)
    assert all(c["cell_id"] != "thzzzzz" for d in a for c in d["cells"])
    shuffled = copy.deepcopy(req)
    random.Random(9).shuffle(shuffled["history"]["location_records"])
    assert location.distributions(shuffled) == a
    req["history"]["location_records"] = [{"sub_zone_id": sub, "cell_id": "thzzzzz", "hour": 3, "day_group": "friday", "cases": 1}]
    only = location.distributions(req)
    assert only[0]["cells"] == [{"cell_id": "thzzzzz", "probability": 1.0}]


def test_unknown_sub_zones_and_empty_list():
    req, *_ = E._split()
    req["history"]["location_records"] = [{"sub_zone_id": _sub(99), "cell_id": "thabcd", "hour": 1, "day_group": "weekday", "cases": 5}]
    assert location.distributions(req) == []
    req["history"]["location_records"] = []
    assert location.distributions(req) == []


def test_performance_36_zones():
    cells = _cells(200)
    zones, recs = [], []
    for z in range(36):
        subs = [str(uuid.UUID(int=(z << 16) + s + 1)) for s in range(3)]
        zones.append({"zone_id": str(uuid.UUID(int=(z << 16))), "sub_zones": [{"sub_zone_id": s} for s in subs]})
        for i, s in enumerate(subs):
            for h in range(24):
                for g in GROUPS:
                    recs += [{"sub_zone_id": s, "cell_id": c, "hour": h, "day_group": g, "cases": 1 + (k * 7 + h + i) % 5}
                             for k, c in enumerate(cells) if k < 5 or (k + 3 * h + i) % 7 == 0]
    req = {"zones": zones, "history": {"records": [], "location_records": recs}}
    t0 = time.perf_counter()
    dist = location.distributions(req)
    took = time.perf_counter() - t0
    print(f"\nlocation 36x3x24x4x200 ({len(recs)} records): {took:.2f}s")
    assert len(dist) == 36 * 3 * 96
    assert all(len(d["cells"]) == 200 for d in dist)
    assert took < 2.0
