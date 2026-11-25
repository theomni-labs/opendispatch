# SPDX-License-Identifier: AGPL-3.0-only
"""Forecaster v2 (ensemble-3) tests.

Every number here comes from a SYNTHETIC generator with known
ground truth. Nothing says anything about real accuracy.
"""
import copy
import math
import random
import time
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from jsonschema import Draft202012Validator, FormatChecker

from opendispatch_engines.forecaster import handle
from opendispatch_engines.forecaster import ensemble
from opendispatch_engines.forecaster.profile import forecast as v1_forecast

TZ = timezone(timedelta(hours=3))
START = date(2026, 1, 5)  # a Monday
HIST_WEEKS = 26
H0 = HIST_WEEKS * 7  # day index of the horizon start
TRUTH = {"payday": 1.25, "school_break": 0.80, "eid": 0.55, "national_day": 1.35, "hajj": 1.30}
TREND = 0.015
DOW = [1.0, 1.0, 1.05, 1.1, 0.8, 0.6, 0.9]
SCALES = [1.0, 0.4, 0.03]  # big, mid, sparse sub-zone
EID = set(range(70, 73)) | set(range(130, 133))
NATIONAL = {45, 120, H0 + 5}
HAJJ = set(range(100, 107))
SCHOOL_OFF = set(range(140, 161))
PAYDAY = {i for i in range(H0 + 8) if i % 28 in (16, 17)}


def _poisson(rng, lam):
    if lam > 30:
        return max(0, round(rng.gauss(lam, math.sqrt(lam))))
    limit, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= limit:
            return k
        k += 1


def _truth_mult(i):
    m = 1.0
    if i in PAYDAY:
        m *= TRUTH["payday"]
    if i in SCHOOL_OFF:
        m *= TRUTH["school_break"]
    if i in EID:
        m *= TRUTH["eid"]
    if i in NATIONAL:
        m *= TRUTH["national_day"]
    if i in HAJJ:
        m *= TRUTH["hajj"]
    return m


