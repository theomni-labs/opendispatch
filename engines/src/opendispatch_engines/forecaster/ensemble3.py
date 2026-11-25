# SPDX-License-Identifier: AGPL-3.0-only
"""ensemble-3, frozen apart from weather. Runs when model_version is "ensemble-3".

Ensemble forecaster v3: calendar Poisson model plus v1 profile.

Standard library only. Hierarchy: city -> zone -> sub-zone, each
level borrows from the one above in proportion to its volume.
"""
import math
from datetime import date, timedelta
from operator import mul
from statistics import NormalDist

from . import profile as P
from . import weather as W

EVENT_TYPES = ("eid", "national_day", "season_event", "hajj", "umrah", "other")
FEATS = ("holiday", "ramadan", "payday", "school_break") + tuple("event_" + t for t in EVENT_TYPES)
MIN_WEEKS = 8  # below this: profile alone
N_FOLDS = 3  # rolling origins, 7 days each
FOLD_DAYS = 7
DECAY = 0.93  # weekly weight of older days in the fit
TREND_CLIP = 12.0  # weeks of history the trend sees
MAX_TREND = 0.10
MAX_AHEAD = 4.0
KAPPA = 1.5  # cell prior, in day weights
KS = 10.0  # zone hour shape prior, in cases
MIN_WMEAN = 0.02  # floor of the event penalty scale
MIN_RAM_DAYS = 14  # Ramadan days needed for an hour shape
MIN_ORD_DAYS = 21  # ordinary days needed to drop Ramadan from cells
RAM_K = 3.0  # Ramadan hour shape prior, in cases
MIN_BASE_DAYS = 3  # unflagged days needed to size an effect
SUB_TREND_SD = 0.02  # prior sd of sub-zone share drift per week
KP = 20.0  # sub-zone volume prior, in cases
KH = 10.0  # sub-zone hour prior, in cases
SHARE_DAYS = 56
WEIGHT_K = 300.0  # zone weight shrink, in validation cases
GRID = [i / 10 for i in range(11)]
ZH_BUCKETS = (0.5, 2.0, 8.0, 32.0)  # zone-hour levels
ZH_FLOOR = 0.5  # Poisson variance floor, zone-hour
UNEST_WIDEN = 1.5  # flagged day with no estimated effect
MIN_BUCKET = 150
MIN_RESID = 300
MAX_FLAG_WIDEN = 3.0
FLAG_WIDEN = 1.25
W_EVENT = 0.8  # min calendar weight on event days
WEAK_WAPE = 0.4
WEAK_PER_DAY = 5.0
SCHOOL_CATS = ("exams", "vacation_summer", "vacation_eid_fitr", "vacation_eid_adha", "vacation_national",
               "vacation_long_weekend", "vacation_mid_semester", "vacation_between_semesters")
MAX_SCOPES = 8  # zone-scoped event features kept
MAX_NEW_WARN = 6  # no-history warnings for the new features


def _soft(f):
    return f in ("payday", "school_break", "salary_window") or f.startswith("school_") or W.is_weather(f)


def _grp(f):
    return "school" if f.startswith("school_") and f != "school_break" else f


def _code(f):
    if "@" in f:
        return "NO_" + f.removeprefix("event_").split("@")[0].upper() + "_SCOPED_HISTORY"
    return "NO_" + f.removeprefix("event_").upper() + "_HISTORY"


def _flags(entry, have, has_salary):
    if entry is None:
        return dict.fromkeys(FEATS + ("salary_window",))
    f = {"holiday": int(entry["is_holiday"]), "ramadan": int(entry["is_ramadan"])}
    f["payday"] = None if has_salary else (int(entry["is_payday"]) if "is_payday" in entry else None)
    f["salary_window"] = int(entry["salary_window"]) if "salary_window" in entry else None
    f["school_break"] = int(not entry["school_in_session"]) if "school_in_session" in entry else None
    for t in EVENT_TYPES:
        f["event_" + t] = None if have is None else int(t in have)
    return f


def _chol_solve(A, b):
    n = len(b)
    L = [[0.0] * n for _ in range(n)]
    for i in range(n):
        Li = L[i]
        for j in range(i + 1):
            Lj = L[j]
            s = A[i][j] - sum(map(mul, Li[:j], Lj[:j]))
            if i == j:
                if s <= 1e-12:
                    raise ValueError("not positive definite")
                Li[i] = math.sqrt(s)
            else:
                Li[j] = s / Lj[j]
    y = [0.0] * n
    for i in range(n):
        y[i] = (b[i] - sum(map(mul, L[i][:i], y[:i]))) / L[i][i]
    x = [0.0] * n
    for i in range(n - 1, -1, -1):
        s = y[i] - sum(L[k][i] * x[k] for k in range(i + 1, n))
        x[i] = s / L[i][i]
    return x


