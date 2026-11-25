# SPDX-License-Identifier: AGPL-3.0-only
"""Numpy view of a forecaster request, shared by the numpy models.

Needs numpy; imported only by the optional models.
"""
from datetime import date, datetime, timedelta
from statistics import NormalDist

import numpy as np

from . import longrun as L
from . import profile as P
from . import weather as W

CAL = ("holiday", "ramadan", "eid", "event_other", "payday", "school_break", "school_exams")
WX = W.FEATS
FLAGS = CAL + WX
EVENT_FLAGS = ("holiday", "ramadan", "eid", "event_other", "school_break", "school_exams") + WX
SHAPE_DAYS = 56  # recent days for the intra-day shape
SHAPE_K = 30.0  # sub-zone shape prior, in cases
MIN_RAM_SHAPE = 7  # Ramadan detail days for its own shape


def daytype(o):
    """0 Sun-Wed, 1 Thu, 2 Fri, 3 Sat."""
    wd = date.fromordinal(o).weekday()
    return {3: 1, 4: 2, 5: 3}.get(wd, 0)


def _school(entry, region):
    by = entry.get("school_period_by_region") or {}
    p = by.get(region) if region else None
    p = p or entry.get("school_period") or by.get("central")
    if p is None and "school_in_session" in entry:
        p = "semester" if entry["school_in_session"] else "vacation_summer"
    if p is None or p == "other":
        return np.nan, np.nan
    return float(p.startswith("vacation")), float(p == "exams")


def _cal_row(entry, zid, region, has_salary, has_events):
    if entry is None:
        return [np.nan] * len(CAL)
    ev = entry.get("events")
    if ev is None and not has_events:
        eid = other = np.nan
    else:
        mine = [e["type"] for e in ev or () if not e.get("zone_ids") or zid in e["zone_ids"]]
        eid, other = float("eid" in mine), float(any(t != "eid" for t in mine))
    if has_salary:
        pay = float(entry["salary_window"]) if "salary_window" in entry else np.nan
    else:
        pay = float(entry["is_payday"]) if "is_payday" in entry else np.nan
    sb, ex = _school(entry, region)
    return [float(entry["is_holiday"]), float(entry["is_ramadan"]), eid, other, pay, sb, ex]


def _shares(request, wanted, o_start):
    """Total and field cases before the horizon."""
    tot, fld, cache = {}, {}, {}
    for r in request["history"]["records"]:
        sid = r["sub_zone_id"]
        if sid not in wanted:
            continue
        ts = r["interval_start"]
        o = cache.get(ts)
        if o is None:
            dt = datetime.fromisoformat(ts)
            dt = dt.replace(tzinfo=P.TZ) if dt.tzinfo is None else dt.astimezone(P.TZ)
            o = cache[ts] = dt.date().toordinal()
        if o < o_start:
            tot[sid] = tot.get(sid, 0) + r["cases_total"]
            fld[sid] = fld.get(sid, 0) + r["cases_field"]
    return tot, fld


