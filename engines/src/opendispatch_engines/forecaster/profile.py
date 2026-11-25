# SPDX-License-Identifier: AGPL-3.0-only
"""v1 seasonal profile model (baseline), standard library only."""
import math
from datetime import date, datetime, timedelta, timezone
from statistics import NormalDist

TZ = timezone(timedelta(hours=3))
DECAY = 0.8  # weekly weight of older weeks
PRIOR_W = 1.5  # shrink weeks toward hour-of-day
TREND_WEEKS = 4  # last weeks used for the trend
MAX_TREND = 0.10  # largest weekly change, as a fraction
MAX_AHEAD = 4.0  # weeks of trend carried forward
MIN_WEEKS = 8  # minimum history
MIN_RESID = 300  # fewer residuals: use the fallback
MIN_BUCKET = 150  # fewer in a bucket: use pooled
EDGES = (0.5, 2.0, 8.0)  # hourly level bucket edges
SHORT_WIDEN = 1.25  # range widening when short
FLAG_WIDEN = 1.25  # range widening on holiday days
PRAYERS = ("fajr", "dhuhr", "asr", "maghrib", "isha")
ZERO24 = [0.0] * 24


def _quantile(xs, p):
    pos = p * (len(xs) - 1)
    lo = int(pos)
    hi = min(lo + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo)


def _bucket(rate):
    for i, e in enumerate(EDGES):
        if rate < e:
            return i
    return len(EDGES)


def _window(pt):
    slots = set()
    for k in PRAYERS:
        h, m = pt[k].split(":")
        s = int(h) * 4 + int(m) // 15
        slots.add(s)
        if s < 95:
            slots.add(s + 1)
    return frozenset(slots)


