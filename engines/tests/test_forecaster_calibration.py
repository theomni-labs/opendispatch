# SPDX-License-Identifier: AGPL-3.0-only
"""Forecaster ensemble-2: event effects from one occurrence, Ramadan
hours, sparse event flags and range calibration.

Every number comes from a SYNTHETIC generator with known truth.
"""
import copy
import math
import random
import uuid
from datetime import date, datetime, timedelta, timezone

import test_forecaster_v2 as T
from opendispatch_engines.forecaster import ensemble, handle
from opendispatch_engines.forecaster import profile as P

TZ = timezone(timedelta(hours=3))
START = date(2026, 3, 2)  # a Monday
EID_TRUTH = 0.55
RAM_DAY, RAM_NIGHT = 0.6, 1.5
SHAPE = [0.2 + 2.0 * math.exp(-((s / 4 - 9) ** 2) / 8) + 2.4 * math.exp(-((s / 4 - 17) ** 2) / 10) for s in range(96)]


def _world(seed=5, weeks=52, horizon=7, eid=(), ram=(), nat=(), explicit_events=True, scale=0.8):
    """Year of history; eid, ram and nat are day indexes."""
    rng = random.Random(seed)
    zones, subs = [], []
    for z in range(4):
        ss = [str(uuid.UUID(int=0xD000 + z * 10 + k)) for k in range(3)]
        zones.append({"zone_id": str(uuid.UUID(int=0xE000 + z)), "sub_zones": [{"sub_zone_id": s} for s in ss]})
        subs += ss
    h0 = weeks * 7
    cal, rows, actual = [], [], []
    truth = {}
    for i in range(h0 + horizon):
        d = START + timedelta(days=i)
        e = {"date": d.isoformat(), "is_holiday": False, "is_ramadan": i in ram}
        ev = []
        if i in eid:
            ev.append({"type": "eid"})
        if i in nat:
            ev.append({"type": "national_day"})
        if ev or explicit_events:
            e["events"] = ev
        cal.append(e)
        for k, sid in enumerate(subs):
            for s in range(96):
                h = s // 4
                m = EID_TRUTH if i in eid else 1.0
                if i in nat:
                    m *= 1.4
                if i in ram:
                    m *= RAM_DAY if 8 <= h <= 16 else (RAM_NIGHT if h >= 20 or h <= 2 else 1.0)
                lam = scale * (1 + 0.5 * (k % 3)) * SHAPE[s] * T.DOW[i % 7] * m
                n = T._poisson(rng, lam)
                ts = datetime(d.year, d.month, d.day, h, s % 4 * 15, tzinfo=TZ).isoformat()
                r = {"sub_zone_id": sid, "interval_start": ts, "cases_total": n, "cases_field": round(n * 0.6)}
                (rows if i < h0 else actual).append(r)
                truth[(sid, ts)] = lam
    req = {
        "schema_version": "1.0", "request_id": str(uuid.UUID(int=2)), "requested_at": "2027-03-01T02:00:00+03:00",
        "data_source": "SYNTHETIC", "input_data_sources": ["SYNTHETIC"],
        "horizon": {"start_date": (START + timedelta(days=h0)).isoformat(), "days": horizon},
        "model": {"model_version": "m", "range_coverage": 0.8},
        "zones": zones, "calendar": cal, "history": {"records": rows},
    }
    return req, actual, truth


def test_single_occurrence_event_in_52_weeks():
    # one 3-day Eid, 40 weeks before the horizon
    eid = set(range(30, 33)) | {52 * 7 + 2}
    req, _, _ = _world(eid=eid, scale=0.1)
    e = ensemble.run(req)["debug"]["effects"]
    print("SYNTHETIC single Eid effect", round(e["event_eid"], 3), "truth", EID_TRUTH)
    assert abs(e["event_eid"] / EID_TRUTH - 1) < 0.12


def test_old_event_gets_forecast_dip():
    eid = set(range(100, 103)) | {52 * 7 + 2}
    req, actual, truth = _world(eid=eid)
    out = handle(req)
    day = (START + timedelta(days=52 * 7 + 2)).isoformat()
    est = sum(v["expected"] for v in out["values"] if v["interval_start"][:10] == day)
    tru = sum(x for (s, ts), x in truth.items() if ts[:10] == day)
    print(f"SYNTHETIC Eid day total forecast {est:.0f} truth {tru:.0f}")
    assert abs(est / tru - 1) < 0.12


def test_sparse_events_key_means_no_events():
    # the Go builder omits `events` on ordinary days
    eid = set(range(100, 103)) | {52 * 7 + 2}
    full, _, _ = _world(eid=eid, horizon=3)
    sparse, _, _ = _world(eid=eid, horizon=3, explicit_events=False)
    a, b = handle(full), handle(sparse)
    for x in (a, b):
        x.pop("generated_at")
    assert [v["expected"] for v in a["values"]] == [v["expected"] for v in b["values"]]
    assert "event_eid" in b["model_info"]["feature_set"]


