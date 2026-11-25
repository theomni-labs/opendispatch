# SPDX-License-Identifier: AGPL-3.0-only
"""ensemble-4 with aggregated history, weather and location together.

SYNTHETIC data only; nothing here says anything about real accuracy.
"""
import copy
import random
import time
import uuid
from datetime import timedelta

import pytest
from jsonschema import Draft202012Validator, FormatChecker

import test_forecaster_location as LOC
import test_forecaster_long_history as LH
import test_forecaster_v2 as T
import test_forecaster_weather as WX
from opendispatch_engines.forecaster import ensemble3, handle

CITY = [str(uuid.UUID(int=0xF000 + c)) for c in range(3)]


def _wx(c, d, i):
    w = WX._wx(c % 2, i)
    return {**w, "city_id": CITY[c], "date": d.isoformat()}


def _locs(subs, cells):
    recs = []
    for i, s in enumerate(subs):
        for h in range(24):
            for g in LOC.GROUPS:
                recs += [{"sub_zone_id": s, "cell_id": c, "hour": h, "day_group": g, "cases": 1 + (k * 7 + h + i) % 5}
                         for k, c in enumerate(cells) if k < 5 or (k + 3 * h + i) % 7 == 0]
    return recs


def _validate(load, req, out):
    fc = FormatChecker()
    Draft202012Validator(load("forecaster.input.schema.json"), format_checker=fc).validate(req)
    Draft202012Validator(load("forecaster.output.schema.json"), format_checker=fc).validate(out)


@pytest.fixture(scope="module")
def small():
    rec, agg = LH._gen()
    req = LH._request(rec, agg)
    req["model"]["model_version"] = "ensemble-4"
    for z, zone in enumerate(req["zones"]):
        zone["city_id"] = CITY[z % 2]
    days = sorted({c["date"] for c in req["calendar"]})
    first = LH.START
    req["weather"] = [_wx(c, first + timedelta(days=i), i) for c in range(2) for i in range(len(days))]
    subs = [s["sub_zone_id"] for z in req["zones"] for s in z["sub_zones"]]
    req["history"]["location_records"] = _locs(subs, LOC._cells(20))
    return req


def test_all_features_together(load, small):
    out = handle(copy.deepcopy(small))
    _validate(load, small, out)
    assert out["model_version"] == "ensemble-4" and out["engine"]["version"] == "0.7.0"
    fs = out["model_info"]["feature_set"]
    for f in ("long_history", "annual_season", "weather", "location_distribution"):
        assert f in fs
    assert any(f.startswith("weather_") for f in fs)
    assert len(out["location_distributions"]) == 9 * 96
    assert "UNKNOWN_MODEL_VERSION" not in [w["code"] for w in out.get("warnings", [])]


def test_ensemble3_takes_weather_and_location(load, small):
    req = copy.deepcopy(small)
    req["model"]["model_version"] = "ensemble-3"
    out = handle(req)
    _validate(load, small, out)
    assert out["model_version"] == "ensemble-3"
    fs = out["model_info"]["feature_set"]
    assert "weather" in fs and "location_distribution" in fs and "long_history" not in fs
    plain = copy.deepcopy(small)
    for k in ("aggregated_records", "location_records"):
        plain["history"].pop(k)
    assert ensemble3.run(copy.deepcopy(plain))["values"] == out["values"]


def test_without_new_fields_matches_each_model(small):
    plain = copy.deepcopy(small)
    plain.pop("weather")
    for k in ("aggregated_records", "location_records"):
        plain["history"].pop(k)
    for z in plain["zones"]:
        z.pop("city_id")
    for v in ("ensemble-4", "ensemble-3"):
        plain["model"]["model_version"] = v
        out = handle(copy.deepcopy(plain))
        assert out["model_version"] == v and "location_distributions" not in out
        assert out["values"] == ensemble3.run(copy.deepcopy(plain))["values"]


def test_performance_36_zones_all_features(load):
    # long-history bound 10 s plus location 2 s
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
    cells = LOC._cells(200)
    zones, hist, agg, locs = [], [], [], []
    for z in range(36):
        sz = [str(uuid.UUID(int=0xC00000 + z * 10 + k)) for k in range(3)]
        zones.append({"zone_id": str(uuid.UUID(int=0xA00000 + z)), "city_id": CITY[z % 3],
                      "sub_zones": [{"sub_zone_id": s} for s in sz]})
        locs += _locs(sz, cells)
        for k, s in enumerate(sz):
            hist += [{**r, "sub_zone_id": s} for r in by_sub[src[k]]]
            for i in range(3 * 365):
                d = first + timedelta(days=i)
                n = T._poisson(rng, 60.0 * T.SCALES[k] * (0.85 if 40 <= i % 354 < 70 else 1.0))
                agg.append({"sub_zone_id": s, "period_start": f"{d.isoformat()}T00:00:00+03:00",
                            "period_minutes": 1440, "cases_total": n, "cases_field": n // 2})
    d0 = first
    ndays = (start - first).days + 10
    weather = [_wx(c, d0 + timedelta(days=i), i) for c in range(3) for i in range(ndays)]
    big = {**base, "zones": zones, "calendar": cal, "weather": weather,
           "history": {"records": hist, "aggregated_records": agg, "location_records": locs},
           "horizon": {"start_date": start.isoformat(), "days": 10}}
    small = {**big, "history": {"records": hist[:2000], "aggregated_records": agg[:2000],
                                "location_records": locs[:2000]}}
    fc = FormatChecker()
    Draft202012Validator(load("forecaster.input.schema.json"), format_checker=fc).validate(small)
    t = time.perf_counter()
    out = handle(big)
    dt = time.perf_counter() - t
    print(f"\ncombined 36x3, 10 days, {len(hist)} rows + {len(agg)} daily + {len(weather)} weather"
          f" + {len(locs)} location: {dt:.2f}s")
    Draft202012Validator(load("forecaster.output.schema.json"), format_checker=fc).validate(out)
    assert len(out["values"]) == 36 * 3 * 96 * 10
    assert len(out["location_distributions"]) == 36 * 3 * 96
    fs = out["model_info"]["feature_set"]
    assert "long_history" in fs and "weather" in fs and "location_distribution" in fs
    assert not any(w["code"] == "ENSEMBLE_FALLBACK" for w in out.get("warnings", []))
    assert dt < 12.0