def _irls(rows, y, w, b0, lam, phi, beta=None, iters=30):
    p = len(b0)
    beta = list(beta if beta is not None else b0)

    def state(bt):
        mu, ll = [], 0.0
        for r, yy, ww in zip(rows, y, w):
            eta = min(sum(bt[c] * v for c, v in r), 30.0)
            m = math.exp(eta)
            mu.append(m)
            ll += ww * (yy * eta - m)
        pen = sum(lam[j] * (bt[j] - b0[j]) ** 2 for j in range(p))
        return mu, ll / phi - 0.5 * pen

    mu, ll = state(beta)
    for _ in range(iters):
        g = [-lam[j] * (beta[j] - b0[j]) for j in range(p)]
        H = [[0.0] * p for _ in range(p)]
        for j in range(p):
            H[j][j] = lam[j]
        for r, yy, ww, m in zip(rows, y, w, mu):
            res, wm = ww * (yy - m) / phi, ww * m / phi
            for c, v in r:
                g[c] += res * v
                Hc = H[c]
                for c2, v2 in r:
                    Hc[c2] += wm * v * v2
        d = _chol_solve(H, g)
        step = 1.0
        for _ in range(14):
            nb = [beta[j] + step * d[j] for j in range(p)]
            nmu, nll = state(nb)
            if nll >= ll - 1e-9:
                break
            step /= 2
        else:
            break
        done = max(abs(step * x) for x in d) < 1e-7
        beta, mu, ll = nb, nmu, nll
        if done:
            break
    if any(not math.isfinite(b) for b in beta):
        return None
    return beta, mu


def _hourly(arr):
    return [arr[i] + arr[i + 1] + arr[i + 2] + arr[i + 3] for i in range(0, 96, 4)]


def _clone(raw, cutoff=None):
    return {s: {o: a[:] for o, a in d.items() if cutoff is None or o < cutoff} for s, d in raw.items()}


class _Ctx:
    """Everything fixed by the request, shared by all fits."""

    def __init__(self, request, raw):
        self.cal = {c["date"]: c for c in request["calendar"]}
        self.ev_sent = any("events" in c for c in request["calendar"])
        self.zones = [(z["zone_id"], [s["sub_zone_id"] for s in z["sub_zones"]]) for z in request["zones"]]
        self._setup_calendar(request)
        self.raw = raw
        self.Hs, self.Zh, self.C96 = {}, {z: {} for z, _ in self.zones}, {}
        zone_of = {s: z for z, ss in self.zones for s in ss}
        for sid, days in raw.items():
            zh = self.Zh[zone_of[sid]]
            hs = self.Hs[sid] = {}
            for o, arr in days.items():
                h = hs[o] = _hourly(arr)
                z = zh.get(o)
                zh[o] = h[:] if z is None else [a + b for a, b in zip(z, h)]
                c = self.C96.get(o)
                if c is None:
                    self.C96[o] = arr[:]
                else:
                    for i in range(96):
                        c[i] += arr[i]
        self.valid = sorted(o for o, c in self.C96.items() if sum(c) > 0)
        self._fl, self._win = {}, {}
        tot = {z: sum(sum(h) for h in zh.values()) for z, zh in self.Zh.items()}
        gt = sum(tot.values())
        self.zsh = {z: (t / gt if gt > 0 else 1.0 / len(tot)) for z, t in tot.items()}

    def _setup_calendar(self, request):
        cal = request["calendar"]
        zids = {z for z, _ in self.zones}
        self.region = {z["zone_id"]: z.get("region") for z in request["zones"]}
        self.has_salary = any("salary_window" in c for c in cal)
        self.has_sp = any("school_period" in c or "school_period_by_region" in c for c in cal)
        self.evs, scopes = {}, {}
        for c in cal:
            if "events" not in c:
                continue
            glob, sc = set(), set()
            for e in c["events"]:
                if "zone_ids" not in e:
                    glob.add(e["type"])
                    continue
                s = frozenset(e["zone_ids"]) & zids
                if s == zids:
                    glob.add(e["type"])
                elif s:
                    sc.add((e["type"], s))
                    scopes[(e["type"], s)] = scopes.get((e["type"], s), 0) + 1
            self.evs[c["date"]] = (glob, sc)
        order = sorted(scopes, key=lambda k: (-scopes[k], k[0], sorted(k[1])))[:MAX_SCOPES]
        self.scope_dropped = len(scopes) - len(order)
        order.sort(key=lambda k: (k[0], sorted(k[1])))
        self.scoped = {f"event_{t}@scope{i + 1}": (t, s) for i, (t, s) in enumerate(order)}
        self._skey = {k: n for n, k in self.scoped.items()}
        self._sp = {}
        regs = set(self.region.values())
        seen = {self._period(c["date"], r) for c in cal for r in regs}
        self.school_cats = [c for c in SCHOOL_CATS if c in seen] if self.has_sp else []
        self.wx = W.Weather(request)
        self.zonal = bool(self.scoped) or self.wx.active or (
            any("school_period_by_region" in c for c in cal) and len(regs - {None}) > 0)
        self.feats = list(FEATS)
        if self.has_salary:
            self.feats.append("salary_window")
        self.feats += ["school_" + c for c in self.school_cats] + list(self.scoped) + self.wx.feats
        self.rep = {}
        for f in self.feats:
            self.rep.setdefault(_grp(f), f)
        self._zf = {}

    def _period(self, d, region):
        k = (d, region)
        if k not in self._sp:
            c = self.cal.get(d)
            v = None
            if c is not None:
                br = c.get("school_period_by_region") or {}
                if region is not None:
                    v = br.get(region) or c.get("school_period")
                else:
                    v = c.get("school_period") or br.get("central")
            self._sp[k] = v
        return self._sp[k]

    def _dyn(self, o, z):
        d = date.fromordinal(o).isoformat()
        p = self._period(d, self.region.get(z))
        out = {}
        for c in self.school_cats:
            out["school_" + c] = None if p in (None, "other") else int(p == c)
        if self.scoped:
            e = self.evs.get(d)
            if e is None and self.ev_sent and d in self.cal:
                e = (set(), set())
            for n, (t, s) in self.scoped.items():
                out[n] = None if e is None else int((t, s) in e[1] and z in s)
        if self.wx.active:
            out.update(self.wx.flags(d, z))
        return out

    def fl(self, o):
        f = self._fl.get(o)
        if f is None:
            d = date.fromordinal(o).isoformat()
            e = self.cal.get(d)
            ev = self.evs.get(d)
            have = ev[0] if ev else (set() if self.ev_sent else None)
            f = self._fl[o] = _flags(e, have, self.has_salary)
            if e is None:
                f.update(dict.fromkeys(self.feats))
            elif not self.zonal:
                f.update(self._dyn(o, None))
            else:
                per = [(self.zsh[z], self._dyn(o, z)) for z, _ in self.zones]
                for n in self.feats[len(FEATS) + self.has_salary:]:
                    kn = [(w, v[n]) for w, v in per if v[n] is not None]
                    sw = sum(w for w, _ in kn)
                    f[n] = sum(w * x for w, x in kn) / sw if kn and sw > 0 else (None if not kn else 0)
        return f

    def zfl(self, o, z):
        if not self.zonal:
            return self.fl(o)
        k = (o, z)
        f = self._zf.get(k)
        if f is None:
            f = dict(self.fl(o))
            if self.cal.get(date.fromordinal(o).isoformat()) is None:
                f.update(dict.fromkeys(self.feats[len(FEATS) + self.has_salary:]))
            else:
                f.update(self._dyn(o, z))
            self._zf[k] = f
        return f

    def win(self, o):
        if o not in self._win:
            e = self.cal.get(date.fromordinal(o).isoformat())
            self._win[o] = P._window(e["prayer_times"]) if e and e.get("prayer_times") else None
        return self._win[o]


