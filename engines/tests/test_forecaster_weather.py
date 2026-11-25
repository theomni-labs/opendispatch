# SPDX-License-Identifier: AGPL-3.0-only
"""Forecaster weather effects on a SYNTHETIC world with known truth."""
import copy
import math
import random
import time
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from jsonschema import Draft202012Validator, FormatChecker

import test_forecaster_calendar_fields as C
import test_forecaster_v2 as T
from opendispatch_engines.forecaster import ensemble, ensemble2, ensemble4, handle, weather as W

TZ = timezone(timedelta(hours=3))
START = date(2026, 1, 5)
WEEKS = 43
H0 = WEEKS * 7
HORIZON = 14
TRUE = {"weather_rain": 1.30, "weather_dust": 1.15, "weather_low_visibility": 1.10,
        "weather_heat_45": 0.95, "weather_heat_40": 1.0}
CITY = [str(uuid.UUID(int=0xE000 + c)) for c in range(2)]
ZCITY = [0, 0, 1, 1]
ZS = [1.0, 1.2, 0.8, 1.0]
ZID = [str(uuid.UUID(int=0xE100 + z)) for z in range(4)]
SUBS = [[str(uuid.UUID(int=0xE200 + z * 10 + k)) for k in range(3)] for z in range(4)]
TREND = 0.0  # a trend confounds heat: see README


def _wx(c, i):
    """One city-day: rain, dust, visibility, heat."""
    rng = random.Random(f"wx-{c}-{i}")
    m = (START + timedelta(days=i)).month
    winter, spring = m in (11, 12, 1, 2, 3), m in (3, 4, 5, 6)
    rain = rng.random() < (0.14 if winter else 0.03)
    dust = rng.random() < (0.14 if spring else 0.04)
    vis = 12.0
    if dust:
        vis = 0.8 if rng.random() < 0.6 else 3.5
    elif rng.random() < 0.05:
        vis = 1.2
    base = 26 + 18 * math.sin(math.pi * (i % 365) / 365)
    tmax = base + rng.gauss(0, 2.5) - (3 if rain else 0)
    return {"city_id": CITY[c], "date": (START + timedelta(days=i)).isoformat(),
            "rain_mm": round(4.0 + 6 * rng.random(), 1) if rain else 0.0, "dust_event": dust,
            "max_temp_c": round(tmax, 1), "visibility_km": vis, "source": "SYNTHETIC"}


def _mult(c, i):
    f = W._day_flags(_wx(c, i))
    m = 1.0
    for k, v in f.items():
        if v:
            m *= TRUE[k]
    return m


