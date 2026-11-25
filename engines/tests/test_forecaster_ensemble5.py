# SPDX-License-Identifier: AGPL-3.0-only
"""Forecaster ensemble-5: days after Eid, flat Eid weekdays, long-history trend cap.

SYNTHETIC worlds with known truth only; nothing here says anything
about real accuracy.
"""
import copy
import math
import random
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

import test_forecaster_long_history as LH
import test_forecaster_v2 as T
from opendispatch_engines.forecaster import ensemble, ensemble4, handle
from opendispatch_engines.forecaster import profile as P

TZ = timezone(timedelta(hours=3))
START = date(2026, 1, 5)  # a Monday
H0 = 26 * 7
HORIZON = 14
EID_RUNS = [range(40, 44), range(110, 114), range(H0 + 2, H0 + 6)]
TRUTH = {"eid": 0.60, "after1": 0.75, "after2": 0.88}
DOW = [1.0, 1.0, 1.05, 1.1, 0.8, 0.6, 0.9]
MEAN_DOW = sum(DOW) / 7.0
SCALES = [1.0, 0.4, 0.2]
PT = {"fajr": "04:30", "dhuhr": "11:50", "asr": "15:20", "maghrib": "18:05", "isha": "19:30"}


def _kind(i):
    for r in EID_RUNS:
        k = i - r[-1]
        if i in r:
            return "eid"
        if 1 <= k <= 2:
            return "after1"
        if 3 <= k <= 6:
            return "after2"
    return None


def _day_mult(i):
    k = _kind(i)
    if k == "eid":
        return TRUTH["eid"] * MEAN_DOW
    return DOW[i % 7] * (TRUTH[k] if k else 1.0)


def _shape(s):
    h = s / 4
    return 0.2 + 2.0 * math.exp(-((h - 9) ** 2) / 8) + 2.4 * math.exp(-((h - 17) ** 2) / 10)