def _lull_shape(ctx, T):
    normal = [o for o in T if not (ctx.fl(o)["holiday"] or ctx.fl(o)["ramadan"])] or T
    gcache, obs, exp = {}, 0.0, 0.0
    for o in normal:
        w = ctx.win(o)
        if not w:
            continue
        gs = gcache.get(w)
        if gs is None:
            gs = gcache[w] = []
            for h in range(24):
                f = [q for q in range(4) if h * 4 + q in w]
                if 0 < len(f) < 4:
                    gs.append((h * 4, f, [q for q in range(4) if q not in f]))
        arr = ctx.C96[o]
        for base, f, u in gs:
            exp += sum(arr[base + q] for q in u) / len(u) * len(f)
            obs += sum(arr[base + q] for q in f)
    lull = max(0.3, min(1.3, (obs + 10.0) / (exp + 10.0))) if exp >= 20 else 1.0
    if abs(lull - 1.0) < 0.02:
        lull = 1.0
    Q = [[0.0] * 4 for _ in range(24)]
    for o in normal:
        arr, w = ctx.C96[o], ctx.win(o)
        for s in range(96):
            v = arr[s] / lull if (lull != 1.0 and w and s in w) else arr[s]
            Q[s // 4][s % 4] += v
    share = []
    for h in range(24):
        t = sum(Q[h]) + 10.0
        share.append([(Q[h][q] + 2.5) / t for q in range(4)])
    return lull, share


def _fac(ctx, o, lull, share):
    w = ctx.win(o)
    if lull == 1.0 or not w:
        return None
    return [sum(share[h][q] * (lull if h * 4 + q in w else 1.0) for q in range(4)) for h in range(24)]


def _design(ctx, T):
    cols, info = [], {}
    for f in ctx.feats:
        known = [o for o in T if ctx.fl(o)[f] is not None]
        n1 = sum(1 for o in known if ctx.fl(o)[f])
        n0 = len(known) - n1
        info[f] = {"flagged": n1, "ordinary": n0, "unknown": len(T) - len(known), "rate": n1 / max(1, len(known))}
        if n1 >= 1 and n0 >= MIN_BASE_DAYS:
            cols.append(f)
    ucols = []
    for f in cols:
        if info[f]["unknown"] > 0 and _grp(f) not in ucols:
            ucols.append(_grp(f))
    return cols, ucols, info


def _row(ctx, o, cols, ucols, last, z=None):
    t = max(-TREND_CLIP, (o - last) / 7.0)
    r = [(date.fromordinal(o).weekday(), 1.0), (7, t)]
    fl = ctx.fl(o) if z is None else ctx.zfl(o, z)
    for j, f in enumerate(cols):
        if fl[f]:
            r.append((8 + j, float(fl[f])))
    for k, g in enumerate(ucols):
        if fl[ctx.rep[g]] is None:
            r.append((8 + len(cols) + k, 1.0))
    return r


def _pearson_phi(y, mu, npar):
    chi = sum((a - m) ** 2 / max(m, 1e-9) for a, m in zip(y, mu))
    return max(1.0, min(50.0, chi / max(1, len(y) - npar)))


def _fit(ctx, T, last, Zd, Cd, pooling_zone=True):
    """Return the city and per-zone calendar fits, or None."""
    cols, ucols, info = _design(ctx, T)
    nf, nu = len(cols), len(ucols)
    p = 8 + nf + nu
    rows = [_row(ctx, o, cols, ucols, last) for o in T]
    w = [DECAY ** ((last - o) / 7.0) for o in T]

    for f in cols:
        wf = [wt for o, wt in zip(T, w) if ctx.fl(o)[f]]
        info[f]["wmean"] = max(MIN_WMEAN, sum(wf) / len(wf))

    def lam_for(zone):
        lam = [16.0 if zone else 1e-3] * 7 + [2500.0 if zone else 100.0]
        for f in cols:
            n1 = info[f]["flagged"]
            lam.append((11.0 if zone else 2.0) * (1.0 + 2.0 / n1) * info[f]["wmean"])
        return lam + [0.1] * nu

    Yc = [sum(Cd[o]) for o in T]
    wm = sum(a * b for a, b in zip(w, Yc)) / sum(w)
    b0 = [math.log(wm + 0.05)] * 7 + [0.0] * (1 + nf + nu)
    lamc = lam_for(False)
    fit = _irls(rows, Yc, w, b0, lamc, 1.0)
    if fit is None:
        return None
    beta, mu = fit
    phi = _pearson_phi(Yc, mu, p)
    fit = _irls(rows, Yc, w, b0, lamc, phi, beta=beta)
    if fit is None:
        return None
    beta, mu = fit
    if abs(beta[7]) > MAX_TREND:
        beta[7] = max(-MAX_TREND, min(MAX_TREND, beta[7]))
        lamc2 = lamc[:]
        lamc2[7] = 1e9
        b02 = b0[:]
        b02[7] = beta[7]
        fit = _irls(rows, Yc, w, b02, lamc2, phi, beta=beta)
        if fit is None:
            return None
        beta, mu = fit
    sig2 = max(0.0, (phi - 1.0) / max(wm, 1e-9))
    city = {"beta": beta, "phi": phi, "cols": cols, "ucols": ucols, "info": info, "mu": mu}
    skip = None
    if "ramadan" in cols:
        sk = [ctx.fl(o)["ramadan"] == 1 for o in T]
        if MIN_RAM_DAYS <= sum(sk) and len(T) - sum(sk) >= MIN_ORD_DAYS:
            skip = sk
    ca, _, city["shape"] = _cells(T, w, rows, beta, Cd, None, skip)
    city["rho"] = _ram_rho(T, w, rows, beta, Cd, ca, skip, None)
    zones = {}
    mdow = sum(beta[:7]) / 7.0
    for zid, _ in ctx.zones:
        zd = Zd[zid]
        Yz = [sum(zd[o]) for o in T]
        if sum(Yz) <= 0:
            continue
        zm = sum(a * b for a, b in zip(w, Yz)) / sum(w)
        b0z = [math.log(zm + 0.05) + beta[d] - mdow for d in range(7)] + beta[7:]
        zr = rows if not ctx.zonal else [_row(ctx, o, cols, ucols, last, zid) for o in T]
        phz = 1.0 + zm * sig2
        try:
            fz = _irls(zr, Yz, w, b0z, lam_for(True), phz)
        except ValueError:
            fz = None
        if fz is None:
            continue
        bz = fz[0]
        if abs(bz[7]) > MAX_TREND:
            bz[7] = max(-MAX_TREND, min(MAX_TREND, bz[7]))
            lz = lam_for(True)
            lz[7] = 1e9
            b0z2 = b0z[:]
            b0z2[7] = bz[7]
            fz = _irls(zr, Yz, w, b0z2, lz, phz, beta=bz)
            if fz is None:
                continue
            bz = fz[0]
        a, _, shz = _cells(T, w, zr, bz, zd, city["shape"], skip)
        zones[zid] = {"beta": bz, "cells": a, "rho": _ram_rho(T, w, zr, bz, zd, a, skip, city["rho"])}
    return {"city": city, "zones": zones, "T": T, "last": last, "w": w, "wmap": dict(zip(T, w))}


def _ram_rho(T, w, rows, beta, Yh, cells, skip, prior):
    """Ramadan hour multipliers, mean one over expected volume."""
    if skip is None:
        return None
    pr = prior or [1.0] * 24
    Eh, Sh = [0.0] * 24, [0.0] * 24
    for o, r, wt, k in zip(T, rows, w, skip):
        if not k:
            continue
        e = wt * math.exp(sum(beta[c] * v for c, v in r if c >= 7))
        a, yh = cells[r[0][0]], Yh[o]
        for h in range(24):
            Eh[h] += e * a[h]
            Sh[h] += wt * yh[h]
    q = [(Sh[h] + RAM_K * pr[h]) / (Eh[h] + RAM_K) for h in range(24)]
    te = sum(Eh)
    if te <= 0:
        return None
    mean = sum(q[h] * Eh[h] for h in range(24)) / te
    return [x / mean for x in q]


def _cells(T, w, rows, beta, Yh, prior_shape, skip=None):
    """Hour-of-week cell rates given the day-level effects."""
    E, S = [0.0] * 7, [[0.0] * 24 for _ in range(7)]
    dws = []
    for i, (o, r, wt) in enumerate(zip(T, rows, w)):
        if skip is not None and skip[i]:
            continue
        eta = sum(beta[c] * v for c, v in r if c >= 7)
        dw = r[0][0]
        e = wt * math.exp(eta)
        E[dw] += e
        s = S[dw]
        yh = Yh[o]
        for h in range(24):
            s[h] += wt * yh[h]
        dws.append(dw)
    raw_h = [0.0] * 24
    for d in range(7):
        if E[d] > 0:
            for h in range(24):
                raw_h[h] += S[d][h] / E[d]
    tot = sum(raw_h) or 1.0
    shape = [x / tot for x in raw_h]
    if prior_shape is not None:
        shape = [(raw_h[h] + KS * prior_shape[h]) / (tot + KS) for h in range(24)]
    a = []
    for d in range(7):
        M = math.exp(beta[d])
        a.append([(S[d][h] + KAPPA * M * shape[h]) / (E[d] + KAPPA) for h in range(24)])
    return a, E, shape


def _eta_day(ctx, o, fit, beta, last, z=None):
    """Day-level log multiplier for a horizon day."""
    city = fit["city"]
    cols, info = city["cols"], city["info"]
    fl = ctx.zfl(o, z)
    eta = beta[7] * min((o - last) / 7.0, MAX_AHEAD)
    for j, f in enumerate(cols):
        v = fl[f]
        b = beta[8 + j]
        if v:
            eta += b
        elif v is None and _grp(f) != "school" and not W.is_weather(f):
            r = info[f]["rate"]
            eta += math.log(1.0 - r + r * math.exp(b))
    return eta


def _sub_shares(ctx, fit, zid, sids, pooling):
    T, last, wmap = fit["T"], fit["last"], fit["wmap"]
    Tn = [o for o in T if last - o < SHARE_DAYS]
    zh = ctx.Zh[zid]
    cz = [0.0] * 24
    wsum = 0.0
    for o in Tn:
        wt = wmap[o]
        wsum += wt
        for h in range(24):
            cz[h] += wt * zh[o][h]
    Cz = sum(cz)
    abar = sum(wmap[o] * (last - o) / 7.0 for o in Tn) / max(wsum, 1e-9)
    ids = [s for s in sids if s in ctx.Hs and any(o in ctx.Hs[s] for o in T)]
    out = {}
    for s in ids:
        hs = ctx.Hs[s]
        cs = [0.0] * 24
        buck = {}
        for o in Tn:
            h = hs.get(o)
            if h is None:
                continue
            wt = wmap[o]
            for i in range(24):
                cs[i] += wt * h[i]
            b = (last - o) // 7
            e = buck.setdefault(b, [0.0, 0.0])
            e[0] += sum(h)
            e[1] += sum(zh[o])
        Cs = sum(cs)
        p_s = (Cs + KP / len(ids)) / (Cz + KP) if pooling else Cs / max(Cz, 1e-9)
        if pooling:
            sh = [(cs[h] + KH * p_s) / (cz[h] + KH) for h in range(24)]
        else:
            sh = [cs[h] / cz[h] if cz[h] > 0 else 1.0 / len(ids) for h in range(24)]
        pts = []
        for b, (a, z) in buck.items():
            if z > 0:
                pts.append((float(b), math.log((a + 0.5) / (z * max(p_s, 1e-6) + 0.5)), a + 0.5))
        gam = 0.0
        if len(pts) >= 3:
            sw = sum(x[2] for x in pts)
            ma = sum(x[0] * x[2] for x in pts) / sw
            ml = sum(x[1] * x[2] for x in pts) / sw
            sxx = sum(x[2] * (x[0] - ma) ** 2 for x in pts)
            if sxx > 0:
                gam = -sum(x[2] * (x[0] - ma) * (x[1] - ml) for x in pts) / sxx
                if pooling:
                    var = 1.0 / sxx
                    gam *= SUB_TREND_SD ** 2 / (SUB_TREND_SD ** 2 + var)
                gam = max(-0.05, min(0.05, gam))
        out[s] = (sh, gam, abar)
    return out


def _glm_predict(ctx, cutoff, hdays, pooling):
    """Calendar Poisson forecast for hdays from days before cutoff."""
    T = [o for o in ctx.valid if cutoff is None or o < cutoff]
    if len(T) < 14:
        return None
    last = T[-1]
    lull, share = _lull_shape(ctx, T)
    facs = {o: _fac(ctx, o, lull, share) for o in T}

    def dl(h, o):
        f = facs[o]
        return h if f is None else [a / b for a, b in zip(h, f)]

    Zd = {z: {o: dl(zh[o], o) for o in T if o in zh} for z, zh in ctx.Zh.items()}
    for z in Zd:
        for o in T:
            Zd[z].setdefault(o, [0.0] * 24)
    Cd = {o: [sum(Zd[z][o][h] for z in Zd) for h in range(24)] for o in T}
    try:
        fit = _fit(ctx, T, last, Zd, Cd)
    except ValueError:
        fit = None
    if fit is None:
        return None
    pred, shares = {}, {}
    for zid, sids in ctx.zones:
        zf = fit["zones"].get(zid)
        if zf is None:
            continue
        sub = _sub_shares(ctx, fit, zid, sids, pooling)
        for s, (sh, gam, abar) in sub.items():
            days = {}
            for o in hdays:
                wd = date.fromordinal(o).weekday()
                eta = _eta_day(ctx, o, fit, zf["beta"], last, zid)
                rho = zf["rho"] if zf["rho"] and ctx.fl(o)["ramadan"] == 1 else None
                m = math.exp(eta + gam * (abar + min((o - last) / 7.0, MAX_AHEAD)))
                cell = zf["cells"][wd]
                w = ctx.win(o) if lull != 1.0 else None
                arr = []
                for h in range(24):
                    base = cell[h] * m * sh[h] * (rho[h] if rho else 1.0)
                    sq = share[h]
                    for q in range(4):
                        v = base * sq[q]
                        if w and h * 4 + q in w:
                            v *= lull
                        arr.append(v)
                days[o] = arr
            pred[s] = days
    return {"pred": pred, "fit": fit, "lull": lull, "last": last, "T": T}


def _profile_predict(ctx, cutoff, hdays, request):
    raw = _clone(ctx.raw, cutoff)
    req = {
        "calendar": request["calendar"], "zones": request["zones"], "model": request["model"],
        "horizon": {"start_date": date.fromordinal(hdays[0]).isoformat(), "days": len(hdays)},
    }
    dv, warns = P.forecast(req, pre=(raw, {}, {}), raw_out=True)
    return dv, warns


def _blend(a, b, w):
    return [w * x + (1.0 - w) * y for x, y in zip(a, b)]


def _zbucket(e):
    for i, x in enumerate(ZH_BUCKETS):
        if e < x:
            return i
    return len(ZH_BUCKETS)


def _lams(cells, zq, kappa, wd):
    """Low share and high factor of the zone-hour range, lows whole cases."""
    e = sum(cells)
    ql, qh = zq[_zbucket(e)]
    sd = math.sqrt(max(e, ZH_FLOOR)) * wd * kappa
    ssum = sum(math.sqrt(max(x, 0.02)) for x in cells)
    return (min(1.0, max(0.0, -ql * sd) / max(e, 1e-9)), max(0.0, qh * sd) / ssum)


def _vcov(items, zq, kappa):
    hit = n = 0
    for y, e, cl in items:
        for h in range(24):
            cells = [c[i] for c in cl for i in range(4 * h, 4 * h + 4)]
            ll, lh = _lams(cells, zq, kappa, 1.0)
            lo = sum(math.floor(x * (1.0 - ll) + 1e-9) for x in cells)
            hi = sum(cells) + lh * sum(math.sqrt(max(x, 0.02)) for x in cells)
            n += 1
            hit += lo - 1e-9 <= y[h] <= hi + 1e-9
    return hit / max(1, n)


def _fit_scale(items, zq, kappa, cov):
    k = kappa
    c = _vcov(items, zq, k)
    for _ in range(3):
        if abs(c - cov) <= 0.01:
            break
        k *= 1.0 + (cov - c) * 1.5
        c = _vcov(items, zq, k)
    return k, c


def _calibrate(vz, cov, flagged):
    """Zone-hour residual quantiles on ordinary days, a scale, a flag widening."""
    qlo, qhi = (1 - cov) / 2, 1 - (1 - cov) / 2
    ordv = [v for k, v in vz.items() if k not in flagged]
    flv = [v for k, v in vz.items() if k in flagged]
    if len(ordv) * 24 < MIN_RESID:
        ordv, flv = list(vz.values()), []
    zs = [[] for _ in range(len(ZH_BUCKETS) + 1)]
    for y, e, _ in ordv:
        for h in range(24):
            zs[_zbucket(e[h])].append((y[h] - e[h]) / math.sqrt(max(e[h], ZH_FLOOR)))
    pooled = sorted(z for b in zs for z in b)
    if len(pooled) < MIN_RESID:
        nz = NormalDist().inv_cdf(qhi)
        return [(-nz, nz)] * len(zs), 1.0, FLAG_WIDEN, None, True
    pq = (P._quantile(pooled, qlo), P._quantile(pooled, qhi))
    zq = []
    for b in zs:
        if len(b) >= MIN_BUCKET:
            b.sort()
            zq.append((P._quantile(b, qlo), P._quantile(b, qhi)))
        else:
            zq.append(pq)
    kappa, c = _fit_scale(ordv, zq, 1.0, cov)
    wf, cf = FLAG_WIDEN, None
    if len(flv) * 24 >= MIN_RESID:
        k2, cf = _fit_scale(flv, zq, kappa, cov)
        wf = max(1.0, min(MAX_FLAG_WIDEN, k2 / kappa))
    n1, n2 = len(ordv), len(flv)
    return zq, kappa, wf, (c * n1 + (cf if cf is not None else c) * n2) / (n1 + n2), False


def run(request, pooling=True):
    cov = request["model"].get("range_coverage", 0.8)
    start = date.fromisoformat(request["horizon"]["start_date"])
    ndays = request["horizon"]["days"]
    hdays = [start.toordinal() + i for i in range(ndays)]
    subs = [(z["zone_id"], s["sub_zone_id"]) for z in request["zones"] for s in z["sub_zones"]]
    raw, tot, fld = P._load(request, {s for _, s in subs})
    ctx = _Ctx(request, raw)
    debug = {"weights": {}, "w_global": None, "effects": {}, "mode": "profile", "folds": 0}
    info = {"feature_set": [], "history_days": len(ctx.valid)}
    if ctx.valid:
        info["training_start"] = date.fromordinal(ctx.valid[0]).isoformat()
        info["training_end"] = date.fromordinal(ctx.valid[-1]).isoformat()

    def profile_only(reason):
        values, w = P.forecast(request, pre=(_clone(raw), tot, fld))
        if reason:
            w = w + [{"code": "ENSEMBLE_FALLBACK", "message": reason}]
        have = {f for f in ctx.feats if any(ctx.fl(o)[f] for o in ctx.valid)}
        info["feature_set"] = ["hour_of_week", "weekly_trend", "pooled_15min_shape", "prayer_lull"] + [
            f for f in ("holiday", "ramadan") if f in have]
        return {"values": values, "warnings": w + _no_history(ctx, hdays, [], None), "info": info, "debug": debug}

    if not ctx.valid:
        values, w = P.forecast(request, pre=(_clone(raw), tot, fld))
        return {"values": values, "warnings": w, "info": info, "debug": debug}
    weeks = (ctx.valid[-1] - ctx.valid[0] + 1) / 7.0
    if weeks < MIN_WEEKS:
        return profile_only("History is under 8 weeks; the profile model alone is used and calendar effects are not modelled.")
    last = ctx.valid[-1]
    origins = [last + 1 - 7 * j for j in range(N_FOLDS, 0, -1) if last + 1 - 7 * j - ctx.valid[0] >= 28]
    if not origins:
        return profile_only("Too little history for rolling validation; the profile model alone is used.")
    folds = []
    for c in origins:
        hd = [c + i for i in range(FOLD_DAYS)]
        g = _glm_predict(ctx, c, hd, pooling)
        if g is None:
            continue
        dv, _ = _profile_predict(ctx, c, hd, request)
        folds.append((c, hd, g, dv))
    final = _glm_predict(ctx, None, hdays, pooling)
    if final is None or not folds:
        return profile_only("The calendar model could not be fitted; the profile model alone is used.")
    debug["folds"] = len(folds)
    zone_of = {s: z for z, s in subs}
    zloss = {z: [0.0] * len(GRID) for z, _ in ctx.zones}
    zcases = dict.fromkeys(zloss, 0.0)
    cells = []
    sub_err = {}
    for c, hd, g, dv in folds:
        for s in g["pred"]:
            for o in hd:
                a = ctx.raw[s].get(o) if s in ctx.raw else None
                if a is None or o not in ctx.Hs[s]:
                    continue
                pa = g["pred"][s][o]
                pp = [t[1] for t in dv(s, date.fromordinal(o))]
                cells.append((s, o, a, pa, pp))
    zagg = {}
    for s, o, a, pa, pp in cells:
        z = zone_of[s]
        ya = ctx.Hs[s][o]
        e = zagg.setdefault((z, o), [[0.0] * 24, [0.0] * 24, [0.0] * 24])
        for h in range(24):
            i = 4 * h
            e[0][h] += ya[h]
            e[1][h] += pa[i] + pa[i + 1] + pa[i + 2] + pa[i + 3]
            e[2][h] += pp[i] + pp[i + 1] + pp[i + 2] + pp[i + 3]
    for (z, o), (y, ga, pa_) in zagg.items():
        for k, wv in enumerate(GRID):
            zloss[z][k] += sum(abs(yy - wv * x - (1 - wv) * u) for yy, x, u in zip(y, ga, pa_))
        zcases[z] += sum(y)
    gl = [sum(zloss[z][k] for z in zloss) for k in range(len(GRID))]
    wg = GRID[min(range(len(GRID)), key=lambda k: gl[k])]
    wz = {}
    for z in zloss:
        n = zcases[z]
        wb = GRID[min(range(len(GRID)), key=lambda k: zloss[z][k])] if n > 0 else wg
        wz[z] = (n * wb + WEIGHT_K * wg) / (n + WEIGHT_K)
    debug["weights"], debug["w_global"] = wz, wg
    sub_abs, sub_y = {}, {}
    vz = {}
    for s, o, a, pa, pp in cells:
        w = wz[zone_of[s]]
        e96 = [w * x + (1.0 - w) * u for x, u in zip(pa, pp)]
        sub_abs[s] = sub_abs.get(s, 0.0) + abs(sum(a) - sum(e96))
        sub_y[s] = sub_y.get(s, 0.0) + sum(a)
        rec = vz.setdefault((zone_of[s], o), [[0.0] * 24, [0.0] * 24, []])
        rec[2].append(e96)
        for h in range(24):
            rec[0][h] += ctx.Hs[s][o][h]
            rec[1][h] += e96[4 * h] + e96[4 * h + 1] + e96[4 * h + 2] + e96[4 * h + 3]
    fcols = [f for f in final["fit"]["city"]["cols"] if not _soft(f)]
    flagged = {(z, o) for z, o in vz if any(ctx.zfl(o, z)[f] for f in fcols)}
    zq, kappa, wflag, vcov, fb = _calibrate(vz, cov, flagged)
    debug["range_kappa"], debug["range_cov_validation"], debug["flag_widen"] = kappa, vcov, wflag
    warnings = []
    if fb:
        warnings.append({"code": "RANGE_FALLBACK", "message": "Too few validation residuals for empirical quantiles; the range uses a Poisson-style approximation."})
    fit = final["fit"]
    city = fit["city"]
    debug["mode"] = "ensemble"
    debug["effects"] = {f: math.exp(city["beta"][8 + j]) for j, f in enumerate(city["cols"])}
    debug["zone_effects"] = {z: {f: math.exp(zf["beta"][8 + j]) for j, f in enumerate(city["cols"])}
                             for z, zf in fit["zones"].items()}
    debug["scopes"] = {n: (t, sorted(sc)) for n, (t, sc) in ctx.scoped.items()}
    debug["trend_per_week"] = city["beta"][7]
    dm = sum(city["beta"][:7]) / 7.0
    debug["dow_factors"] = [math.exp(b - dm) for b in city["beta"][:7]]
    debug["phi"] = city["phi"]
    used = ["hour_of_week", "weekly_trend", "pooled_15min_shape"]
    if final["lull"] != 1.0:
        used.append("prayer_lull")
    wx = ["weather"] if any(W.is_weather(f) for f in city["cols"]) else []
    info["feature_set"] = used + city["cols"] + wx + (["partial_pooling"] if pooling else [])
    warnings += _no_history(ctx, hdays, city["cols"], city["info"])

    dvp, pw = _profile_predict(ctx, None, hdays, request)
    for w in pw:
        if w["code"] in ("NO_NORMAL_DAYS",):
            warnings.append(w)
    gshare = sum(fld.values()) / max(1, sum(tot.values()))
    zt, zf_ = {}, {}
    for s in tot:
        zt[zone_of[s]] = zt.get(zone_of[s], 0) + tot[s]
        zf_[zone_of[s]] = zf_.get(zone_of[s], 0) + fld[s]
    fz = {z: (zf_[z] + 20.0 * gshare) / (zt[z] + 20.0) for z in zt}
    fs = {s: (fld[s] + 20.0 * fz.get(zone_of[s], gshare)) / (tot[s] + 20.0) for s in tot}
    ev_cols = [f for f in city["cols"] if f.startswith("event_") or W.is_weather(f)]
    ev_day = {(z, o): any(ctx.zfl(o, z)[f] for f in ev_cols) for z, _ in ctx.zones for o in hdays}
    blend = {}
    for s in final["pred"]:
        w = wz[zone_of[s]]
        blend[s] = {}
        for o in hdays:
            pp = [t[1] for t in dvp(s, date.fromordinal(o))]
            blend[s][o] = _blend(final["pred"][s][o], pp, max(w, W_EVENT) if ev_day[(zone_of[s], o)] else w)
    missing = [s for _, s in subs if s not in blend]
    for z, s in subs:
        if s not in blend and s in ctx.Hs:
            blend[s] = {}
            for o in hdays:
                blend[s][o] = [t[1] for t in dvp(s, date.fromordinal(o))]
            missing = [m for m in missing if m != s]
    if missing:
        warnings.append({"code": "NO_HISTORY_SUBZONE", "message": f"{len(set(missing))} sub-zone(s) have no history; they use the average profile of the others."})
        have = list(blend)
        for s in set(missing):
            blend[s] = {o: [sum(blend[h][o][i] for h in have) / len(have) for i in range(96)] for o in hdays}
    dayrng = ctx.valid
    weak = []
    for s in sub_y:
        perday = tot.get(s, 0) / max(1, len(dayrng))
        wape = sub_abs[s] / sub_y[s] if sub_y[s] > 0 else 0.0
        if perday < WEAK_PER_DAY or wape > WEAK_WAPE:
            weak.append(s)
    weak_ids = [s for _, s in subs if s in weak or s in missing]
    if weak_ids:
        sample = ", ".join(sorted(set(weak_ids))[:3])
        warnings.append({"code": "WEAK_LOCATIONS", "message": f"{len(set(weak_ids))} sub-zone(s) are weak: under {WEAK_PER_DAY:g} cases a day, no history, or daily validation error above {int(WEAK_WAPE * 100)}%. Treat their forecasts with care. First: {sample}."[:500]})
    debug["weak"] = sorted(set(weak_ids))
    estimated = set(city["cols"])
    widen_feats = [f for f in estimated if not _soft(f)]

    zone_sub = {}
    for z, sid in subs:
        zone_sub.setdefault(z, []).append(sid)
    unest = [f for f in ctx.feats if f not in estimated and f not in ("holiday",)]
    lam = {}
    for o in hdays:
        for z, sids in zone_sub.items():
            fl = ctx.zfl(o, z)
            if any(fl[f] for f in widen_feats):
                wd = wflag
            elif any(fl[f] for f in unest):
                wd = max(wflag, UNEST_WIDEN)
            else:
                wd = 1.0
            row = []
            for h in range(24):
                cl = [blend[sid][o][i] for sid in sids for i in range(4 * h, 4 * h + 4)]
                row.append(_lams(cl, zq, kappa, wd))
            lam[(z, o)] = row
    zone_of_s = dict(zone_of)

    def day_values(sid, d):
        o = d.toordinal()
        fsh = fs.get(sid, gshare)
        row = lam[(zone_of_s[sid], o)]
        out = []
        for i, e in enumerate(blend[sid][o]):
            ll, lh = row[i // 4]
            sd = math.sqrt(max(e, 0.02))
            out.append((math.floor(e * (1.0 - ll) + 1e-9), e, e + lh * sd, fsh))
        return out

    values, _ = P._emit(subs, start, ndays, day_values, cov, [])
    return {"values": values, "warnings": warnings, "info": info, "debug": debug}


def _no_history(ctx, hdays, used, info):
    out, new = [], 0
    for f in ctx.feats:
        if f in used:
            continue
        if any(ctx.fl(o)[f] for o in hdays):
            if f not in FEATS:
                new += 1
                if new > MAX_NEW_WARN:
                    continue
            out.append({"code": _code(f), "message": f"The horizon has {f.removeprefix('event_')} days but the history has no flagged days with ordinary comparison days; the effect is 1 (not estimated)."})
    if new > MAX_NEW_WARN:
        out.append({"code": "NO_CALENDAR_HISTORY_MORE", "message": f"{new - MAX_NEW_WARN} more school period, salary or scoped event effects have no history; each is 1."})
    if ctx.scope_dropped:
        out.append({"code": "SCOPED_EVENTS_LIMIT", "message": f"More than {MAX_SCOPES} zone-scoped event groups; {ctx.scope_dropped} with the fewest days are ignored."})
    return out
