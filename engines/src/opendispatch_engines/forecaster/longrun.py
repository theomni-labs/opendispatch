# SPDX-License-Identifier: AGPL-3.0-only
"""Long-run history: hourly or daily totals over years.

Standard library only. Used only when the request carries
history.aggregated_records; otherwise nothing here runs.
"""
import math
from datetime import date, datetime

from . import profile as P

LONG_DECAY = 0.995  # weekly weight of older days
LONG_SHARE = 0.5  # weight of the long-run prior
SEAS_LAM = 1.0  # ridge on each seasonal term
MIN_LONG_DAYS = 56  # days needed for a long-run fit
YEAR = 365.2425
TARGET_DAYS = 84  # 15-minute days wanted when short
SHAPE_K = 20.0  # sub-zone hour shape prior, in cases


class Agg:
    """Aggregated history by sub-zone and day."""

    def __init__(self):
        self.sub_day, self.sub_hour = {}, {}
        self.city, self.city_hour = {}, {}
        self.records = self.skipped = self.distributed = 0


def load(request, wanted, raw):
    """Aggregated records, minus days the 15-minute records cover."""
    recs = (request.get("history") or {}).get("aggregated_records") or []
    if not recs:
        return None
    have = {o for days in raw.values() for o in days}
    a, daily, cache = Agg(), set(), {}
    for r in recs:
        sid = r["sub_zone_id"]
        if sid not in wanted:
            continue
        ts = r["period_start"]
        p = cache.get(ts)
        if p is None:
            dt = datetime.fromisoformat(ts)
            dt = dt.replace(tzinfo=P.TZ) if dt.tzinfo is None else dt.astimezone(P.TZ)
            p = cache[ts] = (dt.date().toordinal(), dt.hour)
        o = p[0]
        if o in have:
            a.skipped += 1
            continue
        a.records += 1
        n = r["cases_total"]
        d = a.sub_day.setdefault(sid, {})
        d[o] = d.get(o, 0) + n
        if r["period_minutes"] == 60:
            a.sub_hour.setdefault(sid, {}).setdefault(o, [0.0] * 24)[p[1]] += n
        else:
            daily.add((sid, o))
    bad = {o for _, o in daily}
    for sid, hd in a.sub_hour.items():
        for o in [o for o in hd if (sid, o) in daily]:
            del hd[o]
    for sid, d in a.sub_day.items():
        for o, n in d.items():
            a.city[o] = a.city.get(o, 0) + n
            if o in bad:
                continue
            ch = a.city_hour.setdefault(o, [0.0] * 24)
            for h, v in enumerate(a.sub_hour[sid][o]):
                ch[h] += v
    return a


