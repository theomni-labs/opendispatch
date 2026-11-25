# SPDX-License-Identifier: AGPL-3.0-only
"""Forecaster ensemble-4: school-day and holiday shapes of the day."""
from datetime import date, timedelta

from opendispatch_engines.forecaster import ensemble as E

D0 = date(2026, 3, 1)
TERM_DAYS, BREAK_DAYS = 70, 70
MORNING, EVENING = range(6, 10), range(18, 22)


def _day(peak):
    hours = [1.0] * 24
    for h in peak:
        hours[h] = 6.0
    return [v / 4 for v in hours for _ in range(4)]


def _ctx(ahead=()):
    """History: term days, then summer; ahead: (term, holiday) days after it."""
    cal, raw = [], {"s1": {}}
    for i in range(TERM_DAYS + BREAK_DAYS):
        d = D0 + timedelta(days=i)
        term = i < TERM_DAYS
        cal.append({"date": d.isoformat(), "is_holiday": False, "is_ramadan": False,
                    "school_period": "semester" if term else "vacation_summer"})
        raw["s1"][d.toordinal()] = _day(MORNING if term else EVENING)
    for k, holiday in enumerate(ahead):
        d = D0 + timedelta(days=TERM_DAYS + BREAK_DAYS + k)
        cal.append({"date": d.isoformat(), "is_holiday": holiday, "is_ramadan": False, "school_period": "semester"})
    req = {"calendar": cal, "zones": [{"zone_id": "z1", "sub_zones": [{"sub_zone_id": "s1"}]}]}
    return E._Ctx(req, raw)


def _fit(first, last):
    T = [(D0 + timedelta(days=i)).toordinal() for i in range(first, last)]
    return {"T": T, "wmap": {o: 1.0 for o in T}}


def test_term_shape_replaces_a_summer_mix():
    fix = E._day_shape(_ctx(), _fit(TERM_DAYS, TERM_DAYS + BREAK_DAYS))
    for wd in range(7):
        r = fix[("z1", "term", wd)]
        assert min(r[h] for h in MORNING) > 1.5
        assert max(r[h] for h in EVENING) < 0.7


def test_no_change_when_the_mix_is_already_term():
    fix = E._day_shape(_ctx(), _fit(0, TERM_DAYS))
    assert not any(k[1] == "term" for k in fix)


def test_reshape_keeps_the_day_total_and_skips_holidays():
    ctx = _ctx(ahead=(True, False))
    fix = E._day_shape(ctx, _fit(TERM_DAYS, TERM_DAYS + BREAK_DAYS))
    days = [(D0 + timedelta(days=TERM_DAYS + BREAK_DAYS + k)).toordinal() for k in range(2)]
    flat = [1.0] * 96
    blend = {"s1": {o: flat[:] for o in days}}
    assert E._reshape(ctx, blend, {"s1": "z1"}, fix) == 1
    assert blend["s1"][days[0]] == flat
    moved = blend["s1"][days[1]]
    assert abs(sum(moved) - sum(flat)) < 1e-9
    assert sum(moved[4 * h] for h in MORNING) > sum(moved[4 * h] for h in EVENING)