def _world(seed=7, events=True):
    rng = random.Random(seed)
    zones, subs = [], []
    for z in range(3):
        ss = [str(uuid.UUID(int=0xC000 + z * 10 + k)) for k in range(3)]
        zones.append({"zone_id": str(uuid.UUID(int=0xC100 + z)), "sub_zones": [{"sub_zone_id": s} for s in ss]})
        subs += ss
    cal, rows, truth = [], [], {}
    for i in range(H0 + HORIZON):
        d = START + timedelta(days=i)
        e = {"date": d.isoformat(), "is_holiday": False, "is_ramadan": False, "prayer_times": PT,
             "is_payday": False, "school_in_session": True}
        if events:
            e["events"] = [{"type": "eid"}] if _kind(i) == "eid" else []
        cal.append(e)
        truth[d.isoformat()] = 0.0
        for j, sid in enumerate(subs):
            for s in range(96):
                lam = SCALES[j % 3] * _shape(s) * _day_mult(i)
                truth[d.isoformat()] += lam
                if i < H0:
                    n = T._poisson(rng, lam)
                    ts = datetime(d.year, d.month, d.day, s // 4, s % 4 * 15, tzinfo=TZ).isoformat()
                    rows.append({"sub_zone_id": sid, "interval_start": ts, "cases_total": n,
                                 "cases_field": round(n * 0.6)})
    req = {
        "schema_version": "1.0", "request_id": str(uuid.UUID(int=5)),
        "requested_at": "2026-07-05T02:00:00+03:00", "data_source": "SYNTHETIC",
        "input_data_sources": ["SYNTHETIC"],
        "horizon": {"start_date": (START + timedelta(days=H0)).isoformat(), "days": HORIZON},
        "model": {"model_version": "m", "range_coverage": 0.8},
        "zones": zones, "calendar": cal, "history": {"records": rows},
    }
    return req, truth


@pytest.fixture(scope="module")
def world():
    req, truth = _world()
    return {"req": req, "truth": truth, "v5": ensemble.run(copy.deepcopy(req)),
            "v4": ensemble4.run(copy.deepcopy(req))}


def _days(out):
    tot = {}
    for v in out["values"]:
        d = v["interval_start"][:10]
        tot[d] = tot.get(d, 0.0) + v["expected"]
    return tot


def _err(out, truth, keep):
    tot = _days(out)
    ds = [d for d in tot if keep(d)]
    return sum(abs(tot[d] - truth[d]) for d in ds) / sum(truth[d] for d in ds)


def _idx(d):
    return (date.fromisoformat(d) - START).days


def test_days_after_eid_are_flagged(world):
    req = world["req"]
    subs = {s["sub_zone_id"] for z in req["zones"] for s in z["sub_zones"]}
    raw, _, _ = P._load(req, subs)
    ctx = ensemble._Ctx(req, raw)
    for i in range(H0 + HORIZON):
        f = ctx.fl(START.toordinal() + i)
        k = _kind(i)
        assert f["event_eid"] == int(k == "eid")
        assert f["event_eid_after1"] == int(k == "after1")
        assert f["event_eid_after2"] == int(k == "after2")


def test_effects_after_eid_recovered(world):
    eff = world["v5"]["debug"]["effects"]
    assert abs(eff["event_eid_after1"] / TRUTH["after1"] - 1) < 0.1, eff
    assert abs(eff["event_eid_after2"] / TRUTH["after2"] - 1) < 0.1, eff
    assert "event_eid_after1" in world["v5"]["info"]["feature_set"]


def test_beats_ensemble4_on_eid_and_after_days(world):
    truth = world["truth"]
    near = lambda d: _kind(_idx(d)) is not None
    e5, e4 = _err(world["v5"], truth, near), _err(world["v4"], truth, near)
    assert e5 < 0.75 * e4, (e5, e4)
    o5 = _err(world["v5"], truth, lambda d: not near(d))
    o4 = _err(world["v4"], truth, lambda d: not near(d))
    assert o5 < o4 + 0.02, (o5, o4)


def test_eid_days_have_no_weekday_driver(world):
    req = copy.deepcopy(world["req"])
    req["model"]["model_version"] = "ensemble-5"
    out = handle(req)
    assert out["model_version"] == "ensemble-5"
    eid = {d for d in world["truth"] if _kind(_idx(d)) == "eid"}
    seen = 0
    for e in out["explanations"]:
        if e["date"] in eid:
            wd = [x for x in e["drivers"] if x["driver"] == "weekday"]
            assert wd and wd[0]["multiplier"] == 1.0
            seen += 1
    assert seen == 3 * 4


def test_same_as_ensemble4_without_eid_or_long_history(monkeypatch):
    req, _ = _world(events=False)
    ex = T._gen(seed=3, n_zones=3, horizon_days=7, calendar_fields=("payday", "school"))[0]
    a, b = ensemble.run(copy.deepcopy(req)), ensemble4.run(copy.deepcopy(req))
    assert a["warnings"] == b["warnings"] and "segment_shape" in a["info"]["feature_set"]
    # the segment mix moves cases within the day only
    for r in (req, ex):
        sa, sb = _sub_days(ensemble.run(copy.deepcopy(r))), _sub_days(ensemble4.run(copy.deepcopy(r)))
        assert sa.keys() == sb.keys() and all(abs(sa[k] - sb[k]) < 0.05 for k in sa)
    monkeypatch.setattr(ensemble, "SEG_MIX", 0.0)
    for r in (req, ex):
        assert ensemble.run(copy.deepcopy(r))["values"] == ensemble4.run(copy.deepcopy(r))["values"]


def _sub_days(out):
    tot = {}
    for v in out["values"]:
        k = (v["sub_zone_id"], v["interval_start"][:10])
        tot[k] = tot.get(k, 0.0) + v["expected"]
    return tot


def test_segment_shape_follows_recent_days_of_the_same_kind():
    req, _ = _world(events=False)
    subs = {s["sub_zone_id"] for z in req["zones"] for s in z["sub_zones"]}
    raw, _, _ = P._load(req, subs)
    ctx = ensemble._Ctx(req, raw)
    zone_of = {s["sub_zone_id"]: z["zone_id"] for z in req["zones"] for s in z["sub_zones"]}
    hd = [START.toordinal() + H0]
    flat = {s: {hd[0]: [1.0] * 96} for s in subs}
    assert ensemble._seg_mix(ctx, flat, zone_of, hd) == len(subs)
    for s, days in flat.items():
        arr = days[hd[0]]
        assert abs(sum(arr) - 96.0) < 1e-9
        # SYNTHETIC peaks at 09:00 and 17:00
        assert arr[17 * 4] > 1.2 and arr[3 * 4] < 0.8, (arr[17 * 4], arr[3 * 4])


def test_trend_capped_with_long_history():
    rec, agg = LH._gen()
    out = ensemble.run(LH._request(rec, agg))
    assert abs(out["debug"]["trend_per_week"]) <= ensemble.MAX_TREND_LONG + 1e-12
    for z, eff in out["debug"]["zone_effects"].items():
        for f, m in eff.items():
            c = out["debug"]["effects"][f]
            assert abs(math.log(m / c)) < 4 * ensemble.ZONE_EFF_SD, (z, f, m, c)


def test_ramadan_days_lean_on_the_calendar_model(monkeypatch):
    # the profile part has no Ramadan; the calendar model has
    rec, agg = LH._gen()
    req = LH._request(rec, agg)
    ram = lambda d: LH._kind(d) == "ramadan"
    new = LH._err(ensemble.run(copy.deepcopy(req))["values"], ram, hourly=False)
    monkeypatch.setattr(ensemble, "W_EVENT", 0.0)
    old = LH._err(ensemble.run(copy.deepcopy(req))["values"], ram, hourly=False)
    assert new < old, (new, old)