def test_no_events_anywhere_is_unknown():
    req, _, _ = _world(horizon=2)
    for c in req["calendar"]:
        c.pop("events")
    out = handle(req)
    assert not any(f.startswith("event_") for f in out["model_info"]["feature_set"])


def _calendar_model(req):
    raw, _, _ = P._load(req, {s["sub_zone_id"] for z in req["zones"] for s in z["sub_zones"]})
    ctx = ensemble._Ctx(req, raw)
    start = date.fromisoformat(req["horizon"]["start_date"]).toordinal()
    g = ensemble._glm_predict(ctx, None, [start + i for i in range(req["horizon"]["days"])], True)
    pred = {}
    for sid, days in g["pred"].items():
        for o, arr in days.items():
            d = date.fromordinal(o)
            for s, x in enumerate(arr):
                pred[(sid, datetime(d.year, d.month, d.day, s // 4, s % 4 * 15, tzinfo=TZ).isoformat())] = x
    return pred


def test_ramadan_hours_do_not_leak_after_ramadan():
    ram = set(range(300, 329))
    req, actual, truth = _world(weeks=48, ram=ram, horizon=7)
    pred = _calendar_model(req)
    est = sum(pred.values())
    tru = sum(truth[k] for k in pred)
    # hours 9 to 15 are where Ramadan is lowest
    day_est = sum(x for (s, ts), x in pred.items() if 9 <= int(ts[11:13]) <= 15)
    day_tru = sum(truth[k] for k in pred if 9 <= int(k[1][11:13]) <= 15)
    print(f"SYNTHETIC after Ramadan: total {est / tru:.3f}, daytime {day_est / day_tru:.3f} of truth")
    assert abs(est / tru - 1) < 0.06
    assert abs(day_est / day_tru - 1) < 0.04


def test_ramadan_horizon_has_night_peak():
    ram = set(range(300, 329)) | set(range(48 * 7, 48 * 7 + 3))
    req, _, truth = _world(weeks=48, ram=ram, horizon=3)
    out = handle(req)
    pred = {}
    for v in out["values"]:
        pred[(v["sub_zone_id"], v["interval_start"])] = v["expected"]
    night = sum(x for (s, ts), x in pred.items() if int(ts[11:13]) in (21, 22, 23))
    night_t = sum(truth[k] for k in pred if int(k[1][11:13]) in (21, 22, 23))
    day = sum(x for (s, ts), x in pred.items() if 9 <= int(ts[11:13]) <= 15)
    day_t = sum(truth[k] for k in pred if 9 <= int(k[1][11:13]) <= 15)
    print(f"SYNTHETIC Ramadan hours: night {night / night_t:.3f}, day {day / day_t:.3f} of truth")
    assert abs(night / night_t - 1) < 0.15
    assert abs(day / day_t - 1) < 0.15


def _zone_hour_cov(req, actual, out):
    zone_of = {s["sub_zone_id"]: z["zone_id"] for z in req["zones"] for s in z["sub_zones"]}
    lo, hi, y = {}, {}, {}
    for v in out["values"]:
        k = (zone_of[v["sub_zone_id"]], v["interval_start"][:13])
        lo[k] = lo.get(k, 0.0) + v["low"]
        hi[k] = hi.get(k, 0.0) + v["high"]
    for r in actual:
        k = (zone_of[r["sub_zone_id"]], r["interval_start"][:13])
        y[k] = y.get(k, 0) + r["cases_total"]
    return sum(lo[k] - 1e-9 <= y[k] <= hi[k] + 1e-9 for k in lo), len(lo)


def test_range_calibrated_on_validation_and_out_of_sample():
    hit = n = 0
    for seed in (1, 2, 3):
        req, actual, _ = _world(seed=seed, weeks=12, horizon=14, scale=0.3)
        res = ensemble.run(copy.deepcopy(req))
        v = res["debug"]["range_cov_validation"]
        print(f"SYNTHETIC seed {seed}: validation coverage {v:.3f}")
        assert 0.75 <= v <= 0.85
        h, m = _zone_hour_cov(req, actual, handle(req))
        hit, n = hit + h, n + m
    print(f"SYNTHETIC out-of-sample zone-hour coverage {hit / n:.3f}")
    assert 0.72 <= hit / n <= 0.90


def test_range_invariants_and_poisson_floor():
    req, _, _ = _world(weeks=10, horizon=2, scale=0.05)
    out = handle(req)
    assert any(v["high"] > v["expected"] for v in out["values"])
    for v in out["values"]:
        assert 0 <= v["low"] <= v["expected"] <= v["high"]


def test_deterministic_with_new_model():
    req, _, _ = _world(weeks=12, horizon=2)
    a, b = handle(copy.deepcopy(req)), handle(copy.deepcopy(req))
    for x in (a, b):
        x.pop("generated_at")
    assert a == b