class Data:
    """Arrays by sub-zone, zone and day; NaN means unknown."""

    def __init__(self, request):
        self.cov = request["model"].get("range_coverage", 0.8)
        self.start = date.fromisoformat(request["horizon"]["start_date"])
        self.H = request["horizon"]["days"]
        self.zones = [z["zone_id"] for z in request["zones"]]
        self.subs = [(z["zone_id"], s["sub_zone_id"]) for z in request["zones"] for s in z["sub_zones"]]
        zi = {z: i for i, z in enumerate(self.zones)}
        self.sub_zone = np.array([zi[z] for z, _ in self.subs], dtype=np.int64)
        wanted = {s for _, s in self.subs}
        raw, _, _ = P._load(request, wanted)
        agg = L.load(request, wanted, raw)
        o_start = self.start.toordinal()
        self.o_hz = o_start
        det = sorted({o for d in raw.values() for o in d if o < o_start})
        old = set()
        if agg is not None:
            old = {o for d in agg.sub_day.values() for o in d if o < o_start}
        first = min([o_start] + det + ([min(old)] if old else []))
        self.o0 = first
        D = o_start - first + self.H
        self.D, self.Dh = D, o_start - first
        S = len(self.subs)
        self.daily = np.full((S, D), np.nan)
        sidx = {s: i for i, (_, s) in enumerate(self.subs)}
        if old:
            for o in sorted(old):
                self.daily[:, o - first] = 0.0
            for sid, dd in agg.sub_day.items():
                i = sidx[sid]
                for o, n in dd.items():
                    if o < o_start:
                        self.daily[i, o - first] = n
        self.d0 = det[0] - first if det else self.Dh
        nd = self.Dh - self.d0
        self.detail = np.zeros((S, nd, 96))
        have = np.zeros(nd, dtype=bool)
        for sid, dd in raw.items():
            i = sidx[sid]
            for o, arr in dd.items():
                if o < o_start:
                    self.detail[i, o - first - self.d0] = arr
                    have[o - first - self.d0] = True
        self.detail_known = have
        for k in range(nd):
            if have[k]:
                self.daily[:, self.d0 + k] = self.detail[:, k].sum(axis=1)
        tot, fld = _shares(request, wanted, o_start)
        T = sum(tot.get(s, 0) for s in wanted)
        F = sum(fld.get(s, 0) for s in wanted)
        g = F / T if T else 0.6
        self.fshare = np.array([fld[s] / tot[s] if tot.get(s) else g for _, s in self.subs])
        self.ords = np.arange(first, first + D)
        self.dt = np.array([daytype(o) for o in self.ords])
        self.wd = np.array([date.fromordinal(o).weekday() for o in self.ords])
        self.doy = np.array([date.fromordinal(o).timetuple().tm_yday for o in self.ords], dtype=float)
        self._flags(request)
        self.known = ~np.isnan(self.daily).all(axis=0)

    def _flags(self, request):
        cal = {c["date"]: c for c in request["calendar"]}
        has_salary = any("salary_window" in c for c in request["calendar"])
        has_events = any("events" in c for c in request["calendar"])
        wx = W.Weather(request)
        Z = len(self.zones)
        self.flags = np.full((Z, self.D, len(FLAGS)), np.nan)
        self.temp = np.full((Z, self.D), np.nan)
        self.rain = np.full((Z, self.D), np.nan)
        region = {z["zone_id"]: z.get("region") for z in request["zones"]}
        raw_wx = {(w.get("city_id"), w["date"]): w for w in request.get("weather") or ()}
        for d in range(self.D):
            iso = date.fromordinal(self.o0 + d).isoformat()
            e = cal.get(iso)
            for zi, z in enumerate(self.zones):
                row = _cal_row(e, z, region[z], has_salary, has_events)
                f = wx.flags(iso, z) if wx.active else {}
                row += [np.nan if f.get(k) is None else float(f[k]) for k in WX]
                self.flags[zi, d] = row
                w = raw_wx.get((wx.city.get(z), iso))
                if w:
                    self.temp[zi, d] = w.get("max_temp_c", np.nan)
                    self.rain[zi, d] = w.get("rain_mm", np.nan)
        self.wx_active = wx.active

    def zone_daily(self):
        """(Z, D) zone totals; NaN where unknown."""
        Z = len(self.zones)
        out = np.full((Z, self.D), np.nan)
        for z in range(Z):
            m = self.sub_zone == z
            if m.any():
                v = self.daily[m]
                out[z] = np.where(np.isnan(v).all(axis=0), np.nan, np.nansum(v, axis=0))
        return out

    def used_flags(self, names=FLAGS):
        """Flags with both values seen in history."""
        h = self.flags[:, :self.Dh]
        out = []
        for k, n in enumerate(FLAGS):
            if n in names and np.nanmax(np.nan_to_num(h[..., k], nan=0.0)) > 0:
                out.append(n)
        return out

    def shapes(self):
        """(S, 4, 2, 96): sub-zone share of its zone by daytype and Ramadan."""
        S = len(self.subs)
        nd = self.detail.shape[1]
        lo = max(0, nd - SHAPE_DAYS)
        ram = np.nan_to_num(self.flags[0, self.d0:self.Dh, 1], nan=0.0) > 0
        dts = self.dt[self.d0:self.Dh]
        out = np.zeros((S, 4, 2, 96))
        pool = self.detail[:, :, :].sum(axis=1) + 1e-3
        for z in range(len(self.zones)):
            m = np.where(self.sub_zone == z)[0]
            if not len(m):
                continue
            zp = pool[m] / pool[m].sum()
            for r in (0, 1):
                sel = np.zeros(nd, dtype=bool)
                sel[lo:] = True
                if r and ram.sum() >= MIN_RAM_SHAPE:
                    sel = ram.copy()
                elif not r:
                    sel &= ~ram if (~ram[lo:]).sum() >= 14 else True
                for g in range(4):
                    s2 = sel & (dts == g)
                    x = self.detail[m][:, s2 & self.detail_known].sum(axis=1)
                    n = x.sum()
                    w = (x + SHAPE_K * zp) / (n + SHAPE_K)
                    out[m, g, r] = w / w.sum()
        return out

    def spread_daily(self, zday):
        """(Z, H) zone-day totals to (S, H, 96)."""
        sh = self.shapes()
        S = len(self.subs)
        E = np.zeros((S, self.H, 96))
        for h in range(self.H):
            d = self.Dh + h
            r = int(np.nan_to_num(self.flags[0, d, 1], nan=0.0) > 0)
            g = self.dt[d]
            E[:, h] = sh[:, g, r] * zday[self.sub_zone, h][:, None]
        return E

    def spread_hourly(self, zhour):
        """(Z, H, 24) zone-hour totals to (S, H, 96)."""
        sh = self.shapes()
        S = len(self.subs)
        E = np.zeros((S, self.H, 96))
        for h in range(self.H):
            d = self.Dh + h
            r = int(np.nan_to_num(self.flags[0, d, 1], nan=0.0) > 0)
            w = sh[:, self.dt[d], r].reshape(S, 24, 4)
            den = np.zeros((len(self.zones), 24))
            np.add.at(den, self.sub_zone, w.sum(axis=2))
            w = w / np.maximum(den[self.sub_zone][:, :, None], 1e-12)
            E[:, h] = (w * zhour[self.sub_zone, h][:, :, None]).reshape(S, 96)
        return E

    def info(self, features):
        k = np.where(self.known[:self.Dh])[0]
        out = {"feature_set": list(features)[:64], "history_days": int(len(k))}
        if len(k):
            out["training_start"] = date.fromordinal(self.o0 + int(k[0])).isoformat()
            out["training_end"] = date.fromordinal(self.o0 + int(k[-1])).isoformat()
        return out

    def emit(self, E, cv):
        """Values list from (S, H, 96) expected and zone-day cv."""
        E = np.maximum(np.nan_to_num(E, nan=0.0), 0.0)
        z = NormalDist().inv_cdf(0.5 + self.cov / 2)
        c = np.asarray(cv, dtype=float)[self.sub_zone][:, None, None] if np.ndim(cv) else float(cv)
        sd = np.sqrt(E + (c * E) ** 2)
        lo = np.round(np.maximum(E - z * sd, 0.0), 3)
        hi = np.round(E + z * sd, 3)
        e = np.round(E, 3)
        lo, hi = np.minimum(lo, e), np.maximum(hi, e)
        f = np.minimum(np.round(e * self.fshare[:, None, None], 3), e)
        stamps = [f"T{s // 4:02d}:{s % 4 * 15:02d}:00+03:00" for s in range(96)]
        values = []
        for h in range(self.H):
            iso = (self.start + timedelta(days=h)).isoformat()
            for i, (zid, sid) in enumerate(self.subs):
                le, ll, lh, lf = e[i, h].tolist(), lo[i, h].tolist(), hi[i, h].tolist(), f[i, h].tolist()
                for s in range(96):
                    values.append({
                        "zone_id": zid, "sub_zone_id": sid,
                        "interval_start": iso + stamps[s], "interval_index": s,
                        "low": ll[s], "expected": le[s], "high": lh[s],
                        "field_expected": lf[s], "remote_inferred_expected": round(le[s] - lf[s], 3),
                    })
        return values


def cv_from(actual, pred, floor=0.05):
    """Relative sd of zone-day errors, per zone."""
    a, p = np.asarray(actual, float), np.asarray(pred, float)
    m = ~np.isnan(a) & ~np.isnan(p)
    out = []
    for z in range(a.shape[0]):
        r = (a[z][m[z]] - p[z][m[z]]) / np.maximum(p[z][m[z]], 1.0)
        out.append(max(floor, float(np.sqrt(np.mean(r ** 2)))) if len(r) else 0.3)
    return np.array(out)


def empty(data, warnings, features):
    E = np.zeros((len(data.subs), data.H, 96))
    warnings.append({"code": "NO_HISTORY", "message": "No history for the requested sub-zones; every value is 0."})
    return {"values": data.emit(E, 0.0), "warnings": warnings, "info": data.info(features)}
