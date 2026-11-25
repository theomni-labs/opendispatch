# SPDX-License-Identifier: AGPL-3.0-only
"""Forecaster ensemble-4: years of aggregated history.

Every number comes from a SYNTHETIC generator with known truth
(Ramadan moving about 11 days a year, Eid, summer school break,
payday, an annual season, growth). Nothing here says anything
about real accuracy.
"""
import copy
import math
import random
import time
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from jsonschema import Draft202012Validator, FormatChecker

import test_forecaster_v2 as T
from opendispatch_engines.forecaster import ensemble, ensemble3, ensemble4, handle

TZ = timezone(timedelta(hours=3))
START = date(2023, 1, 2)
H_START = date(2026, 2, 14)  # Ramadan starts on day 4
N_HIST = (H_START - START).days
DETAIL = 84  # days of 15-minute records
HORIZON = 14
RAMADAN = [date(2023, 3, 23), date(2024, 3, 11), date(2025, 3, 1), date(2026, 2, 18)]
TRUE = {"ramadan": 0.85, "eid": 0.60, "vacation_summer": 0.80, "payday": 1.20}
GROWTH = 0.04  # a year
SEASON = 0.08  # annual amplitude, winter peak
ZS = [1.0, 1.3, 0.7]
SC = [1.0, 0.5, 0.2]
DOW = [1.0, 1.0, 1.05, 1.1, 0.8, 0.6, 0.9]
ZID = [str(uuid.UUID(int=0xE000 + z)) for z in range(3)]
SUBS = [[str(uuid.UUID(int=0xE100 + z * 10 + k)) for k in range(3)] for z in range(3)]
PT = {"fajr": "04:30", "dhuhr": "11:50", "asr": "15:20", "maghrib": "18:05", "isha": "19:30"}


def _shape(h):
    return 0.2 + 2.0 * math.exp(-((h - 9) ** 2) / 8) + 2.4 * math.exp(-((h - 17) ** 2) / 10)


