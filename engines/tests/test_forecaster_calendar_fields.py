# SPDX-License-Identifier: AGPL-3.0-only
"""Forecaster ensemble-3: school periods, salary window, zone-scoped
events and regions.

Every number comes from a SYNTHETIC generator with known truth. Nothing
here says anything about real accuracy.
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
from opendispatch_engines.forecaster import ensemble, ensemble2, ensemble4, handle

TZ = timezone(timedelta(hours=3))
START = date(2026, 1, 5)  # a Monday
WEEKS = 43
H0 = WEEKS * 7
HORIZON = 14
TRUE = {"exams": 1.30, "vacation_summer": 0.70, "vacation_eid_fitr": 0.80, "salary_window": 1.20,
        "scoped": 1.45, "global_event": 1.20}
ZS = [1.0, 1.2, 0.8, 1.0]
REGION = ["central", "central", "central", "western"]
SCOPE = (0, 1)  # zones the scoped event applies to
CENTRAL = {"exams": set(range(60, 75)) | set(range(190, 205)) | set(range(303, 310)),
           "vacation_summer": set(range(100, 161)),
           "vacation_eid_fitr": set(range(175, 185)) | set(range(236, 246))}
WESTERN = {"exams": set(range(80, 95)) | set(range(230, 245)),
           "vacation_summer": set(range(120, 171)) | set(range(262, 306)),
           "vacation_eid_fitr": set(range(175, 185))}
SALARY = {i for i in range(H0 + HORIZON) if i % 28 in range(20, 25)}
PAYDAY = {i for i in range(H0 + HORIZON) if i % 28 == 22}
SCOPED = {30, 31, 32, 33, 120, 121, 122, 123, 210, 211, 212, 213, 250, 251, 252, 310, 311}
GLOBAL_EV = {40, 41, 140, 141, 220, 221, 312}
NEW = {"exams", "vacation_summer", "vacation_eid_fitr"}


def _period(zi, i):
    cal = CENTRAL if REGION[zi] == "central" else WESTERN
    for k, days in cal.items():
        if i in days:
            return k
    return "semester"


def _mult(zi, i):
    m = TRUE.get(_period(zi, i), 1.0)
    if i in SALARY:
        m *= TRUE["salary_window"]
    if i in SCOPED and zi in SCOPE:
        m *= TRUE["scoped"]
    if i in GLOBAL_EV:
        m *= TRUE["global_event"]
    return m


def _lam(zi, k, i, s):
    h = s / 4
    shape = 0.2 + 2.0 * math.exp(-((h - 9) ** 2) / 8) + 2.4 * math.exp(-((h - 17) ** 2) / 10)
    return T.SCALES[k % 3] * ZS[zi] * shape * T.DOW[i % 7] * (1 + T.TREND) ** (i // 7) * _mult(zi, i)


ZID = [str(uuid.UUID(int=0xF000 + z)) for z in range(4)]
SUBS = [[str(uuid.UUID(int=0xF100 + z * 10 + k)) for k in range(3)] for z in range(4)]
PT = {"fajr": "04:30", "dhuhr": "11:50", "asr": "15:20", "maghrib": "18:05", "isha": "19:30"}


def _calendar(by_region=True, school_period=True, salary=True, scoped=True, other=()):
    cal = []
    for i in range(H0 + HORIZON):
        e = {"date": (START + timedelta(days=i)).isoformat(), "is_holiday": False, "is_ramadan": False,
             "prayer_times": PT, "is_payday": i in PAYDAY}
        if school_period:
            e["school_period"] = "other" if i in other else _period(0, i)
        if by_region:
            e["school_period_by_region"] = {"central": _period(0, i), "western": _period(3, i)}
        if salary:
            e["salary_window"] = i in SALARY
        ev = []
        if i in SCOPED:
            ev.append({"type": "season_event", "zone_ids": [ZID[z] for z in SCOPE]} if scoped
                      else {"type": "season_event"})
        if i in GLOBAL_EV:
            ev.append({"type": "season_event"})
        e["events"] = ev
        cal.append(e)
    return cal


def _gen(seed=21, boost=None):
    """boost: extra history multiplier per day."""
    rng = random.Random(seed)
    rows, boost = [], boost or {}
    for i in range(H0):
        d = START + timedelta(days=i)
        shock = math.exp(rng.gauss(0, 0.04)) * boost.get(i, 1.0)
        for zi in range(4):
            for k, sid in enumerate(SUBS[zi]):
                for s in range(96):
                    n = T._poisson(rng, _lam(zi, k, i, s) * shock)
                    ts = datetime(d.year, d.month, d.day, s // 4, s % 4 * 15, tzinfo=TZ).isoformat()
                    rows.append({"sub_zone_id": sid, "interval_start": ts, "cases_total": n, "cases_field": round(n * 0.6)})
    return rows


def _request(rows, **cal_kw):
    return {
        "schema_version": "1.0", "request_id": str(uuid.UUID(int=7)),
        "requested_at": "2026-12-01T02:00:00+03:00", "data_source": "SYNTHETIC",
        "input_data_sources": ["SYNTHETIC"],
        "horizon": {"start_date": (START + timedelta(days=H0)).isoformat(), "days": HORIZON},
        "model": {"model_version": "m", "range_coverage": 0.8},
        "zones": [{"zone_id": ZID[z], "region": REGION[z], "sub_zones": [{"sub_zone_id": s} for s in SUBS[z]]}
                  for z in range(4)],
        "calendar": _calendar(**cal_kw), "history": {"records": rows},
    }


@pytest.fixture(scope="module")
def rows():
    return _gen()


@pytest.fixture(scope="module")
def world(rows):
    req = _request(rows)
    t = time.perf_counter()
    r3 = ensemble.run(copy.deepcopy(req))
    secs = time.perf_counter() - t
    return {"req": req, "r3": r3, "r2": ensemble2.run(copy.deepcopy(req)), "secs": secs}


def _truth_cells(values):
    """Error and truth total per (zone, day)."""
    zone_of = {s: z for z in range(4) for s in SUBS[z]}
    kidx = {s: k for z in range(4) for k, s in enumerate(SUBS[z])}
    err, tot = {}, {}
    for v in values:
        sid, ts = v["sub_zone_id"], v["interval_start"]
        i = (date.fromisoformat(ts[:10]) - START).days
        z = zone_of[sid]
        lam = _lam(z, kidx[sid], i, int(ts[11:13]) * 4 + int(ts[14:16]) // 15)
        err[(z, i)] = err.get((z, i), 0.0) + abs(v["expected"] - lam)
        tot[(z, i)] = tot.get((z, i), 0.0) + lam
    return err, tot


def _rel(err, tot, cells):
    return sum(err[c] for c in cells) / sum(tot[c] for c in cells)


def _matters(z, i):
    return _period(z, i) != "semester" or i in SALARY or (i in SCOPED and z in SCOPE) or i in GLOBAL_EV


def _hist_hdays():
    return [H0 + j for j in range(HORIZON)]


def test_schema_accepts_new_fields(load):
    base = load("examples/forecaster.input.json")
    v = Draft202012Validator(load("forecaster.input.schema.json"), format_checker=FormatChecker())
    req = copy.deepcopy(base)
    zid = req["zones"][0]["zone_id"]
    req["zones"][0]["region"] = "western"
    c = req["calendar"][0]
    c["school_period"] = "vacation_summer"
    c["school_period_by_region"] = {"central": "exams", "western": "other"}
    c["salary_window"] = True
    c["events"] = [{"type": "season_event", "zone_ids": [zid]}]
    v.validate(req)
    for bad in ({"school_period": "holiday"}, {"salary_window": "yes"}):
        r2 = copy.deepcopy(req)
        r2["calendar"][0].update(bad)
        assert not v.is_valid(r2)
    out = handle(req)
    Draft202012Validator(load("forecaster.output.schema.json"), format_checker=FormatChecker()).validate(out)


def test_world_request_and_output_valid(load, world):
    Draft202012Validator(load("forecaster.input.schema.json"), format_checker=FormatChecker()).validate(world["req"])
    out = handle(copy.deepcopy(world["req"]))
    Draft202012Validator(load("forecaster.output.schema.json"), format_checker=FormatChecker()).validate(out)
    assert out["model_version"] == "ensemble-4" and out["engine"]["version"] == "0.7.0"
    fs = out["model_info"]["feature_set"]
    for f in ("school_exams", "school_vacation_summer", "school_vacation_eid_fitr", "salary_window",
              "event_season_event", "event_season_event@scope1"):
        assert f in fs, f
    assert "payday" not in fs and "school_break" not in fs and "school_other" not in fs
    assert all(v["low"] <= v["expected"] <= v["high"] for v in out["values"])


def test_backward_compatible_example(load):
    req = load("examples/forecaster.input.json")
    a, b = ensemble.run(copy.deepcopy(req)), ensemble2.run(copy.deepcopy(req))
    assert a["values"] == b["values"] and a["warnings"] == b["warnings"] and a["info"] == b["info"]
    x, y = handle(copy.deepcopy(req)), handle(copy.deepcopy(req))
    for o in (x, y):
        o.pop("generated_at")
    assert x == y and x["model_version"] == "ensemble-4"


def test_backward_compatible_synthetic():
    # no new field: same forecast as ensemble-2
    req = T._gen(seed=3, n_zones=3, horizon_days=7)[0]
    a, b = ensemble4.run(copy.deepcopy(req)), ensemble2.run(copy.deepcopy(req))
    assert a["info"]["feature_set"] == b["info"]["feature_set"] and "payday" in a["info"]["feature_set"]
    assert a["values"] == b["values"] and a["warnings"] == b["warnings"]
    assert a["debug"]["effects"] == b["debug"]["effects"]


def test_effect_recovery(world):
    # SYNTHETIC truth; tolerance 10% per zone
    ze = world["r3"]["debug"]["zone_effects"]
    table, bad = [], []
    checks = [("exams", "school_exams", (0, 1, 2, 3)), ("vacation_summer", "school_vacation_summer", (0, 1, 2, 3)),
              ("vacation_eid_fitr", "school_vacation_eid_fitr", (0, 1, 2, 3)),
              ("salary_window", "salary_window", (0, 1, 2, 3)), ("scoped", "event_season_event@scope1", SCOPE),
              ("global_event", "event_season_event", (0, 1, 2, 3))]
    for name, f, zs in checks:
        got = [ze[ZID[z]][f] for z in zs]
        table.append((name, TRUE[name], min(got), max(got)))
        bad += [(name, z, g) for z, g in zip(zs, got) if abs(g / TRUE[name] - 1) >= 0.10]
    print("SYNTHETIC effect recovery (truth, min and max over zones):")
    for r in table:
        print(f"  {r[0]:18s} true {r[1]:.2f} est {r[2]:.3f} .. {r[3]:.3f}")
    assert not bad, bad


def test_scoped_event_does_not_leak(world):
    r3 = world["r3"]
    err, tot = _truth_cells(r3["values"])
    for z in range(4):
        cells = [(z, i) for i in (310, 311)]
        rel = _rel(err, tot, cells)
        print(f"SYNTHETIC scoped-event days, zone {z} ({'in' if z in SCOPE else 'out of'} scope): error vs truth {rel:.3f}")
        assert rel < (0.15 if z in SCOPE else 0.10), (z, rel)
    # out-of-scope zones get no lift
    exp = {}
    for v in r3["values"]:
        i = (date.fromisoformat(v["interval_start"][:10]) - START).days
        z = next(k for k in range(4) if v["sub_zone_id"] in SUBS[k])
        exp[(z, i)] = exp.get((z, i), 0.0) + v["expected"]
    for z in (2, 3):
        for i in (310, 311):
            truth = sum(_lam(z, k, i, s) for k in range(3) for s in range(96))
            assert exp[(z, i)] / truth < 1.08
    assert set(r3["debug"]["scopes"]["event_season_event@scope1"][1]) == {ZID[0], ZID[1]}


def test_regional_school_periods_applied_per_zone(rows, world):
    # the western zone has its own calendar
    z = 3
    cells = [(z, i) for i in _hist_hdays() if _period(3, i) != _period(0, i)]
    assert len(cells) >= 4
    err3, tot3 = _truth_cells(world["r3"]["values"])
    req_c = _request(rows, by_region=False)
    err_c, tot_c = _truth_cells(ensemble.run(req_c)["values"])
    a, b = _rel(err3, tot3, cells), _rel(err_c, tot_c, cells)
    print(f"SYNTHETIC western zone, days where its calendar differs: by-region error {a:.3f}, central calendar only {b:.3f}")
    assert a < 0.10 and a < b * 0.7
    ze = world["r3"]["debug"]["zone_effects"]
    assert abs(ze[ZID[3]]["school_exams"] / TRUE["exams"] - 1) < 0.10


def test_beats_ensemble2_where_new_info_matters(world):
    e3, t3 = _truth_cells(world["r3"]["values"])
    e2, t2 = _truth_cells(world["r2"]["values"])
    cells = [(z, i) for z in range(4) for i in _hist_hdays()]
    m = [c for c in cells if _matters(*c)]
    o = [c for c in cells if not _matters(*c)]
    a3, a2, b3, b2 = _rel(e3, t3, m), _rel(e2, t2, m), _rel(e3, t3, o), _rel(e2, t2, o)
    print(f"SYNTHETIC held-out {HORIZON} days, error vs truth: new-info cells ens3 {a3:.3f} ens2 {a2:.3f}; "
          f"other cells ens3 {b3:.3f} ens2 {b2:.3f} ({len(m)} and {len(o)} zone-days)")
    assert a3 < a2 * 0.75
    assert b3 <= b2 * 1.05 + 0.005


def test_other_period_is_ignored(rows):
    # other days must not bias the effects
    other = set(range(10, 17))
    req = _request(_gen(boost={i: 2.0 for i in other}), other=other, by_region=False)
    r = ensemble.run(req)
    assert "school_other" not in r["info"]["feature_set"]
    ze = r["debug"]["zone_effects"]
    for z in (0, 1, 2):
        assert abs(ze[ZID[z]]["school_exams"] / TRUE["exams"] - 1) < 0.12
        assert abs(ze[ZID[z]]["school_vacation_summer"] / TRUE["vacation_summer"] - 1) < 0.12


def test_no_history_periods_are_one_and_warnings_capped(rows):
    req = _request(rows, by_region=False, scoped=False)
    cats = ["exams", "vacation_summer", "vacation_eid_fitr", "vacation_eid_adha", "vacation_national",
            "vacation_long_weekend", "vacation_mid_semester", "vacation_between_semesters"]
    for i, c in enumerate(req["calendar"]):
        c["school_period"] = cats[i % 8] if i >= H0 else "semester"
        c["salary_window"] = i >= H0 + 3 and i < H0 + 6
    r = ensemble.run(req)
    codes = [w["code"] for w in r["warnings"]]
    assert "NO_SCHOOL_VACATION_ADHA_HISTORY".replace("ADHA", "EID_ADHA") in codes
    assert "NO_SCHOOL_VACATION_NATIONAL_HISTORY" in codes
    assert "NO_CALENDAR_HISTORY_MORE" in codes
    nw = [c for c in codes if c.startswith("NO_SCHOOL_") or c in ("NO_SALARY_WINDOW_HISTORY", "NO_CALENDAR_HISTORY_MORE")]
    assert len(nw) <= ensemble.MAX_NEW_WARN + 1
    assert not any(f.startswith("school_") for f in r["info"]["feature_set"])


def test_salary_window_replaces_payday(world, rows):
    assert "payday" not in world["r3"]["info"]["feature_set"]
    req = _request(rows, salary=False)
    r = ensemble.run(req)
    assert "payday" in r["info"]["feature_set"] and "salary_window" not in r["info"]["feature_set"]


def test_deterministic(world):
    a, b = handle(copy.deepcopy(world["req"])), handle(copy.deepcopy(world["req"]))
    for x in (a, b):
        x.pop("generated_at")
    assert a == b


def _big(base, weeks, days, new):
    req, _, rows, _, _ = T._gen(n_zones=1, weeks=weeks, horizon_days=1)
    src = [x["sub_zone_id"] for x in req["zones"][0]["sub_zones"]]
    by_sub = {k: [r for r in rows if r["sub_zone_id"] == k] for k in src}
    start = T.START + timedelta(days=weeks * 7)
    cal = list(req["calendar"])
    have = {c["date"] for c in cal}
    for i in range(days):
        d = (start + timedelta(days=i)).isoformat()
        if d not in have:
            cal.append({"date": d, "is_holiday": False, "is_ramadan": False})
    zones, hist = [], []
    for z in range(36):
        sz = [str(uuid.UUID(int=0xC00000 + z * 10 + k)) for k in range(3)]
        zones.append({"zone_id": str(uuid.UUID(int=0xA00000 + z)), "sub_zones": [{"sub_zone_id": s} for s in sz]})
        if new:
            zones[-1]["region"] = "western" if z % 4 == 3 else "central"
        for k, s in enumerate(sz):
            hist += [{**r, "sub_zone_id": s} for r in by_sub[src[k]]]
    if new:
        scope = [zones[z]["zone_id"] for z in range(0, 36, 2)]
        for j, c in enumerate(sorted(cal, key=lambda c: c["date"])):
            c["school_period"] = "exams" if j % 11 < 3 else "semester"
            c["school_period_by_region"] = {"central": c["school_period"], "western": "semester"}
            c["salary_window"] = j % 28 in range(20, 25)
            c["events"] = [{"type": "season_event", "zone_ids": scope}] if j % 13 == 5 else []
    return {**base, "zones": zones, "calendar": cal, "history": {"records": hist},
            "horizon": {"start_date": start.isoformat(), "days": days}}, len(hist)


def test_performance_36_zones_10_days_new_fields(load):
    big, n = _big(load("examples/forecaster.input.json"), 3, 10, True)
    t = time.perf_counter()
    out = handle(big)
    dt = time.perf_counter() - t
    print(f"36 zones x 3 sub-zones, 10 days, {n} history rows (3 weeks), new fields: {dt:.2f}s")
    assert len(out["values"]) == 36 * 3 * 96 * 10 and dt < 3.0


def test_performance_36_zones_long_history_new_fields(load):
    big, n = _big(load("examples/forecaster.input.json"), 10, 10, True)
    t = time.perf_counter()
    out = handle(big)
    dt = time.perf_counter() - t
    print(f"36 zones x 3 sub-zones, 10 days, {n} history rows (10 weeks), new fields: {dt:.2f}s")
    assert not any(w["code"] == "ENSEMBLE_FALLBACK" for w in out.get("warnings", []))
    assert dt < 10.0
