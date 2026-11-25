# SPDX-License-Identifier: AGPL-3.0-only
import copy
import math
import random
import time
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from jsonschema import Draft202012Validator, FormatChecker

from opendispatch_engines.forecaster import handle

TZ = timezone(timedelta(hours=3))
ZONE = "3f6f1b1e-7a55-4c27-9d0a-0000000000a1"


def _validate(load, out):
    v = Draft202012Validator(load("forecaster.output.schema.json"), format_checker=FormatChecker())
    v.validate(out)


def _invariants(out, request):
    days = request["horizon"]["days"]
    pairs = {(z["zone_id"], s["sub_zone_id"]) for z in request["zones"] for s in z["sub_zones"]}
    assert len(out["values"]) == days * 96 * len(pairs)
    seen = set()
    for v in out["values"]:
        assert 0 <= v["low"] <= v["expected"] <= v["high"]
        assert v["field_expected"] >= 0 and v["remote_inferred_expected"] >= 0
        assert abs(v["field_expected"] + v["remote_inferred_expected"] - v["expected"]) <= 0.01
        t = datetime.fromisoformat(v["interval_start"])
        assert v["interval_index"] == t.hour * 4 + t.minute // 15
        seen.add((v["zone_id"], v["sub_zone_id"], v["interval_start"]))
    assert len(seen) == len(out["values"])


def _poisson(rng, lam):
    if lam > 30:
        return max(0, round(rng.gauss(lam, math.sqrt(lam))))
    limit, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= limit:
            return k
        k += 1