def _lam(zi, k, i, s):
    h = s / 4
    shape = 0.2 + 2.0 * math.exp(-((h - 9) ** 2) / 8) + 2.4 * math.exp(-((h - 17) ** 2) / 10)
    return T.SCALES[k % 3] * ZS[zi] * shape * T.DOW[i % 7] * (1 + TREND) ** (i // 7) * _mult(ZCITY[zi], i)


def _gen(seed=31):
    rng = random.Random(seed)
    rows = []
    for i in range(H0):
        d = START + timedelta(days=i)
        shock = math.exp(rng.gauss(0, 0.04))
        for zi in range(4):
            for k, sid in enumerate(SUBS[zi]):
                for s in range(96):
                    n = T._poisson(rng, _lam(zi, k, i, s) * shock)
                    ts = datetime(d.year, d.month, d.day, s // 4, s % 4 * 15, tzinfo=TZ).isoformat()
                    rows.append({"sub_zone_id": sid, "interval_start": ts, "cases_total": n, "cases_field": round(n * 0.6)})
    return rows


def _request(rows, weather=True, horizon_weather=True, city_ids=True):
    cal = [{"date": (START + timedelta(days=i)).isoformat(), "is_holiday": False, "is_ramadan": False,
            "prayer_times": C.PT} for i in range(H0 + HORIZON)]
    req = {
        "schema_version": "1.0", "request_id": str(uuid.UUID(int=9)),
        "requested_at": "2026-12-01T02:00:00+03:00", "data_source": "SYNTHETIC", "input_data_sources": ["SYNTHETIC"],
        "horizon": {"start_date": (START + timedelta(days=H0)).isoformat(), "days": HORIZON},
        "model": {"model_version": "m", "range_coverage": 0.8},
        "zones": [{"zone_id": ZID[z], "sub_zones": [{"sub_zone_id": s} for s in SUBS[z]]} for z in range(4)],
        "calendar": cal, "history": {"records": rows},
    }
    if city_ids:
        for z in range(4):
            req["zones"][z]["city_id"] = CITY[ZCITY[z]]
    if weather:
        n = H0 + HORIZON if horizon_weather else H0
        req["weather"] = [_wx(c, i) for c in range(2) for i in range(n)]
    return req


@pytest.fixture(scope="module")
def rows():
    return _gen()


@pytest.fixture(scope="module")
def world(rows):
    req = _request(rows)
    t = time.perf_counter()
    wx = ensemble.run(copy.deepcopy(req))
    secs = time.perf_counter() - t
    plain = _request(rows, weather=False)
    t = time.perf_counter()
    no = ensemble.run(copy.deepcopy(plain))
    secs0 = time.perf_counter() - t
    return {"req": req, "wx": wx, "no": no, "secs": secs, "secs0": secs0}


def _horizon_err(values):
    zone_of = {s: z for z in range(4) for s in SUBS[z]}
    kidx = {s: k for z in range(4) for k, s in enumerate(SUBS[z])}
    err = tot = 0.0
    day = {}
    for v in values:
        sid, ts = v["sub_zone_id"], v["interval_start"]
        i = (date.fromisoformat(ts[:10]) - START).days
        z = zone_of[sid]
        lam = _lam(z, kidx[sid], i, int(ts[11:13]) * 4 + int(ts[14:16]) // 15)
        e = day.setdefault((z, i), [0.0, 0.0])
        e[0] += v["expected"]
        e[1] += lam
    for e, lam in day.values():
        err += abs(e - lam)
        tot += lam
    return err / tot, day


def test_schema_accepts_weather(load):
    req = load("examples/forecaster.input.json")
    req["weather"] = [{"city_id": str(uuid.UUID(int=1)), "date": req["calendar"][0]["date"], "rain_mm": 3.5,
                       "dust_event": False, "max_temp_c": 31, "visibility_km": 9, "source": "file"}]
    Draft202012Validator(load("forecaster.input.schema.json"), format_checker=FormatChecker()).validate(req)
    out = handle(req)
    Draft202012Validator(load("forecaster.output.schema.json"), format_checker=FormatChecker()).validate(out)


def test_world_valid_and_feature_set(load, world):
    Draft202012Validator(load("forecaster.input.schema.json"), format_checker=FormatChecker()).validate(world["req"])
    out = handle(copy.deepcopy(world["req"]))
    Draft202012Validator(load("forecaster.output.schema.json"), format_checker=FormatChecker()).validate(out)
    fs = out["model_info"]["feature_set"]
    assert "weather" in fs and "weather_rain" in fs and "weather_dust" in fs, fs
    assert "weather" not in world["no"]["info"]["feature_set"]


def test_without_weather_identical_to_ensemble2(rows):
    # no weather: same forecast as before
    req = _request(rows, weather=False, city_ids=False)
    a, b = ensemble4.run(copy.deepcopy(req)), ensemble2.run(copy.deepcopy(req))
    assert a["values"] == b["values"] and a["warnings"] == b["warnings"] and a["info"] == b["info"]
    a = ensemble.run(copy.deepcopy(req))
    for extra in ({"weather": []}, {"weather": [_wx(0, 3) | {"city_id": str(uuid.UUID(int=77))}]}):
        c = ensemble.run(copy.deepcopy({**req, **extra}))
        assert c["values"] == a["values"] and c["info"] == a["info"]
    d = ensemble.run(copy.deepcopy(_request(rows, weather=False)))
    assert d["values"] == a["values"]


def test_effect_recovery(world):
    # SYNTHETIC truth; tolerance 10% per zone
    ze = world["wx"]["debug"]["zone_effects"]
    bad = []
    print("SYNTHETIC weather effect recovery (truth, min and max over zones):")
    for f in ("weather_rain", "weather_dust", "weather_low_visibility", "weather_heat_45"):
        got = [ze[z][f] for z in ZID]
        print(f"  {f:24s} true {TRUE[f]:.2f} est {min(got):.3f} .. {max(got):.3f}")
        bad += [(f, z, g) for z, g in zip(ZID, got) if abs(g / TRUE[f] - 1) >= 0.10]
    assert not bad, bad


def test_weather_lowers_horizon_error(world):
    e1, _ = _horizon_err(world["wx"]["values"])
    e0, _ = _horizon_err(world["no"]["values"])
    print(f"SYNTHETIC horizon zone-day error against truth: with weather {e1:.3f}, without {e0:.3f}")
    assert e1 < e0


def test_horizon_without_weather_is_ignored(rows):
    # absent horizon weather: effect 1
    a = ensemble.run(copy.deepcopy(_request(rows, horizon_weather=False)))
    req = _request(rows)
    for w in req["weather"]:
        if w["date"] >= req["horizon"]["start_date"]:
            w.update(rain_mm=0.0, dust_event=False, max_temp_c=30.0, visibility_km=12.0)
    b = ensemble.run(copy.deepcopy(req))
    assert a["values"] == b["values"]


def test_zone_without_city_gets_no_weather(rows):
    req = _request(rows)
    req["zones"][3].pop("city_id")
    r = ensemble.run(req)
    assert "weather_rain" in r["debug"]["zone_effects"][ZID[0]]


def test_deterministic(world):
    a, b = handle(copy.deepcopy(world["req"])), handle(copy.deepcopy(world["req"]))
    for x in (a, b):
        x.pop("generated_at")
    assert a == b


def test_performance(world):
    print(f"4 zones x 3 sub-zones, {WEEKS} weeks, 14 days: with weather {world['secs']:.2f}s, without {world['secs0']:.2f}s")
    assert world["secs"] < 2.0 * world["secs0"] + 1.0