def _lam(i, k, s):
    """Noise-free ground-truth rate: day i, sub-zone k, 15-min slot s."""
    h = s / 4
    shape = 0.2 + 2.0 * math.exp(-((h - 9) ** 2) / 8) + 2.4 * math.exp(-((h - 17) ** 2) / 10)
    return SCALES[k % 3] * shape * DOW[i % 7] * (1 + TREND) ** (i // 7) * _truth_mult(i)


def _truth_error(world_, pred, keep_subs=None, keep_days=None):
    err = tot = 0.0
    idx = {s: k for k, s in enumerate(world_["subs"])}
    for r in world_["actual"]:
        sid, ts = r["sub_zone_id"], r["interval_start"]
        if keep_subs and sid not in keep_subs or keep_days and ts[:10] not in keep_days:
            continue
        i = (date.fromisoformat(ts[:10]) - START).days
        lam = _lam(i, idx[sid], int(ts[11:13]) * 4 + int(ts[14:16]) // 15)
        err += abs(pred[(sid, ts)]["expected"] - lam)
        tot += lam
    return err / tot


def _gen(seed=11, n_zones=3, horizon_days=7, weeks=HIST_WEEKS, calendar_fields=("payday", "school", "events")):
    rng = random.Random(seed)
    zones, subs, zone_of = [], [], {}
    for z in range(n_zones):
        zid = str(uuid.UUID(int=0xA000 + z))
        ss = [str(uuid.UUID(int=0xB000 + z * 10 + k)) for k in range(3)]
        zones.append({"zone_id": zid, "sub_zones": [{"sub_zone_id": s} for s in ss]})
        for s in ss:
            zone_of[s] = zid
        subs += ss
    h0 = weeks * 7
    ndays = h0 + horizon_days
    cal, rows, actual, event_day = [], [], [], set()
    pt = {"fajr": "04:30", "dhuhr": "11:50", "asr": "15:20", "maghrib": "18:05", "isha": "19:30"}
    for i in range(ndays):
        d = START + timedelta(days=i)
        e = {"date": d.isoformat(), "is_holiday": i in EID or i in NATIONAL, "is_ramadan": False, "prayer_times": pt}
        if "payday" in calendar_fields:
            e["is_payday"] = i in PAYDAY
        if "school" in calendar_fields:
            e["school_in_session"] = i not in SCHOOL_OFF
        if "events" in calendar_fields:
            ev = []
            if i in EID:
                ev.append({"type": "eid"})
            if i in NATIONAL:
                ev.append({"type": "national_day"})
            if i in HAJJ:
                ev.append({"type": "hajj"})
            e["events"] = ev
        cal.append(e)
        if i >= h0 and (i in PAYDAY or i in NATIONAL):
            event_day.add(d.isoformat())
    for i in range(ndays):
        d = START + timedelta(days=i)
        w = i // 7
        shock = math.exp(rng.gauss(0, 0.04))
        for sid in subs:
            sc = SCALES[subs.index(sid) % 3]
            for s in range(96):
                h = s / 4
                shape = 0.2 + 2.0 * math.exp(-((h - 9) ** 2) / 8) + 2.4 * math.exp(-((h - 17) ** 2) / 10)
                lam = sc * shape * DOW[i % 7] * (1 + TREND) ** w * _truth_mult(i) * shock
                n = _poisson(rng, lam)
                ts = datetime(d.year, d.month, d.day, s // 4, s % 4 * 15, tzinfo=TZ).isoformat()
                r = {"sub_zone_id": sid, "interval_start": ts, "cases_total": n, "cases_field": round(n * 0.6)}
                (rows if i < h0 else actual).append(r)
    req = {
        "schema_version": "1.0", "request_id": str(uuid.UUID(int=1)),
        "requested_at": "2026-07-13T02:00:00+03:00", "data_source": "SYNTHETIC",
        "input_data_sources": ["SYNTHETIC"],
        "horizon": {"start_date": (START + timedelta(days=h0)).isoformat(), "days": horizon_days},
        "model": {"model_version": "m", "range_coverage": 0.8},
        "zones": zones, "calendar": cal, "history": {"records": rows},
    }
    return req, actual, rows, event_day, subs


@pytest.fixture(scope="module")
def world():
    req, actual, rows, event_day, subs = _gen()
    t = time.perf_counter()
    out = handle(req)
    return {"req": req, "actual": actual, "rows": rows, "events": event_day, "subs": subs, "out": out,
            "secs": time.perf_counter() - t}


def _validate(load, out):
    Draft202012Validator(load("forecaster.output.schema.json"), format_checker=FormatChecker()).validate(out)


def _by_key(values):
    return {(v["sub_zone_id"], v["interval_start"]): v for v in values}


def _wape(pred, actual, keep=None, key="expected"):
    err = tot = 0.0
    for r in actual:
        if keep and r["interval_start"][:10] not in keep:
            continue
        p = pred[(r["sub_zone_id"], r["interval_start"])]
        err += abs(r["cases_total"] - (p[key] if isinstance(p, dict) else p))
        tot += r["cases_total"]
    return err / tot


def _wape_city_hourly(pred, actual, keep=None):
    act, est = {}, {}
    for r in actual:
        d = r["interval_start"]
        if keep and d[:10] not in keep:
            continue
        k = d[:13]
        act[k] = act.get(k, 0) + r["cases_total"]
        est[k] = est.get(k, 0.0) + pred[(r["sub_zone_id"], d)]["expected"]
    return sum(abs(act[k] - est[k]) for k in act) / sum(act.values())


def _naive(rows, actual):
    last = {(r["sub_zone_id"], r["interval_start"]): r["cases_total"] for r in rows}
    out = {}
    for r in actual:
        prev = (datetime.fromisoformat(r["interval_start"]) - timedelta(days=7)).isoformat()
        out[(r["sub_zone_id"], r["interval_start"])] = last[(r["sub_zone_id"], prev)]
    return out


def _v1(req):
    values, _ = v1_forecast(copy.deepcopy(req))
    return _by_key(values)


def test_output_valid_and_invariants(load, world):
    out, req = world["out"], world["req"]
    _validate(load, out)
    assert out["model_version"] == "ensemble-4"
    assert out["engine"]["version"] == "0.7.0"
    assert out["illustrative"] is True
    assert len(out["values"]) == 7 * 96 * 9
    seen = set()
    for v in out["values"]:
        assert 0 <= v["low"] <= v["expected"] <= v["high"]
        assert abs(v["field_expected"] + v["remote_inferred_expected"] - v["expected"]) <= 0.01
        t = datetime.fromisoformat(v["interval_start"])
        assert v["interval_index"] == t.hour * 4 + t.minute // 15
        seen.add((v["sub_zone_id"], v["interval_start"]))
    assert len(seen) == len(out["values"])
    mi = out["model_info"]
    assert mi["history_days"] == H0
    assert mi["training_start"] == START.isoformat()
    assert mi["training_end"] == (START + timedelta(days=H0 - 1)).isoformat()
    for f in ("hour_of_week", "weekly_trend", "payday", "school_break", "event_eid", "event_hajj", "event_national_day", "holiday"):
        assert f in mi["feature_set"]
    assert "event_umrah" not in mi["feature_set"]


def test_deterministic(world):
    a = handle(copy.deepcopy(world["req"]))
    b = world["out"]
    for x in (a, b):
        x = x.pop("generated_at")
    assert a == b


def test_effect_recovery(world):
    # SYNTHETIC truth; stated tolerance 10% on each total effect
    res = ensemble.run(copy.deepcopy(world["req"]))
    e = res["debug"]["effects"]
    got = {
        "payday": e["payday"],
        "school_break": e["school_break"],
        "eid": e["holiday"] * e["event_eid"],
        "national_day": e["holiday"] * e["event_national_day"],
        "hajj": e["event_hajj"],
    }
    errs = {k: abs(got[k] / TRUTH[k] - 1) for k in TRUTH}
    print("effect recovery relative errors", {k: round(v, 3) for k, v in errs.items()})
    for k, v in errs.items():
        assert v < 0.10, (k, got[k], TRUTH[k])
    assert abs(res["debug"]["trend_per_week"] - math.log(1 + TREND)) < 0.01
    dm = sum(DOW) / 7
    for f, t in zip(res["debug"]["dow_factors"], DOW):
        assert abs(f / (t / dm) - 1) < 0.08


def test_beats_naive_and_v1(world):
    pred = _by_key(world["out"]["values"])
    ens = _wape(pred, world["actual"])
    nv = _naive(world["rows"], world["actual"])
    naive = _wape(nv, world["actual"])
    v1 = _v1(world["req"])
    ens_ev = _wape(pred, world["actual"], world["events"])
    v1_ev = _wape(v1, world["actual"], world["events"])
    v1_all = _wape(v1, world["actual"])
    print(f"SYNTHETIC WAPE all: ensemble={ens:.3f} naive={naive:.3f} v1={v1_all:.3f}; "
          f"event days: ensemble={ens_ev:.3f} v1={v1_ev:.3f}")
    hr_ev, hr_v1 = _wape_city_hourly(pred, world["actual"], world["events"]), _wape_city_hourly(v1, world["actual"], world["events"])
    print(f"SYNTHETIC city-hourly WAPE on event days: ensemble={hr_ev:.3f} v1={hr_v1:.3f}")
    t_ens, t_v1 = _truth_error(world, pred, keep_days=world["events"]), _truth_error(world, v1, keep_days=world["events"])
    print(f"SYNTHETIC error vs noise-free truth on event days: ensemble={t_ens:.3f} v1={t_v1:.3f}")
    assert ens <= 0.9 * naive
    assert ens_ev < v1_ev
    assert t_ens < 0.9 * t_v1
    assert hr_ev < hr_v1


def test_range_coverage(world):
    pred = _by_key(world["out"]["values"])
    n = c = 0
    for r in world["actual"]:
        p = pred[(r["sub_zone_id"], r["interval_start"])]
        c += p["low"] <= r["cases_total"] <= p["high"]
        n += 1
    print(f"SYNTHETIC 80% range coverage: {c / n:.3f}")
    assert 0.60 <= c / n <= 0.95


def test_pooling_helps_sparse_subzones(world):
    # error against the noise-free truth, sparse sub-zones only
    sparse = {s for i, s in enumerate(world["subs"]) if i % 3 == 2}
    err = {}
    for pooling in (True, False):
        res = ensemble.run(copy.deepcopy(world["req"]), pooling=pooling)
        err[pooling] = _truth_error(world, _by_key(res["values"]), keep_subs=sparse)
    print(f"SYNTHETIC sparse sub-zone error vs truth pooled={err[True]:.3f} unpooled={err[False]:.3f}")
    assert err[True] < err[False]


def test_weak_locations_surfaced(world):
    w = [x for x in world["out"]["warnings"] if x["code"] == "WEAK_LOCATIONS"]
    assert w and "weak" in w[0]["message"]
    assert len(world["out"]["warnings"][0]["message"]) <= 500


def test_no_history_for_event_types_gives_effect_one():
    req, *_ = _gen(horizon_days=3)
    req = copy.deepcopy(req)
    base = handle(copy.deepcopy(req))
    for c in req["calendar"][-3:]:
        c["events"] = [{"type": t} for t in ("umrah", "season_event", "other")]
    out = handle(req)
    codes = {w["code"] for w in out["warnings"]}
    assert {"NO_UMRAH_HISTORY", "NO_SEASON_EVENT_HISTORY", "NO_OTHER_HISTORY"} <= codes
    assert not any(f in out["model_info"]["feature_set"] for f in ("event_umrah", "event_other"))
    assert [v["expected"] for v in out["values"]] == [v["expected"] for v in base["values"]]


def test_unknown_is_not_false_on_horizon():
    req, *_ = _gen(horizon_days=3)
    day = START + timedelta(days=H0 + 2)  # a payday
    assert (H0 + 2) in PAYDAY

    def level(mode):
        r = copy.deepcopy(req)
        for c in r["calendar"]:
            if c["date"] == day.isoformat():
                if mode == "unknown":
                    del c["is_payday"]
                else:
                    c["is_payday"] = mode == "true"
        out = handle(r)
        return sum(v["expected"] for v in out["values"] if v["interval_start"][:10] == day.isoformat())

    lo, mid, hi = level("false"), level("unknown"), level("true")
    print(f"SYNTHETIC payday day totals false={lo:.0f} unknown={mid:.0f} true={hi:.0f}")
    assert lo < mid < hi


def test_unknown_history_days_do_not_bias_effect():
    req, *_ = _gen()
    req = copy.deepcopy(req)
    cut = START + timedelta(days=H0 // 2)
    for c in req["calendar"]:
        if date.fromisoformat(c["date"]) < cut:
            c.pop("is_payday", None)
    e = ensemble.run(req)["debug"]["effects"]["payday"]
    assert abs(e / TRUTH["payday"] - 1) < 0.12


def test_short_history_falls_back_to_profile(load):
    req, *_ = _gen(weeks=6, horizon_days=2)
    out = handle(req)
    _validate(load, out)
    codes = {w["code"] for w in out["warnings"]}
    assert {"SHORT_HISTORY", "ENSEMBLE_FALLBACK"} <= codes
    v1 = _v1(req)
    for v in out["values"]:
        assert v["expected"] == v1[(v["sub_zone_id"], v["interval_start"])]["expected"]
    assert out["model_info"]["history_days"] == 42


def test_no_history_subzone(load):
    req, *_ = _gen(horizon_days=2)
    req = copy.deepcopy(req)
    ghost = str(uuid.UUID(int=0xFFFF))
    req["zones"][0]["sub_zones"].append({"sub_zone_id": ghost})
    out = handle(req)
    _validate(load, out)
    assert any(w["code"] == "NO_HISTORY_SUBZONE" for w in out["warnings"])
    g = [v for v in out["values"] if v["sub_zone_id"] == ghost]
    assert len(g) == 2 * 96 and sum(v["expected"] for v in g) > 0
    assert any(w["code"] == "WEAK_LOCATIONS" for w in out["warnings"])


def test_no_history_at_all():
    req, *_ = _gen(horizon_days=1)
    req = copy.deepcopy(req)
    req["history"]["records"] = []
    out = handle(req)
    assert all(v["expected"] == 0 for v in out["values"])
    assert out["warnings"][0]["code"] == "NO_HISTORY"
    assert out["model_info"]["history_days"] == 0


def test_performance_36_zones_10_days(load):
    # about 217k history rows, 10-day horizon, real size
    base = load("examples/forecaster.input.json")
    req, _, rows, _, _ = _gen(n_zones=1, weeks=3, horizon_days=1)
    src = [x["sub_zone_id"] for x in req["zones"][0]["sub_zones"]]
    by_sub = {k: [r for r in rows if r["sub_zone_id"] == k] for k in src}
    zones, hist = [], []
    cal = list(req["calendar"])
    start = START + timedelta(days=21)
    for i in range(10):
        d = start + timedelta(days=i)
        if not any(c["date"] == d.isoformat() for c in cal):
            cal.append({"date": d.isoformat(), "is_holiday": False, "is_ramadan": False})
    for z in range(36):
        sz = [str(uuid.UUID(int=0xC00000 + z * 10 + k)) for k in range(3)]
        zones.append({"zone_id": str(uuid.UUID(int=0xA00000 + z)), "sub_zones": [{"sub_zone_id": s} for s in sz]})
        for k, s in enumerate(sz):
            hist += [{**r, "sub_zone_id": s} for r in by_sub[src[k]]]
    big = {**base, "zones": zones, "calendar": cal, "history": {"records": hist},
           "horizon": {"start_date": start.isoformat(), "days": 10}}
    t = time.perf_counter()
    out = handle(big)
    dt = time.perf_counter() - t
    print(f"36 zones x 3 sub-zones, 10 days, {len(hist)} history rows (3 weeks): {dt:.2f}s")
    assert len(out["values"]) == 36 * 3 * 96 * 10
    assert dt < 3.0
    _validate(load, out)


def test_performance_36_zones_long_history(load):
    # 10 weeks of history so the full ensemble runs
    base = load("examples/forecaster.input.json")
    req, _, rows, _, _ = _gen(n_zones=1, weeks=10, horizon_days=1)
    src = [x["sub_zone_id"] for x in req["zones"][0]["sub_zones"]]
    by_sub = {k: [r for r in rows if r["sub_zone_id"] == k] for k in src}
    zones, hist = [], []
    start = START + timedelta(days=70)
    cal = list(req["calendar"])
    for i in range(1, 10):
        d = start + timedelta(days=i)
        cal.append({"date": d.isoformat(), "is_holiday": False, "is_ramadan": False})
    for z in range(36):
        sz = [str(uuid.UUID(int=0xC00000 + z * 10 + k)) for k in range(3)]
        zones.append({"zone_id": str(uuid.UUID(int=0xA00000 + z)), "sub_zones": [{"sub_zone_id": s} for s in sz]})
        for k, s in enumerate(sz):
            hist += [{**r, "sub_zone_id": s} for r in by_sub[src[k]]]
    big = {**base, "zones": zones, "calendar": cal, "history": {"records": hist},
           "horizon": {"start_date": start.isoformat(), "days": 10}}
    t = time.perf_counter()
    out = handle(big)
    dt = time.perf_counter() - t
    print(f"36 zones x 3 sub-zones, 10 days, {len(hist)} history rows (10 weeks): {dt:.2f}s")
    assert out["model_info"]["feature_set"].count("weekly_trend") == 1
    assert not any(w["code"] == "ENSEMBLE_FALLBACK" for w in out.get("warnings", []))
    assert dt < 10.0