def _synthetic(weeks=10, n_sub=4, seed=7, trend=0.04, holiday_weeks=(2, 9), horizon_week=None):
    # SYNTHETIC data only: says nothing about real accuracy
    rng = random.Random(seed)
    start = date(2026, 1, 5)
    subs = [str(uuid.UUID(int=0xB000 + i)) for i in range(n_sub)]
    scale = [1.0, 0.7, 1.4, 0.5][:n_sub] + [1.0] * max(0, n_sub - 4)
    dow_f = [1.0, 1.0, 1.05, 1.1, 0.8, 0.6, 0.9]
    cal, rows, truth = [], [], {}
    for w in range(weeks):
        for dd in range(7):
            d = start + timedelta(days=w * 7 + dd)
            hol = w in holiday_weeks and dd == 2
            pt = {"fajr": "04:30", "dhuhr": "11:50", "asr": "15:20", "maghrib": f"18:{(w * 7 + dd) // 8:02d}", "isha": "20:00"}
            cal.append({"date": d.isoformat(), "is_holiday": hol, "is_ramadan": False, "prayer_times": pt})
            lull = {}
            for k, v in pt.items():
                s = int(v[:2]) * 4 + int(v[3:]) // 15
                lull[s] = lull[s + 1] = 0.5
            for si, sid in enumerate(subs):
                for s in range(96):
                    h = s / 4
                    shape = 0.2 + 2.0 * math.exp(-((h - 9) ** 2) / 8) + 2.4 * math.exp(-((h - 17) ** 2) / 10)
                    lam = scale[si] * shape * dow_f[dd] * (1 + trend) ** w * (0.45 if hol else 1.0) * lull.get(s, 1.0)
                    n = _poisson(rng, lam)
                    ts = datetime(d.year, d.month, d.day, s // 4, s % 4 * 15, tzinfo=TZ).isoformat()
                    rows.append({"sub_zone_id": sid, "interval_start": ts, "cases_total": n, "cases_field": round(n * 0.6)})
    return subs, cal, rows, start


def _split(weeks_hist=9, **kw):
    subs, cal, rows, start = _synthetic(**kw)
    cut = datetime.combine(start + timedelta(days=weeks_hist * 7), datetime.min.time(), tzinfo=TZ)
    hist = [r for r in rows if datetime.fromisoformat(r["interval_start"]) < cut]
    target = [r for r in rows if datetime.fromisoformat(r["interval_start"]) >= cut]
    req = {
        "schema_version": "1.0", "request_id": str(uuid.UUID(int=1)),
        "requested_at": "2026-03-09T02:00:00+03:00", "data_source": "SYNTHETIC",
        "input_data_sources": ["SYNTHETIC"],
        "horizon": {"start_date": (start + timedelta(days=weeks_hist * 7)).isoformat(), "days": 7},
        "model": {"model_version": "m", "range_coverage": 0.8},
        "zones": [{"zone_id": ZONE, "sub_zones": [{"sub_zone_id": s} for s in subs]}],
        "calendar": cal, "history": {"records": hist},
    }
    return req, target, rows, cal


def _strip(out):
    out = copy.deepcopy(out)
    out.pop("generated_at")
    return out


def test_example_output_valid(load):
    req = load("examples/forecaster.input.json")
    out = handle(req)
    _validate(load, out)
    _invariants(out, req)
    assert out["illustrative"] is True
    assert out["data_source"] == "SYNTHETIC"
    assert out["input_data_sources"] == ["SYNTHETIC"]
    assert any(w["code"] == "SHORT_HISTORY" for w in out["warnings"])


def test_synthetic_valid_and_deterministic(load):
    req, *_ = _split()
    a, b = handle(req), handle(copy.deepcopy(req))
    _validate(load, a)
    _invariants(a, req)
    assert _strip(a) == _strip(b)
    assert not any(w["code"] == "SHORT_HISTORY" for w in a.get("warnings", []))


def test_measured_data_not_illustrative():
    req, *_ = _split()
    req["data_source"] = "IMPORTED"
    req["input_data_sources"] = ["IMPORTED", "LIVE"]
    assert handle(req)["illustrative"] is False
    req["input_data_sources"] = ["IMPORTED", "SYNTHETIC"]
    assert handle(req)["illustrative"] is True


def test_short_history_warning():
    req, *_ = _split()
    cut = datetime.fromisoformat(req["history"]["records"][-1]["interval_start"]) - timedelta(days=30)
    req["history"]["records"] = [r for r in req["history"]["records"] if datetime.fromisoformat(r["interval_start"]) >= cut]
    out = handle(req)
    codes = [w["code"] for w in out["warnings"]]
    assert "SHORT_HISTORY" in codes
    _invariants(out, req)


def test_no_history_gives_zeros():
    req, *_ = _split()
    req["history"]["records"] = []
    out = handle(req)
    assert all(v["expected"] == 0 for v in out["values"])
    assert out["warnings"][0]["code"] == "NO_HISTORY"


def test_range_coverage_param_widens():
    req, *_ = _split()
    narrow = handle(req)
    req["model"]["range_coverage"] = 0.95
    wide = handle(req)
    w = lambda o: sum(v["high"] - v["low"] for v in o["values"])
    assert w(wide) > w(narrow)


def test_synthetic_backtest_beats_naive_and_covers():
    # SYNTHETIC series with trend, holiday, prayer lull and
    # noise. These numbers say nothing about real accuracy.
    req, target, rows, _ = _split()
    out = handle(req)
    pred = {(v["sub_zone_id"], v["interval_start"]): v for v in out["values"]}
    actual = {(r["sub_zone_id"], r["interval_start"]): r["cases_total"] for r in target}
    last = {(r["sub_zone_id"], r["interval_start"]): r["cases_total"] for r in rows}
    err_e = err_n = tot = covered = n = 0.0
    for (sid, ts), a in actual.items():
        p = pred[(sid, ts)]
        prev = (datetime.fromisoformat(ts) - timedelta(days=7)).isoformat()
        err_e += abs(a - p["expected"])
        err_n += abs(a - last[(sid, prev)])
        tot += a
        covered += p["low"] <= a <= p["high"]
        n += 1
    wape_e, wape_n, cover = err_e / tot, err_n / tot, covered / n
    print(f"synthetic WAPE engine={wape_e:.3f} naive={wape_n:.3f} coverage={cover:.3f}")
    assert wape_e <= 0.9 * wape_n
    assert 0.60 <= cover <= 0.95


def test_performance_36_zones(load):
    base = load("examples/forecaster.input.json")
    subs, cal, rows, start = _synthetic(weeks=6, n_sub=1)
    zones, hist = [], []
    for z in range(36):
        sz = [str(uuid.UUID(int=0xC00000 + z * 10 + k)) for k in range(3)]
        zones.append({"zone_id": str(uuid.UUID(int=0xA00000 + z)), "sub_zones": [{"sub_zone_id": s} for s in sz]})
    req = {**base, "zones": zones, "calendar": cal,
           "horizon": {"start_date": (start + timedelta(days=42)).isoformat(), "days": 1}}
    for z in zones:
        for s in z["sub_zones"]:
            for r in rows:
                if r["interval_start"][:10] >= "2026-01-26":
                    hist.append({**r, "sub_zone_id": s["sub_zone_id"]})
    req["history"] = {"records": hist}
    t = time.perf_counter()
    out = handle(req)
    dt = time.perf_counter() - t
    print(f"36 zones, {len(out['values'])} values, {len(hist)} history rows: {dt:.2f}s")
    assert len(out["values"]) == 36 * 3 * 96
    assert dt < 2.0
    _validate(load, out)