def distribute(raw, a):
    """Spread the newest aggregated days over 96 intervals."""
    seen = sorted({o for days in raw.values() for o in days})
    if not seen or not a.city:
        return
    first = seen[0]
    need = TARGET_DAYS - (seen[-1] - first + 1)
    if need <= 0 or (seen[-1] - first + 1) >= 56:
        return
    days = sorted((o for o in a.city if o < first), reverse=True)[:need]
    if not days:
        return
    S, C = {}, [[0.0] * 24 for _ in range(7)]
    Q = [[0.0] * 4 for _ in range(24)]
    for sid, dd in raw.items():
        s = S.setdefault(sid, [[0.0] * 24 for _ in range(7)])
        for o, arr in dd.items():
            wd = date.fromordinal(o).weekday()
            for i, v in enumerate(arr):
                s[wd][i // 4] += v
                C[wd][i // 4] += v
                Q[i // 4][i % 4] += v
    q = [[(x + 2.5) / (sum(r) + 10.0) for x in r] for r in Q]
    cs = [[(x + 0.1) / (sum(r) + 2.4) for x in r] for r in C]
    for sid, dd in a.sub_day.items():
        s = S.get(sid) or [[0.0] * 24 for _ in range(7)]
        hd = a.sub_hour.get(sid, {})
        for o in days:
            n = dd.pop(o, None)
            if n is None:
                continue
            wd = date.fromordinal(o).weekday()
            hh = hd.pop(o, None)
            if hh is None:
                t = sum(s[wd])
                hh = [n * (s[wd][h] + SHAPE_K * cs[wd][h]) / (t + SHAPE_K) for h in range(24)]
            arr = raw.setdefault(sid, {}).setdefault(o, [0.0] * 96)
            for h in range(24):
                for k in range(4):
                    arr[h * 4 + k] += hh[h] * q[h][k]
    for o in days:
        a.city.pop(o, None)
        a.city_hour.pop(o, None)
    a.distributed = len(days)


def season(lf, o):
    """Annual seasonal log level of day o."""
    v = 0.0
    for k in range(lf["K"]):
        ang = 2.0 * math.pi * (k + 1) * o / YEAR
        v += lf["seas"][2 * k] * math.sin(ang) + lf["seas"][2 * k + 1] * math.cos(ang)
    return v


def fit(ctx, cutoff):
    """Daily city model over all years: effects and season."""
    from . import ensemble as E
    a = ctx.agg
    Y = {o: v for o, v in a.city.items() if cutoff is None or o < cutoff}
    for o in ctx.valid:
        if cutoff is None or o < cutoff:
            Y[o] = Y.get(o, 0.0) + sum(ctx.C96[o])
    T = sorted(o for o, v in Y.items() if v > 0 and date.fromordinal(o).isoformat() in ctx.cal)
    if len(T) < MIN_LONG_DAYS:
        return None
    last, span = T[-1], T[-1] - T[0] + 1
    K = 2 if span >= 730 else (1 if span >= 365 else 0)
    cols, ucols, info = E._design(ctx, T)
    nf, nu, base = len(cols), len(ucols), 8 + 2 * K
    p = base + nf + nu
    rows = []
    for o in T:
        r = [(date.fromordinal(o).weekday(), 1.0), (7, (o - last) / YEAR)]
        for k in range(K):
            ang = 2.0 * math.pi * (k + 1) * o / YEAR
            r += [(8 + 2 * k, math.sin(ang)), (9 + 2 * k, math.cos(ang))]
        fl = ctx.fl(o)
        for j, f in enumerate(cols):
            if fl[f]:
                r.append((base + j, float(fl[f])))
        for k, g in enumerate(ucols):
            if fl[ctx.rep[g]] is None:
                r.append((base + nf + k, 1.0))
        rows.append(r)
    w = [LONG_DECAY ** ((last - o) / 7.0) for o in T]
    y = [Y[o] for o in T]
    wm = sum(a_ * b for a_, b in zip(w, y)) / sum(w)
    b0 = [math.log(wm + 0.05)] * 7 + [0.0] * (p - 7)
    lam = [1e-3] * 7 + [1.0] + [SEAS_LAM] * (2 * K)
    for f in cols:
        wf = [wt for o, wt in zip(T, w) if ctx.fl(o)[f]]
        wmean = max(E.MIN_WMEAN, sum(wf) / len(wf))
        lam.append(2.0 * (1.0 + 2.0 / info[f]["flagged"]) * wmean)
    lam += [0.1] * nu
    try:
        res = E._irls(rows, y, w, b0, lam, 1.0)
        if res is None:
            return None
        phi = E._pearson_phi(y, res[1], p)
        res = E._irls(rows, y, w, b0, lam, phi, beta=res[0])
    except ValueError:
        return None
    if res is None:
        return None
    beta, mu = res
    H = [[0.0] * p for _ in range(p)]
    for j in range(p):
        H[j][j] = lam[j]
    for r, wt, m in zip(rows, w, mu):
        wv = wt * m / phi
        for c, v in r:
            Hc = H[c]
            for c2, v2 in r:
                Hc[c2] += wv * v * v2
    eff = {}
    for j, f in enumerate(cols):
        e = [0.0] * p
        e[base + j] = 1.0
        try:
            var = E._chol_solve(H, e)[base + j]
        except ValueError:
            continue
        eff[f] = (beta[base + j], max(var, 1e-9))
    return {"eff": eff, "rate": {f: info[f]["rate"] for f in cols}, "K": K, "seas": beta[8:base],
            "rho": _rho(ctx, cutoff), "days": len(T), "start": T[0], "fixed": {}, "col": None}


def _rho(ctx, cutoff):
    """Ramadan hour multipliers from hourly history."""
    from . import ensemble as E
    hrs = {o: h for o, h in ctx.agg.city_hour.items() if cutoff is None or o < cutoff}
    for o in ctx.valid:
        if cutoff is None or o < cutoff:
            hrs[o] = [sum(ctx.Zh[z][o][h] for z in ctx.Zh if o in ctx.Zh[z]) for h in range(24)]
    R, O, nr = [0.0] * 24, [0.0] * 24, 0
    for o, hh in hrs.items():
        fl = ctx.fl(o)
        if fl["ramadan"] == 1:
            nr += 1
            for h in range(24):
                R[h] += hh[h]
        elif fl["ramadan"] == 0 and not fl["holiday"]:
            for h in range(24):
                O[h] += hh[h]
    tr, to = sum(R), sum(O)
    if nr < E.MIN_RAM_DAYS or tr <= 0 or to <= 0:
        return None
    k = E.RAM_K * 24
    os_ = [(x + 0.5) / (to + 12.0) for x in O]
    return [(R[h] + k * os_[h]) / (tr + k) / os_[h] for h in range(24)]


def offset(ctx, lf, o, z, ahead):
    """Seasonal and long-only effects for day o, in logs."""
    v = season(lf, o)
    if lf["fixed"]:
        fl = ctx.fl(o) if z is None else ctx.zfl(o, z)
        for f, b in lf["fixed"].items():
            x = fl[f]
            if x:
                v += b * x
            elif x is None and ahead and not f.startswith(("school_", "weather_", "traffic_")):
                r = lf["rate"][f]
                v += math.log(1.0 - r + r * math.exp(b))
    return v


def warnings(a):
    out = []
    if a is None:
        return out
    if a.skipped:
        out.append({"code": "AGGREGATED_OVERLAP", "message": f"{a.skipped} aggregated record(s) fall on days with 15-minute records and are ignored."})
    if a.distributed:
        out.append({"code": "AGGREGATED_DISTRIBUTED", "message": f"15-minute history is short; {a.distributed} aggregated day(s) were spread over 15-minute intervals with the recent shape."})
    return out