BASE96 = [_shape(s / 4) for s in range(96)]
RAM_G = [1.8 if (s // 4 >= 21 or s // 4 <= 1) else (0.6 if 8 <= s // 4 <= 15 else 1.0) for s in range(96)]
_n = sum(b * g for b, g in zip(BASE96, RAM_G)) / sum(BASE96)
RAM_G = [g / _n for g in RAM_G]


def _kind(d):
    for r in RAMADAN:
        k = (d - r).days
        if 0 <= k < 30:
            return "ramadan"
        if 30 <= k < 33:
            return "eid"
    return None


def _summer(d):
    return (d.month, d.day) >= (6, 20) and d.month <= 8


def _mult(d):
    m = (1 + GROWTH) ** ((d - START).days / 365.25)
    m *= 1 + SEASON * math.cos(2 * math.pi * (d.timetuple().tm_yday - 15) / 365.25)
    k = _kind(d)
    if k:
        m *= TRUE[k]
    if _summer(d):
        m *= TRUE["vacation_summer"]
    if d.day == 27:
        m *= TRUE["payday"]
    return m * DOW[d.weekday()]


def _lam96(z, k, d):
    m = _mult(d) * ZS[z] * SC[k] * 0.8
    g = RAM_G if _kind(d) == "ramadan" else None
    return [b * m * (g[s] if g else 1.0) for s, b in enumerate(BASE96)]


def _calendar():
    out = []
    for i in range(N_HIST + HORIZON):
        d = START + timedelta(days=i)
        k = _kind(d)
        out.append({"date": d.isoformat(), "is_holiday": k == "eid", "is_ramadan": k == "ramadan",
                    "prayer_times": PT, "is_payday": d.day == 27,
                    "school_period": "vacation_summer" if _summer(d) else "semester",
                    "events": [{"type": "eid"}] if k == "eid" else []})
    return out


def _gen(seed=5, grain=1440, detail=DETAIL):
    rng, rng_a, rng_s = random.Random(seed), random.Random(seed + 1), random.Random(seed + 2)
    rec, agg = [], []
    cut = N_HIST - detail
    for i in range(N_HIST):
        d = START + timedelta(days=i)
        shock = math.exp(rng_s.gauss(0, 0.04))
        for z in range(3):
            for k, sid in enumerate(SUBS[z]):
                lam = _lam96(z, k, d)
                if i >= cut:
                    for s in range(96):
                        n = T._poisson(rng, lam[s] * shock)
                        ts = datetime(d.year, d.month, d.day, s // 4, s % 4 * 15, tzinfo=TZ).isoformat()
                        rec.append({"sub_zone_id": sid, "interval_start": ts, "cases_total": n,
                                    "cases_field": round(n * 0.6)})
                elif grain == 1440:
                    n = T._poisson(rng_a, sum(lam) * shock)
                    ts = datetime(d.year, d.month, d.day, tzinfo=TZ).isoformat()
                    agg.append({"sub_zone_id": sid, "period_start": ts, "period_minutes": 1440,
                                "cases_total": n, "cases_field": round(n * 0.6)})
                else:
                    for h in range(24):
                        n = T._poisson(rng_a, sum(lam[4 * h:4 * h + 4]) * shock)
                        ts = datetime(d.year, d.month, d.day, h, tzinfo=TZ).isoformat()
                        agg.append({"sub_zone_id": sid, "period_start": ts, "period_minutes": 60,
                                    "cases_total": n, "cases_field": round(n * 0.6)})
    return rec, agg


def _request(rec, agg=None):
    hist = {"records": rec}
    if agg is not None:
        hist["aggregated_records"] = agg
    return {
        "schema_version": "1.0", "request_id": str(uuid.UUID(int=9)),
        "requested_at": "2026-02-13T02:00:00+03:00", "data_source": "SYNTHETIC",
        "input_data_sources": ["SYNTHETIC"],
        "horizon": {"start_date": H_START.isoformat(), "days": HORIZON},
        "model": {"model_version": "m", "range_coverage": 0.8},
        "zones": [{"zone_id": ZID[z], "sub_zones": [{"sub_zone_id": s} for s in SUBS[z]]} for z in range(3)],
        "calendar": _calendar(), "history": hist,
    }


@pytest.fixture(scope="module")
def data():
    rec, agg = _gen()
    return {"rec": rec, "agg": agg}


@pytest.fixture(scope="module")
def runs(data):
    short = ensemble.run(_request(data["rec"]))
    t = time.perf_counter()
    long_ = ensemble.run(_request(data["rec"], data["agg"]))
    return {"short": short, "long": long_, "secs": time.perf_counter() - t}


def _err(values, keep=lambda d: True, hourly=True):
    """Zone-hour (or zone-day) error against the truth."""
    err, tot, sums = 0.0, 0.0, {}
    zk = {s: (z, k) for z in range(3) for k, s in enumerate(SUBS[z])}
    for v in values:
        d = date.fromisoformat(v["interval_start"][:10])
        if not keep(d):
            continue
        z, k = zk[v["sub_zone_id"]]
        key = (z, d, v["interval_index"] // 4 if hourly else 0)
        e = sums.setdefault(key, [0.0, 0.0])
        e[0] += v["expected"]
        e[1] += _lam96(z, k, d)[v["interval_index"]]
    for e, t in sums.values():
        err += abs(e - t)
        tot += t
    return err / tot


def _combined(eff):
    g = lambda f: eff.get(f, 1.0)
    return {"ramadan": g("ramadan"), "eid": g("holiday") * g("event_eid"),
            "vacation_summer": g("school_vacation_summer"), "payday": g("payday")}


def test_backward_compatible_exactly(load):
    # no aggregated records: same as ensemble-3
    for req in (load("examples/forecaster.input.json"), T._gen(seed=3, n_zones=3, horizon_days=7)[0]):
        a, b = ensemble4.run(copy.deepcopy(req)), ensemble3.run(copy.deepcopy(req))
        assert a["values"] == b["values"] and a["warnings"] == b["warnings"] and a["info"] == b["info"]
        assert a["debug"] == b["debug"]
        req2 = copy.deepcopy(req)
        req2["history"]["aggregated_records"] = []
        assert ensemble4.run(req2)["values"] == b["values"]


def test_backward_compatible_short_world(data):
    req = _request(data["rec"])
    a, b = ensemble4.run(copy.deepcopy(req)), ensemble3.run(copy.deepcopy(req))
    assert a["values"] == b["values"] and a["warnings"] == b["warnings"] and a["info"] == b["info"]


def test_request_and_output_valid(load, data):
    req = _request(data["rec"], data["agg"][:5000])
    Draft202012Validator(load("forecaster.input.schema.json"), format_checker=FormatChecker()).validate(req)
    out = handle(_request(data["rec"], data["agg"]))
    Draft202012Validator(load("forecaster.output.schema.json"), format_checker=FormatChecker()).validate(out)
    assert out["model_version"] == "ensemble-4" and out["engine"]["version"] == "0.7.0"
    assert out["model_info"]["history_days"] == N_HIST
    assert out["model_info"]["training_start"] == START.isoformat()
    fs = out["model_info"]["feature_set"]
    assert "long_history" in fs and "annual_season" in fs and "ramadan" in fs and "event_eid" in fs
    assert all(v["low"] <= v["expected"] <= v["high"] for v in out["values"])


def test_effects_improve_with_aggregated_history(runs):
    s = _combined(runs["short"]["debug"].get("effects", {}))
    lg = _combined(runs["long"]["debug"]["effects_all"])
    print("SYNTHETIC effects (truth / 12 weeks alone / with 3 years daily):")
    for f, t in TRUE.items():
        print(f"  {f:16s} {t:.2f} {s[f]:.3f} {lg[f]:.3f}")
    for f, t in TRUE.items():
        assert abs(lg[f] / t - 1) < 0.08, (f, lg[f])
        assert abs(lg[f] / t - 1) <= abs(s[f] / t - 1) + 0.01, f
    for f in ("ramadan", "eid", "vacation_summer"):
        assert abs(s[f] / TRUE[f] - 1) > 0.1
    w = {x["code"] for x in runs["short"]["warnings"]}
    assert "NO_RAMADAN" in w or "NO_RAMADAN_HISTORY" in w
    assert not any(x["code"] == "NO_RAMADAN_HISTORY" for x in runs["long"]["warnings"])


def test_horizon_more_accurate(runs):
    # daily totals: judged at zone x day
    ram = lambda d: _kind(d) == "ramadan"
    s, lg = runs["short"]["values"], runs["long"]["values"]
    a, b = _err(s, ram, False), _err(lg, ram, False)
    c, e = _err(s, hourly=False), _err(lg, hourly=False)
    n, m = _err(s, lambda d: not ram(d), False), _err(lg, lambda d: not ram(d), False)
    print(f"SYNTHETIC zone-day error vs truth, Ramadan horizon days: 12 weeks {a:.3f}, 3 years daily {b:.3f}; "
          f"other days {n:.3f} vs {m:.3f}; all {HORIZON} days {c:.3f} vs {e:.3f}; long run {runs['secs']:.2f}s")
    assert b < a * 0.5 and e < c and m <= n * 1.1 + 0.005


def test_hourly_aggregates_give_ramadan_hours(data, runs):
    rec, agg = _gen(grain=60)
    r = ensemble.run(_request(rec, agg))
    ram = lambda d: _kind(d) == "ramadan"
    a, b = _err(runs["long"]["values"], ram), _err(r["values"], ram)
    print(f"SYNTHETIC Ramadan horizon zone-hour error: daily aggregates {a:.3f}, hourly {b:.3f}")
    assert b < a * 0.6
    assert "ramadan_hours" in r["info"]["feature_set"]


def test_short_detail_is_spread(data):
    keep = (START + timedelta(days=N_HIST - 28)).isoformat()
    rec = [x for x in data["rec"] if x["interval_start"] >= keep]
    old = [x for x in data["rec"] if x["interval_start"] < keep]
    daily = {}
    for x in old:
        k = (x["sub_zone_id"], x["interval_start"][:10])
        daily[k] = daily.get(k, 0) + x["cases_total"]
    agg = data["agg"] + [{"sub_zone_id": s, "period_start": d + "T00:00:00+03:00", "period_minutes": 1440,
                          "cases_total": n, "cases_field": 0} for (s, d), n in daily.items()]
    r = ensemble.run(_request(rec, agg))
    codes = [w["code"] for w in r["warnings"]]
    assert "AGGREGATED_DISTRIBUTED" in codes and "ENSEMBLE_FALLBACK" not in codes
    assert r["debug"]["mode"] == "ensemble"
    assert _err(r["values"], hourly=False) < 0.06


def test_overlap_is_ignored(data):
    first = data["rec"][0]["interval_start"][:10]
    extra = [{"sub_zone_id": SUBS[0][0], "period_start": first + "T00:00:00+03:00", "period_minutes": 1440,
              "cases_total": 9999, "cases_field": 0}]
    a = ensemble.run(_request(data["rec"], data["agg"][-3000:] + extra))
    b = ensemble.run(_request(data["rec"], data["agg"][-3000:]))
    assert a["values"] == b["values"]
    assert any(w["code"] == "AGGREGATED_OVERLAP" for w in a["warnings"])


def test_deterministic(data):
    req = _request(data["rec"], data["agg"])
    a, b = handle(copy.deepcopy(req)), handle(copy.deepcopy(req))
    for x in (a, b):
        x.pop("generated_at")
    assert a == b


def test_performance_36_zones_3_years_daily(load):
    # 12 weeks at 15 minutes plus 3 years daily
    base = load("examples/forecaster.input.json")
    req, _, rows, _, _ = T._gen(n_zones=1, weeks=12, horizon_days=1)
    src = [x["sub_zone_id"] for x in req["zones"][0]["sub_zones"]]
    by_sub = {k: [r for r in rows if r["sub_zone_id"] == k] for k in src}
    start = T.START + timedelta(days=84)
    first = T.START - timedelta(days=3 * 365)
    cal = [c for c in req["calendar"] if c["date"] < start.isoformat()]
    for i in range(3 * 365):
        d = first + timedelta(days=i)
        cal.append({"date": d.isoformat(), "is_holiday": False, "is_ramadan": 40 <= i % 354 < 70,
                    "is_payday": d.day == 27})
    for i in range(10):
        cal.append({"date": (start + timedelta(days=i)).isoformat(), "is_holiday": False, "is_ramadan": False})
    rng = random.Random(4)
    zones, hist, agg = [], [], []
    for z in range(36):
        sz = [str(uuid.UUID(int=0xC00000 + z * 10 + k)) for k in range(3)]
        zones.append({"zone_id": str(uuid.UUID(int=0xA00000 + z)), "sub_zones": [{"sub_zone_id": s} for s in sz]})
        for k, s in enumerate(sz):
            hist += [{**r, "sub_zone_id": s} for r in by_sub[src[k]]]
            for i in range(3 * 365):
                d = first + timedelta(days=i)
                n = T._poisson(rng, 60.0 * T.SCALES[k] * (0.85 if 40 <= i % 354 < 70 else 1.0))
                agg.append({"sub_zone_id": s, "period_start": f"{d.isoformat()}T00:00:00+03:00",
                            "period_minutes": 1440, "cases_total": n, "cases_field": n // 2})
    big = {**base, "zones": zones, "calendar": cal, "history": {"records": hist, "aggregated_records": agg},
           "horizon": {"start_date": start.isoformat(), "days": 10}}
    t = time.perf_counter()
    out = handle(big)
    dt = time.perf_counter() - t
    print(f"36 zones x 3 sub-zones, 10 days, {len(hist)} rows (12 weeks) + {len(agg)} daily (3 years): {dt:.2f}s")
    assert len(out["values"]) == 36 * 3 * 96 * 10
    assert "long_history" in out["model_info"]["feature_set"]
    assert not any(w["code"] == "ENSEMBLE_FALLBACK" for w in out.get("warnings", []))
    assert dt < 10.0


def test_sparse_zone_day_without_cases(data):
    # a quiet zone with no record at all on some recent days
    gone = {(START + timedelta(days=N_HIST - k)).isoformat() for k in (3, 10, 17)}
    rec = [r for r in data["rec"] if not (r["sub_zone_id"] in SUBS[2] and r["interval_start"][:10] in gone)]
    out = ensemble.run(_request(rec, data["agg"]))
    vals = [v for v in out["values"] if v["sub_zone_id"] in SUBS[2]]
    assert vals and all(math.isfinite(v["expected"]) and v["expected"] >= 0 for v in vals)