def _load(request, wanted):
    cache, raw, tot, fld = {}, {}, {}, {}
    for r in request["history"]["records"]:
        sid = r["sub_zone_id"]
        if sid not in wanted:
            continue
        ts = r["interval_start"]
        p = cache.get(ts)
        if p is None:
            dt = datetime.fromisoformat(ts)
            dt = dt.replace(tzinfo=TZ) if dt.tzinfo is None else dt.astimezone(TZ)
            p = cache[ts] = (dt.date().toordinal(), dt.hour * 4 + dt.minute // 15)
        days = raw.setdefault(sid, {})
        arr = days.get(p[0])
        if arr is None:
            arr = days[p[0]] = [0.0] * 96
        arr[p[1]] += r["cases_total"]
        tot[sid] = tot.get(sid, 0) + r["cases_total"]
        fld[sid] = fld.get(sid, 0) + r["cases_field"]
    return raw, tot, fld


def _fit_trend(G, normal, dow_mean, last):
    buckets = {}
    for o in normal:
        b = (last - o) // 7
        if b < TREND_WEEKS:
            buckets.setdefault(b, []).append(o)
    pts, cases = [], 0.0
    for b, os_ in buckets.items():
        if len(os_) < 3:
            continue
        r = sum(G[o] / dow_mean[date.fromordinal(o).weekday()] for o in os_) / len(os_)
        cases += sum(G[o] for o in os_)
        if r > 0:
            pts.append((sum((last - o) / 7 for o in os_) / len(os_), math.log(r)))
    if len(pts) < 3:
        return 0.0
    ma = sum(a for a, _ in pts) / len(pts)
    ml = sum(v for _, v in pts) / len(pts)
    var = sum((a - ma) ** 2 for a, _ in pts)
    if var == 0:
        return 0.0
    g = -sum((a - ma) * (v - ml) for a, v in pts) / var
    g *= cases / (cases + 200.0)
    return max(-MAX_TREND, min(MAX_TREND, g))


def forecast(request, pre=None, raw_out=False):
    cov = request["model"].get("range_coverage", 0.8)
    start = date.fromisoformat(request["horizon"]["start_date"])
    ndays = request["horizon"]["days"]
    cal = {c["date"]: c for c in request["calendar"]}
    subs = [(z["zone_id"], s["sub_zone_id"]) for z in request["zones"] for s in z["sub_zones"]]
    raw, tot, fld = pre if pre is not None else _load(request, {s for _, s in subs})
    warnings = []

    def kind(iso):
        e = cal.get(iso)
        if e and e["is_holiday"]:
            return "holiday"
        return "ramadan" if e and e["is_ramadan"] else "normal"

    def win(iso):
        e = cal.get(iso)
        return _window(e["prayer_times"]) if e and e.get("prayer_times") else None

    G0 = {}
    for days in raw.values():
        for o, arr in days.items():
            G0[o] = G0.get(o, 0.0) + sum(arr)
    G0 = {o: v for o, v in G0.items() if v > 0}
    if not G0:
        warnings.append({"code": "NO_HISTORY", "message": "No history for the requested sub-zones; every value is 0."})
        if raw_out:
            return (lambda sid, d: None), warnings
        return _emit(subs, start, ndays, lambda sid, d: None, cov, warnings)
    first, last = min(G0), max(G0)
    weeks = (last - first + 1) / 7.0
    if weeks < MIN_WEEKS:
        warnings.append({"code": "SHORT_HISTORY", "message": f"History spans {weeks:.1f} weeks, under the {MIN_WEEKS} weeks needed for a first backtest. Ranges are widened and effects may be unreliable."})
    kinds, wins, dows = {}, {}, {}
    valid = [o for o in range(first, last + 1) if G0.get(o, 0) > 0]
    for o in valid:
        iso = date.fromordinal(o).isoformat()
        kinds[o], wins[o], dows[o] = kind(iso), win(iso), date.fromordinal(o).weekday()
    normal = [o for o in valid if kinds[o] == "normal"]
    if not normal:
        normal = [o for o in valid if kinds[o] != "holiday"] or valid
        warnings.append({"code": "NO_NORMAL_DAYS", "message": "History has no ordinary days; the profile uses flagged days and effects are not estimated."})
        for o in valid:
            kinds[o] = "normal" if o in normal else kinds[o]
    normal_set = set(normal)

    lull = 1.0
    groups = {}
    for o in valid:
        if wins[o]:
            gs = []
            for h in range(24):
                f = [q for q in range(4) if h * 4 + q in wins[o]]
                if 0 < len(f) < 4:
                    gs.append((h * 4, f, [q for q in range(4) if q not in f]))
            groups[o] = gs
    obs = exp = 0.0
    for days in raw.values():
        for o, arr in days.items():
            if o in normal_set and o in groups:
                for base, f, u in groups[o]:
                    um = sum(arr[base + q] for q in u) / len(u)
                    exp += um * len(f)
                    obs += sum(arr[base + q] for q in f)
    if exp >= 20:
        lull = max(0.3, min(1.3, (obs + 10.0) / (exp + 10.0)))
    if abs(lull - 1.0) < 0.02:
        lull = 1.0
    if lull != 1.0:
        for days in raw.values():
            for o, arr in days.items():
                if wins.get(o):
                    for s in wins[o]:
                        arr[s] /= lull

    H, Q = {}, [[0.0] * 4 for _ in range(24)]
    G = {}
    for sid, days in raw.items():
        H[sid] = {}
        for o, arr in days.items():
            hh = [arr[i] + arr[i + 1] + arr[i + 2] + arr[i + 3] for i in range(0, 96, 4)]
            H[sid][o] = hh
            G[o] = G.get(o, 0.0) + sum(hh)
            if o in normal_set:
                for h in range(24):
                    for q in range(4):
                        Q[h][q] += arr[h * 4 + q]
    share = []
    for h in range(24):
        s = sum(Q[h]) + 10.0
        share.append([(Q[h][q] + 2.5) / s for q in range(4)])

    dsum, dcnt = [0.0] * 7, [0] * 7
    for o in normal:
        dsum[dows[o]] += G[o]
        dcnt[dows[o]] += 1
    dow_mean = [dsum[d] / dcnt[d] if dcnt[d] else 0.0 for d in range(7)]
    present = [m for m in dow_mean if m > 0]
    ov = sum(present) / len(present)
    df = [m / ov if m > 0 else 1.0 for m in dow_mean]
    for d in range(7):
        dow_mean[d] = dow_mean[d] or ov
    g = _fit_trend(G, normal, dow_mean, last)

    W = [0.0] * 7
    wt = {}
    for o in normal:
        wt[o] = DECAY ** ((last - o) / 7.0)
        W[dows[o]] += wt[o]
    S, Sp, Wp = {}, {}, sum(wt.values())
    for sid, hd in H.items():
        S[sid] = [[0.0] * 24 for _ in range(7)]
        Sp[sid] = [0.0] * 24
        for o in normal:
            hh = hd.get(o)
            if hh is None:
                continue
            d = dows[o]
            c = wt[o] * math.exp(g * (last - o) / 7.0)
            sd, sp = S[sid][d], Sp[sid]
            for h in range(24):
                v = hh[h] * c
                sd[h] += v
                sp[h] += v / df[d]
    M = {sid: [v / Wp for v in Sp[sid]] for sid in H}
    gM = [sum(M[s][h] for s in M) / len(M) for h in range(24)]
    level = {}
    for sid in H:
        level[sid] = [
            [(S[sid][d][h] + PRIOR_W * M[sid][h] * df[d]) / (W[d] + PRIOR_W) for h in range(24)]
            for d in range(7)
        ]
    glevel = [[gM[h] * df[d] for h in range(24)] for d in range(7)]

    zs = [[] for _ in range(len(EDGES) + 1)]
    for sid in H:
        hd = H[sid]
        for o in normal:
            d = dows[o]
            lam = wt[o] / (W[d] + PRIOR_W)
            eg = math.exp(g * (last - o) / 7.0)
            denom = 1.0 - lam
            hh = hd.get(o, ZERO24)
            lv = level[sid][d]
            for h in range(24):
                fit = lv[h]
                z = (hh[h] * eg - fit) / (denom * math.sqrt(max(fit, 0.1)))
                zs[_bucket(fit)].append(z)
    pooled = sorted(z for b in zs for z in b)
    qlo, qhi = (1 - cov) / 2, 1 - (1 - cov) / 2
    fallback = len(pooled) < MIN_RESID
    if fallback:
        nz = NormalDist().inv_cdf(qhi)
        zq = [(-nz, nz)] * len(zs)
        warnings.append({"code": "RANGE_FALLBACK", "message": "Too few residuals for empirical quantiles; the range uses a Poisson-style approximation."})
    else:
        pq = (_quantile(pooled, qlo), _quantile(pooled, qhi))
        zq = []
        for b in zs:
            if len(b) >= MIN_BUCKET:
                b.sort()
                zq.append((_quantile(b, qlo), _quantile(b, qhi)))
            else:
                zq.append(pq)
    widen = SHORT_WIDEN if (fallback or weeks < MIN_WEEKS) else 1.0

    hol_f, ram_f = 1.0, [1.0] * 24
    eff = {"holiday": [0.0, 0.0], "ramadan": [0.0, 0.0]}
    ram_h = [[0.0, 0.0] for _ in range(24)]
    for sid in H:
        for o, hh in H[sid].items():
            k = kinds.get(o, "normal")  # all-zero days have no kind
            if k == "normal":
                continue
            d, em = dows[o], math.exp(-g * (last - o) / 7.0)
            lv = level[sid][d]
            for h in range(24):
                e = lv[h] * em
                eff[k][0] += hh[h]
                eff[k][1] += e
                if k == "ramadan":
                    ram_h[h][0] += hh[h]
                    ram_h[h][1] += e
    if eff["holiday"][1] > 0:
        hol_f = max(0.2, min(3.0, (eff["holiday"][0] + 30.0) / (eff["holiday"][1] + 30.0)))
    if eff["ramadan"][1] > 0:
        rall = (eff["ramadan"][0] + 30.0) / (eff["ramadan"][1] + 30.0)
        ram_f = [max(0.2, min(3.0, (o + 10.0 * rall) / (e + 10.0))) for o, e in ram_h]
    have = {k: any(v == k for v in kinds.values()) for k in ("holiday", "ramadan")}
    for i in range(ndays):
        k = kind((start + timedelta(days=i)).isoformat())
        if k != "normal" and not have[k] and not any(w["code"] == "NO_" + k.upper() for w in warnings):
            warnings.append({"code": "NO_" + k.upper(), "message": f"Horizon has {k} days but the history has none; the {k} effect is not estimated."})

    gshare = sum(fld.values()) / max(1, sum(tot.values()))
    fs = {s: (fld[s] + 20.0 * gshare) / (tot[s] + 20.0) for s in tot}
    missing = [s for _, s in subs if s not in level]
    if missing:
        warnings.append({"code": "NO_HISTORY_SUBZONE", "message": f"{len(set(missing))} sub-zone(s) have no history; they use the average profile of the others."})

    def day_values(sid, d):
        o = d.toordinal()
        wd = d.weekday()
        iso = d.isoformat()
        k = kind(iso)
        lv = level[sid][wd] if sid in level else glevel[wd]
        gm = math.exp(g * min((o - last) / 7.0, MAX_AHEAD))
        dw = win(iso) if lull != 1.0 else None
        fsh = fs.get(sid, gshare)
        out = []
        for s in range(96):
            h = s // 4
            e = lv[h] * gm * share[h][s % 4]
            if k == "holiday":
                e *= hol_f
            elif k == "ramadan":
                e *= ram_f[h]
            if dw and s in dw:
                e *= lull
            sd = math.sqrt(max(e, 0.02)) * widen * (FLAG_WIDEN if k != "normal" else 1.0)
            zl, zh = zq[_bucket(4 * e)]
            out.append((max(0.0, e + zl * sd), e, max(e, e + zh * sd), fsh))
        return out

    if raw_out:
        return day_values, warnings
    return _emit(subs, start, ndays, day_values, cov, warnings)


def _emit(subs, start, ndays, day_values, cov, warnings):
    stamps = [f"T{s // 4:02d}:{s % 4 * 15:02d}:00+03:00" for s in range(96)]
    values = []
    for i in range(ndays):
        d = start + timedelta(days=i)
        iso = d.isoformat()
        for zid, sid in subs:
            dv = day_values(sid, d)
            for s in range(96):
                if dv is None:
                    lo = e = hi = f = 0.0
                else:
                    lo, e, hi, fsh = dv[s]
                    f = round(e * fsh, 3)
                    e, lo, hi = round(e, 3), round(lo, 3), round(hi, 3)
                    f = min(f, e)
                values.append({
                    "zone_id": zid, "sub_zone_id": sid,
                    "interval_start": iso + stamps[s], "interval_index": s,
                    "low": lo, "expected": e, "high": hi,
                    "field_expected": f, "remote_inferred_expected": round(e - f, 3),
                })
    return values, warnings
