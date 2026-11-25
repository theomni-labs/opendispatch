# SPDX-License-Identifier: AGPL-3.0-only
"""Roster optimizer: greedy build, then bounded local search."""
import math
import random
import time
import uuid
from datetime import datetime, timedelta, timezone

from ..common import envelope

MODEL_VERSION = "greedy-ls-0.1"
MODEL_VERSION_REACH = "greedy-ls-0.2"
MODEL_STAGGER = "greedy-ls-0.3"
MODEL_CPSAT = "cpsat-1"
DEFAULT_SPEED_KMH = 40.0
DEFAULT_DETOUR = 1.3
REACH_PASSES = 3
EPS = 1e-9
TZ = timezone(timedelta(hours=3))
N = 96
W_SHORT = 1000
PRAYER_WINDOW_MIN = 30
DEFAULT_ZONE_SECONDS = 20
SEARCH_SHARE = 0.9
STALL_PER_AGENT = 40
STALL_BASE = 500
DEFAULT_RADIUS_M = 3000
SCENARIO_NS = uuid.UUID("6f1d2c3e-5b7a-4e0f-9a1c-0d2e5f3a4b6c")


def _hm(text):
    h, m = text.split(":")
    return int(h) * 60 + int(m)


class Pattern:
    def __init__(self, raw, mode, rule, blocked):
        h = raw[mode]
        sm = _hm(h["start_time"])
        em = _hm(h["end_time"])
        if em <= sm:
            em += 1440
        self.id = raw["shift_pattern_id"]
        self.code = raw["code"]
        self.s = sm // 15
        self.e_abs = -(-em // 15)
        self.e = min(self.e_abs, N)
        self.shift = tuple(range(self.s, self.e))
        self.bm = -(-rule["break_minutes"] // 15)
        after = round(rule["after_consecutive_hours"] * 4)
        self.needs_break = (self.e_abs - self.s) > after
        self.breaks = []
        self.prayer_relaxed = False
        self._contrib = {}
        if self.needs_break:
            hi = min(self.s + after, self.e_abs - self.bm)
            lo = max(self.s + 4, self.e_abs - self.bm - after)
            if lo > hi:
                lo = max(self.s, self.e_abs - self.bm - after)
            cands = list(range(lo, hi + 1))
            free = [b for b in cands
                    if not any(t in blocked for t in range(b, b + self.bm))]
            self.breaks = free or cands
            self.prayer_relaxed = bool(cands) and not free

    def break_idx(self, b):
        return tuple(t for t in range(b, b + self.bm) if t < N)

    def contrib(self, b):
        c = self._contrib.get(b)
        if c is None:
            gone = set(self.break_idx(b)) if b is not None else set()
            c = tuple(t for t in self.shift if t not in gone)
            self._contrib[b] = c
        return c


class Pool:
    def __init__(self, sids, elig, req, cap):
        self.sids = list(sids)
        self.elig = elig
        self.req = req
        self.cap = cap
        self.cov = [0] * N
        self.on = [0] * N
        self.pat = {}
        self.brk = {}
        self.locked = set()
        self.cut = False
        self.stagger = False
        self.allowed = {}
        self.bk = [0] * N
        self.skills = {}
        self.sreq = {}
        self.scov = {}
        pats = {}
        for sid in self.sids:
            for p in elig[sid]:
                pats.setdefault(p.id, p)
        self.patterns = list(pats.values())
        self.by_pat = {
            p.id: sorted((s for s in self.sids if p in elig[s]),
                         key=lambda s: len(elig[s]))
            for p in self.patterns}

    def need_skills(self, sreq, skills_of):
        """Skill needs per interval; who holds them."""
        self.sreq = {k: v for k, v in sreq.items() if any(v)}
        self.scov = {k: [0] * N for k in self.sreq}
        self.skills = {s: frozenset(k for k in skills_of(s) if k in self.sreq)
                       for s in self.sids}
        for p in self.patterns:
            self.by_pat[p.id].sort(key=lambda s: (len(self.elig[s]), len(self.skills[s])))

    def _cost(self, t):
        d = self.req[t] - self.cov[t]
        c = W_SHORT * d if d > 0 else -d
        for k, r in self.sreq.items():
            if r[t] > self.scov[k][t]:
                c += W_SHORT * (r[t] - self.scov[k][t])
        return c

    def _local(self, idxs):
        return sum(self._cost(t) for t in idxs)

    def short(self):
        return sum(max(0, self.req[t] - self.cov[t]) for t in range(N))

    def skill_short(self, k):
        return [max(0, self.sreq[k][t] - self.scov[k][t]) for t in range(N)]

    def _apply(self, p, b, sign, sid=None):
        held = self.skills.get(sid, ())
        for t in p.contrib(b):
            self.cov[t] += sign
            for k in held:
                self.scov[k][t] += sign
        if b is not None:
            for t in p.break_idx(b):
                self.bk[t] += sign
        for t in p.shift:
            self.on[t] += sign

    def _cap_ok(self, p):
        return self.cap is None or all(self.on[t] < self.cap for t in p.shift)

    def _best_break(self, p, sid=None):
        if not p.needs_break or not p.breaks:
            return None
        best = None
        held = self.skills.get(sid, ())
        for b in p.breaks:
            idx = p.break_idx(b)
            d = sum(W_SHORT if self.cov[t] <= self.req[t] else -1 for t in idx)
            d += sum(W_SHORT for k in held for t in idx
                     if self.scov[k][t] <= self.sreq[k][t])
            if self.stagger:
                d = (d, sum(self.bk[t] for t in idx),
                     -sum(self.cov[t] - self.req[t] for t in idx))
            if best is None or d < best[0]:
                best = (d, b)
        return best[1]

    def _place(self, p, sid=None):
        self._apply(p, None, 1, sid)
        b = self._best_break(p, sid)
        self._apply(p, None, -1, sid)
        self._apply(p, b, 1, sid)
        return b

    def _try(self, changes, keep):
        olds = [(s, self.pat.get(s), self.brk.get(s)) for s, _ in changes]
        touched = set()
        for (_, np_), (_, op, _) in zip(changes, olds):
            for p in (op, np_):
                if p:
                    touched.update(p.shift)
        before = self._local(touched)
        for s, op, ob in olds:
            if op:
                self._apply(op, ob, -1, s)
        news = []
        ok = True
        for s, np_ in changes:
            if np_ is None:
                news.append((s, None, None))
                continue
            if not self._cap_ok(np_):
                ok = False
                break
            news.append((s, np_, self._place(np_, s)))
        gain = before - self._local(touched) if ok else None
        if ok and keep(gain):
            for s, np_, b in news:
                if np_:
                    self.pat[s], self.brk[s] = np_, b
                else:
                    self.pat.pop(s, None)
                    self.brk.pop(s, None)
            return gain
        for s, np_, b in news:
            if np_:
                self._apply(np_, b, -1, s)
        for s, op, ob in olds:
            if op:
                self._apply(op, ob, 1, s)
        return gain

    def lock(self, sid, p):
        if not self._cap_ok(p):
            return False
        self._try([(sid, p)], lambda g: True)
        self.locked.add(sid)
        return True

    def greedy(self, deadline):
        while True:
            if time.perf_counter() >= deadline:
                self.cut = True
                return
            best = None
            for p in self.patterns:
                seen = set()
                for sid in self.by_pat[p.id]:
                    sig = self.skills.get(sid, frozenset())
                    if sid in self.pat or sig in seen:
                        continue
                    seen.add(sig)
                    g = self._try([(sid, p)], lambda g: False)
                    if g is not None and g > 0 and (best is None or g > best[0]):
                        best = (g, sid, p)
                    if not self.sreq:
                        break
            if best is None:
                return
            self._try([(best[1], best[2])], lambda g: True)

    def _move_break(self, sid, b2):
        p = self.pat[sid]
        ob = self.brk[sid]
        if ob == b2:
            return False
        before = self._local(p.shift)
        self._apply(p, ob, -1, sid)
        c_old = sum(self.bk[t] for t in p.break_idx(ob))
        c_new = sum(self.bk[t] for t in p.break_idx(b2))
        self._apply(p, b2, 1, sid)
        after = self._local(p.shift)
        if after < before or (self.stagger and after == before and c_new < c_old):
            self.brk[sid] = b2
            return True
        self._apply(p, b2, -1, sid)
        self._apply(p, ob, 1, sid)
        return False

    def improve(self, deadline, rng, stall_limit):
        free = [s for s in self.sids if s not in self.locked]
        if not free:
            return
        stall = 0
        while stall < stall_limit:
            if time.perf_counter() >= deadline:
                self.cut = True
                return
            sid = rng.choice(free)
            r = rng.random()
            done = False
            if r < 0.5:
                np_ = rng.choice(self.elig[sid] + [None])
                if np_ is not self.pat.get(sid):
                    g = self._try([(sid, np_)], lambda g: g > 0)
                    done = g is not None and g > 0
            elif r < 0.8:
                o = rng.choice(free)
                pa, pb = self.pat.get(sid), self.pat.get(o)
                if pa is not pb and pa and pb and pb in self.elig[sid] \
                        and pa in self.elig[o]:
                    g = self._try([(sid, pb), (o, pa)], lambda g: g > 0)
                    done = g is not None and g > 0
            else:
                p = self.pat.get(sid)
                if p and p.breaks:
                    done = self._move_break(sid, rng.choice(p.breaks))
            stall = 0 if done else stall + 1


def _requirements(request, zone_ids):
    obj = request.get("objective", {})
    q = obj.get("demand_quantile", "expected")
    cpsi = obj.get("cases_per_agent_per_interval", 1.0)
    share = request.get("scenario_adjustments", {}).get("remote_share")
    day = datetime.fromisoformat(request["roster_date"]).replace(tzinfo=TZ)
    rows = {z: {} for z in zone_ids}
    for v in request["forecast"]["values"]:
        if v["zone_id"] not in rows:
            continue
        t = datetime.fromisoformat(v["interval_start"]).astimezone(TZ)
        idx = int((t - day).total_seconds() // 900)
        if not 0 <= idx < N:
            continue
        exp = v["expected"]
        if exp > 0:
            fshare = (1 - share) if share is not None else v["field_expected"] / exp
            rshare = share if share is not None else v["remote_inferred_expected"] / exp
        else:
            fshare = rshare = 0
        cell = rows[v["zone_id"]].setdefault(idx, [0.0, 0.0])
        cell[0] += v[q] * fshare
        cell[1] += v[q] * rshare
    out = {}
    for z, cells in rows.items():
        idxs = sorted(cells)
        step = min([b - a for a, b in zip(idxs, idxs[1:])] or [1])
        field = [0.0] * N
        remote = [0.0] * N
        for i, (f, r) in cells.items():
            for t in range(i, min(i + step, N)):
                field[t] += f / step
                remote[t] += r / step
        out[z] = ([_need(x, cpsi) for x in field],
                  [_need(x, cpsi) for x in remote], field)
    return out


def _skill_needs(request, zone_ids, reqs):
    """{zone: {skill: on-duty holders needed per interval}}."""
    obj = request.get("objective", {})
    cpsi = obj.get("cases_per_agent_per_interval", 1.0)
    out = {}
    for z in zone_ids:
        shares = {}
        for r in obj.get("skill_requirements") or []:
            if r.get("zone_id", z) == z:
                shares[r["skill"]] = min(1.0, shares.get(r["skill"], 0.0) + r["share"])
        need, raw = reqs[z][0], reqs[z][2]
        out[z] = {k: [min(need[t], _need(raw[t] * sh, cpsi)) for t in range(N)]
                  for k, sh in sorted(shares.items())}
    return out


def _need(x, cpsi):
    return math.ceil(x / cpsi - 1e-9) if x > 1e-9 else 0


def required_staffing(request, zone_id):
    """Field staffing required per interval for one zone."""
    return _requirements(request, [zone_id])[zone_id][0]


def _blocked(prayer, minutes=PRAYER_WINDOW_MIN):
    out = set()
    for key in ("fajr", "dhuhr", "asr", "maghrib", "isha"):
        if prayer and key in prayer:
            t = _hm(prayer[key])
            out.update(range(t // 15, (t + minutes - 1) // 15 + 1))
    return out


def _dist_m(a, b):
    k = 111320.0
    dy = (a["latitude"] - b["latitude"]) * k
    dx = (a["longitude"] - b["longitude"]) * k * math.cos(
        math.radians((a["latitude"] + b["latitude"]) / 2))
    return math.hypot(dx, dy)


def _overlap(a, b):
    ra = a.get("coverage_radius_m", DEFAULT_RADIUS_M)
    rb = b.get("coverage_radius_m", DEFAULT_RADIUS_M)
    return max(0.0, ra + rb - _dist_m(a, b))


def _standby(rows, points):
    chosen = []
    for r in rows:
        best = None
        ok = r.get("allowed")
        cands = points if ok is None else [points[j] for j in ok]
        if not cands:
            r["standby"] = None
            continue
        for pt in cands:
            c = sum(_overlap(pt, o["pt"]) for o in chosen
                    if o["s"] < r["e"] and r["s"] < o["e"])
            if best is None or c < best[0]:
                best = (c, pt)
        chosen.append({"s": r["s"], "e": r["e"], "pt": best[1]})
        r["standby"] = best[1]["standby_point_id"]


def _sub_demand(request, zone_ids):
    """Field demand per sub-zone and interval."""
    obj = request.get("objective", {})
    q = obj.get("demand_quantile", "expected")
    share = request.get("scenario_adjustments", {}).get("remote_share")
    day = datetime.fromisoformat(request["roster_date"]).replace(tzinfo=TZ)
    cells = {z: {} for z in zone_ids}
    idxs = {z: set() for z in zone_ids}
    for v in request["forecast"]["values"]:
        z = v["zone_id"]
        if z not in cells:
            continue
        t = datetime.fromisoformat(v["interval_start"]).astimezone(TZ)
        idx = int((t - day).total_seconds() // 900)
        if not 0 <= idx < N:
            continue
        exp = v["expected"]
        if exp > 0:
            fshare = (1 - share) if share is not None else v["field_expected"] / exp
        else:
            fshare = 0
        idxs[z].add(idx)
        sub = cells[z].setdefault(v["sub_zone_id"], {})
        sub[idx] = sub.get(idx, 0.0) + v[q] * fshare
    out = {}
    for z in zone_ids:
        ix = sorted(idxs[z])
        step = min([b - a for a, b in zip(ix, ix[1:])] or [1])
        subs = {}
        for sid, by in cells[z].items():
            row = [0.0] * N
            for i, f in by.items():
                for t in range(i, min(i + step, N)):
                    row[t] += f / step
            subs[sid] = row
        out[z] = subs
    return out


class Reach:
    """Service-level reach of one zone."""

    def __init__(self, sl, travel, zone, points, subdem):
        speed = travel.get("average_speed_kmh", DEFAULT_SPEED_KMH)
        detour = travel.get("detour_factor", DEFAULT_DETOUR)
        self.threshold = sl["threshold_seconds"]
        self.target = sl["target_share"]
        self.radius = speed / 3.6 * self.threshold / detour
        centres = {c["sub_zone_id"]: c for c in sl.get("sub_zone_centres", [])
                   if c["zone_id"] == zone}
        self.subs = sorted(subdem)
        self.dem = subdem
        self.points = points
        self.sets = []
        for pt in points:
            self.sets.append(frozenset(
                s for s in self.subs
                if s in centres and _dist_m(pt, centres[s]) <= self.radius))
        self.total = [sum(subdem[s][t] for s in self.subs) for t in range(N)]

    def has_demand(self, t):
        return self.total[t] > EPS

    def geo_need(self):
        """Fewest points reaching the target, per interval."""
        out = [0] * N
        for t in range(N):
            tot = self.total[t]
            if tot <= EPS or not self.sets:
                continue
            union = frozenset().union(*self.sets)
            best = sum(self.dem[s][t] for s in union)
            goal = min(self.target * tot, best) - EPS
            got, seen, k = 0.0, set(), 0
            while got < goal:
                pick = None
                for j, st in enumerate(self.sets):
                    g = sum(self.dem[s][t] for s in st if s not in seen)
                    if pick is None or g > pick[0] + EPS:
                        pick = (g, j)
                if pick[0] <= EPS:
                    break
                seen |= self.sets[pick[1]]
                got += pick[0]
                k += 1
            out[t] = k
        return out

    def choose(self, rows):
        """Standby points maximising reached demand."""
        n = len(self.points)
        cnt = [dict() for _ in range(N)]
        duty = [r["p"].contrib(r["b"]) for r in rows]
        pick = [None] * len(rows)

        def add(i, j, sign):
            for t in duty[i]:
                c = cnt[t]
                for s in self.sets[j]:
                    c[s] = c.get(s, 0) + sign

        def best(i):
            r = rows[i]
            key = None
            ok = r.get("allowed")
            for j in (range(n) if ok is None else ok):
                g = 0.0
                for t in duty[i]:
                    c = cnt[t]
                    g += sum(self.dem[s][t] for s in self.sets[j] if not c.get(s))
                ov = sum(_overlap(self.points[j], self.points[pick[o]])
                         for o in range(len(rows)) if o != i and pick[o] is not None
                         and rows[o]["s"] < r["e"] and r["s"] < rows[o]["e"])
                k = (-round(g, 9), ov, j)
                if key is None or k < key:
                    key = k
            return key[2]

        for i in range(len(rows)):
            pick[i] = best(i)
            add(i, pick[i], 1)
        for _ in range(REACH_PASSES):
            changed = False
            for i in range(len(rows)):
                add(i, pick[i], -1)
                old, pick[i] = pick[i], None
                pick[i] = best(i)
                add(i, pick[i], 1)
                changed = changed or pick[i] != old
            if not changed:
                break
        for i, r in enumerate(rows):
            r["standby"] = self.points[pick[i]]["standby_point_id"]
        return [self._share(cnt, t) for t in range(N)]

    def _share(self, cnt, t):
        if not self.has_demand(t):
            return None
        got = sum(self.dem[s][t] for s in self.subs if cnt[t].get(s))
        return min(1.0, got / self.total[t])

    def shares_for(self, rows, picks):
        """Reach shares of fixed standby picks."""
        cnt = [dict() for _ in range(N)]
        for r, j in zip(rows, picks):
            r["standby"] = self.points[j]["standby_point_id"]
            for t in r["p"].contrib(r["b"]):
                for s in self.sets[j]:
                    cnt[t][s] = cnt[t].get(s, 0) + 1
        return [self._share(cnt, t) for t in range(N)]

    def empty_shares(self):
        return [0.0 if self.has_demand(t) else None for t in range(N)]


def _vehicles(rows, vlist, fixed_v):
    free_at = {v["vehicle_id"]: 0 for v in vlist if v["available"]}
    out = {}
    for r in sorted(rows, key=lambda r: (r["s"], r["sid"])):
        pick = fixed_v.get(r["sid"])
        if pick not in free_at or free_at[pick] > r["s"]:
            pick = r["default"] if r["default"] in free_at \
                and free_at[r["default"]] <= r["s"] else None
        if pick is None:
            pick = next((v for v, f in free_at.items() if f <= r["s"]), None)
        if pick is not None:
            free_at[pick] = r["e"]
            out[r["sid"]] = pick
    return out


def _scenario_id(*parts):
    return str(uuid.uuid5(SCENARIO_NS, "/".join(parts)))


def _headcount(request, deltas, viol):
    """Agents and vehicles after headcount_delta."""
    agents = list(request["agents"])
    vehicles = list(request["vehicles"])
    if not deltas:
        return agents, vehicles
    zones = set(request["zone_ids"])
    fixed = {f["agent_id"]: f for f in request.get("fixed_assignments", [])}
    fixed_v = {f.get("vehicle_id") for f in fixed.values()}
    want = {}
    remote = 0
    for d in deltas:
        z = d["zone_id"]
        if z not in zones:
            continue
        w = want.setdefault(z, [0, 0])
        w[0] += d.get("field_agents", 0)
        w[1] += d.get("vehicles", 0)
        remote += d.get("remote_agents", 0)

    def zone_of(s):
        return fixed[s["agent_id"]]["zone_id"] if s["agent_id"] in fixed \
            else s.get("home_zone_id")

    def change(kind, z, n):
        live = [i for i, s in enumerate(agents) if s["available"]
                and s["kind"] == kind and (kind == "remote" or zone_of(s) == z)]
        if n > 0:
            tmpl = sorted((agents[i] for i in live), key=lambda s: s["agent_id"])
            for k in range(n):
                t = tmpl[k % len(tmpl)] if tmpl else {}
                new = {"agent_id": _scenario_id(kind, z or "remote", str(k)),
                       "kind": kind, "home_zone_id": z, "skills": list(t.get("skills", [])),
                       "default_vehicle_id": None, "available": True}
                if t.get("eligible_shift_pattern_ids") is not None:
                    new["eligible_shift_pattern_ids"] = list(t["eligible_shift_pattern_ids"])
                agents.append(new)
            return
        free = sorted((i for i in live if agents[i]["agent_id"] not in fixed),
                      key=lambda i: agents[i]["agent_id"], reverse=True)
        for i in free[:-n]:
            agents[i] = dict(agents[i], available=False)
        if len(free) < -n:
            viol.append({"code": "HEADCOUNT_DELTA_CAPPED", "message":
                         "asked to remove %d %s agents, only %d could be (approved assignments stay)."
                         % (-n, kind, len(free)), **({"zone_id": z} if z else {})})

    for z in request["zone_ids"]:
        if z not in want:
            continue
        nf, nv = want[z]
        if nf:
            change("field", z, nf)
        if not nv:
            continue
        vl = [i for i, v in enumerate(vehicles) if v["zone_id"] == z]
        if not vl:
            viol.append({"code": "HEADCOUNT_DELTA_NOT_APPLIED", "zone_id": z, "message":
                         "zone lists no vehicles, so vehicles do not limit it; vehicles delta not applied."})
        elif nv > 0:
            vehicles.extend({"vehicle_id": _scenario_id("vehicle", z, str(k)), "zone_id": z,
                             "available": True} for k in range(nv))
        else:
            live = sorted((i for i in vl if vehicles[i]["available"]),
                          key=lambda i: (vehicles[i]["vehicle_id"] not in fixed_v,
                                         vehicles[i]["vehicle_id"]), reverse=True)
            for i in live[:-nv]:
                vehicles[i] = dict(vehicles[i], available=False)
            if len(live) < -nv:
                viol.append({"code": "HEADCOUNT_DELTA_CAPPED", "zone_id": z, "message":
                             "asked to remove %d vehicles, only %d were available." % (-nv, len(live))})
    if remote:
        change("remote", None, remote)
    return agents, vehicles


def _load_cpsat():
    from . import cpsat
    return cpsat, cpsat.load()


def _select(obj):
    """(cpsat module and cp_model, or None; warning or None)."""
    want = obj.get("model_version")
    if want is None or want in (MODEL_VERSION, MODEL_VERSION_REACH, MODEL_STAGGER):
        return None, None
    default = MODEL_VERSION_REACH if obj.get("service_level") else MODEL_VERSION
    if want == MODEL_CPSAT:
        mod, cp = _load_cpsat()
        if cp is not None:
            return (mod, cp), None
        msg = ("Model version %s needs the library ortools, which this engine image does not have; "
               "%s ran instead." % (want, default))
    else:
        msg = ("Model version %r is not known to this engine; %s ran instead. Known: %s."
               % (str(want)[:64], default,
                  ", ".join((MODEL_VERSION, MODEL_VERSION_REACH, MODEL_STAGGER, MODEL_CPSAT))))
    return None, {"code": "MODEL_UNAVAILABLE", "message": msg[:500]}


def handle(request: dict) -> dict:
    t0 = time.perf_counter()
    obj = request.get("objective", {})
    cp, warn = _select(obj)
    stagger = cp is None and (obj.get("model_version") == MODEL_STAGGER
                              or bool(obj.get("max_deploy_distance_km")))
    proven = True
    zones = list(request["zone_ids"])
    total = obj.get("max_run_seconds") or DEFAULT_ZONE_SECONDS * len(zones)
    end = t0 + total * SEARCH_SHARE
    rng = random.Random(obj.get("seed", 0))
    mode = request["calendar_mode"]
    date = request["roster_date"]
    midnight = datetime.fromisoformat(date).replace(tzinfo=TZ)

    def ts(i):
        return (midnight + timedelta(minutes=15 * i)).isoformat()

    viol = []
    adj = request.get("scenario_adjustments", {})
    agents, vehicles = _headcount(request, adj.get("headcount_delta") or [], viol)
    rules = {r["break_rule_id"]: r for r in request["break_rules"]}
    blocked = _blocked(request.get("prayer_times"),
                       request.get("prayer_window_minutes", PRAYER_WINDOW_MIN))
    only = set(adj.get("shift_pattern_ids") or [])
    pats = {}
    for raw in request["shift_patterns"]:
        if only and raw["shift_pattern_id"] not in only:
            continue
        h = raw[mode]
        if not h.get("applies") or "start_time" not in h or "end_time" not in h:
            continue
        rule = rules.get(raw["break_rule_id"])
        if rule is None:
            viol.append({"code": "BREAK_RULE_MISSING", "message":
                         "shift pattern %s names no known break rule; not used." % raw["code"]})
            continue
        p = Pattern(raw, mode, rule, blocked)
        if p.needs_break and not p.breaks:
            viol.append({"code": "BREAK_RULE_UNSATISFIABLE", "message":
                         "shift pattern %s is too long for one break; not used." % p.code})
            continue
        pats[p.id] = (p, raw["kind"])
    reqs = _requirements(request, zones)
    sneeds = _skill_needs(request, zones, reqs)
    svs = {s["agent_id"]: s for s in agents}
    fixed = {f["agent_id"]: f for f in request.get("fixed_assignments", [])}

    def eligible(s):
        ids = s.get("eligible_shift_pattern_ids")
        return [p for p, k in pats.values()
                if k == s["kind"] and (ids is None or p.id in ids)]

    members = {z: [] for z in zones}
    remote = []
    for s in agents:
        if not s["available"]:
            continue
        sid = s["agent_id"]
        if s["kind"] == "remote":
            remote.append(sid)
        else:
            z = fixed[sid]["zone_id"] if sid in fixed else s.get("home_zone_id")
            if z in members:
                members[z].append(sid)
    sl = obj.get("service_level")
    dmax = obj.get("max_deploy_distance_km")
    centres = {c["zone_id"]: c for c in request.get("dispatch_centres", [])}
    if dmax:
        for z in zones:
            if z not in centres:
                viol.append({"code": "DISPATCH_CENTRE_MISSING", "zone_id": z, "message":
                             "no dispatch centre for this zone; the distance limit is not applied."})
    reach = {}
    if sl:
        subdem = _sub_demand(request, zones)
        for z in zones:
            pts = [x for x in request.get("standby_points", []) if x["zone_id"] == z]
            if dmax and z in centres:
                pts = pts + [dict(centres[z], standby_point_id=None)]
            reach[z] = Reach(sl, request.get("travel_model", {}), z, pts, subdem[z])
    jobs = []
    for z in zones:
        vl = [v for v in vehicles if v["zone_id"] == z]
        cap = sum(1 for v in vl if v["available"]) if vl else None
        need = reqs[z][0]
        if z in reach:
            need = [max(a, b) for a, b in zip(need, reach[z].geo_need())]
        jobs.append((z, members[z], need, cap, vl))
    if remote:
        rq = [sum(reqs[z][1][t] for z in zones) for t in range(N)]
        jobs.append((None, remote, rq, None, []))

    rows_all, veh_all, gaps, short_total, costs = [], [], [], 0, []
    by_zone_rows = {}
    for k, (z, sids, req, cap, vl) in enumerate(jobs):
        elig = {s: eligible(svs[s]) for s in sids}
        pool = Pool(sids, elig, req, cap)
        pool.stagger = stagger
        if z is not None:
            pool.need_skills(sneeds[z], lambda s: svs[s].get("skills") or [])
        if z is not None:
            near = _near_points(request, z, dmax, centres, z in reach)
            pool.allowed = {s: near if svs[s].get("home_zone_id") == z else None for s in sids}
        for s in sids:
            f = fixed.get(s)
            if f is None:
                continue
            p = pats.get(f["shift_pattern_id"], (None,))[0]
            if p is None or not pool.lock(s, p):
                viol.append({"code": "FIXED_ASSIGNMENT_NOT_APPLIED", "message":
                             "approved assignment could not be kept (pattern unusable or no vehicle).",
                             "agent_id": s})
        now = time.perf_counter()
        deadline = now + max(0.0, end - now) / (len(jobs) - k)
        rz = reach.get(z) if z is not None else None
        res = None
        if cp is not None:
            res = cp[0].solve_job(cp[1], pool, rz, deadline - now, obj.get("seed", 0))
        if res is not None:
            picks, opt_ = res
            proven = proven and opt_
            pool.cut = not opt_
            pool.cov, pool.on, pool.pat, pool.brk = [0] * N, [0] * N, {}, {}
            pool.bk = [0] * N
            pool.scov = {k: [0] * N for k in pool.sreq}
            for s, (p, b, _) in picks.items():
                pool._apply(p, b, 1, s)
                pool.pat[s], pool.brk[s] = p, b
        else:
            proven = proven and cp is None
            pool.greedy(deadline)
            n = len(sids)
            pool.improve(deadline, rng, STALL_PER_AGENT * n + STALL_BASE)
        rows = []
        for s in sids:
            p = pool.pat.get(s)
            if p is None:
                continue
            b = pool.brk.get(s)
            if p.prayer_relaxed:
                viol.append({"code": "BREAK_OVER_PRAYER", "message":
                             "no break position avoids a prayer window for %s." % p.code,
                             "agent_id": s, **({"zone_id": z} if z else {})})
            rows.append({"sid": s, "p": p, "b": b, "s": p.s, "e": p.e,
                         "default": svs[s].get("default_vehicle_id"),
                         "allowed": pool.allowed.get(s)})
        rows.sort(key=lambda r: (r["s"], r["sid"]))
        if z is not None:
            pts = [x for x in request.get("standby_points", []) if x["zone_id"] == z]
            info = None
            if z in reach:
                rz = reach[z]
                if not (rz.points and rows):
                    shares = rz.empty_shares()
                elif res is not None:
                    shares = rz.shares_for(rows, [picks[r["sid"]][2] for r in rows])
                else:
                    shares = rz.choose(rows)
                info = (rz, reqs[z][0], shares)
            elif pts:
                _standby(rows, pts)
            fv = {s: fixed[s].get("vehicle_id") for s in sids if s in fixed}
            vmap = _vehicles(rows, vl, fv) if cap is not None else {}
            for r in rows:
                if r["sid"] in vmap:
                    veh_all.append({"vehicle_id": vmap[r["sid"]], "agent_id": r["sid"],
                                    "zone_id": z, "roster_date": date,
                                    "shift_pattern_id": r["p"].id})
            gaps.extend(_cells(z, pool, ts, elig, viol, info))
            viol.extend(_skill_gaps(z, pool))
            costs.append(_break_cost(z, pool, rows))
        else:
            sh = pool.short()
            if sh:
                viol.append({"code": "REMOTE_COVERAGE_GAP", "message":
                             ("remote pool is short by %d agent-intervals" % sh
                              + _windows(pool))[:500]})
        short_total += pool.short()
        if pool.cut and pool.short():
            viol.append({"code": "TIME_LIMIT", "message":
                         "time budget reached with gaps left; a longer run may help.",
                         **({"zone_id": z} if z else {})})
        for r in rows:
            p, b = r["p"], r["b"]
            rows_all.append({
                "agent_id": r["sid"], "shift_pattern_id": p.id, "zone_id": z,
                "roster_date": date, "start_at": ts(p.s), "end_at": ts(p.e_abs),
                "break_start_at": ts(b) if b is not None else None,
                "break_end_at": ts(b + p.bm) if b is not None else None,
                "standby_point_id": r.get("standby")})
        by_zone_rows[z] = rows
    needed = sum(sum(j[2]) for j in jobs)
    if not rows_all and needed:
        status = "infeasible"
        viol.append({"code": "NO_ROSTER", "message":
                     "demand exists but no agent could be assigned."})
    elif short_total or viol:
        status = "partial"
    else:
        status = "feasible"
    if warn:
        viol.append(warn)
    if cp is not None:
        model, solver_status = MODEL_CPSAT, "optimal" if proven else "feasible"
    else:
        model = MODEL_STAGGER if stagger else MODEL_VERSION_REACH if sl else MODEL_VERSION
        solver_status = "heuristic"
    srcs = set(request.get("input_data_sources", [])) | {request["data_source"]}
    return envelope(
        request, "optimizer",
        model_version=model,
        illustrative=srcs != {"LIVE"},
        roster_date=date,
        status=status,
        solver_status=solver_status,
        run_seconds=round(time.perf_counter() - t0, 3),
        roster_assignments=rows_all,
        vehicle_assignments=veh_all,
        gap_cells=gaps,
        break_cost=costs,
        violations=viol,
    )


def _near_points(request, z, dmax, centres, with_centre):
    """Allowed standby indices from the home centre, or None."""
    if not dmax or z not in centres:
        return None
    pts = [x for x in request.get("standby_points", []) if x["zone_id"] == z]
    c = centres[z]
    near = [j for j, pt in enumerate(pts) if _dist_m(pt, c) <= dmax * 1000 + EPS]
    return tuple(near + [len(pts)]) if with_centre else tuple(near)


def _break_cost(z, pool, rows):
    """Breaks, cover they cost and most at once."""
    on = [0] * N
    for r in rows:
        if r["b"] is not None:
            for t in r["p"].break_idx(r["b"]):
                on[t] += 1
    lost = sum(max(0, pool.req[t] - pool.cov[t]) - max(0, pool.req[t] - pool.cov[t] - on[t])
               for t in range(N))
    return {"zone_id": z, "breaks": sum(1 for r in rows if r["b"] is not None),
            "lost_agent_intervals": lost, "max_concurrent_breaks": max(on)}


def _windows(pool, most=6):
    """': 07:00-09:00 (up to 2), ...' of short runs."""
    runs, t = [], 0
    while t < N:
        if pool.req[t] <= pool.cov[t]:
            t += 1
            continue
        s, worst = t, 0
        while t < N and pool.req[t] > pool.cov[t]:
            worst = max(worst, pool.req[t] - pool.cov[t])
            t += 1
        runs.append("%02d:%02d-%02d:%02d (up to %d)" % (s // 4, s % 4 * 15, t // 4 % 24,
                                                        t % 4 * 15, worst))
    more = " and %d more" % (len(runs) - most) if len(runs) > most else ""
    return ": " + ", ".join(runs[:most]) + more + "." if runs else "."


def _skill_gaps(z, pool):
    """SKILL_COVERAGE_GAP per zone and skill."""
    out = []
    for k in sorted(pool.sreq):
        miss = pool.skill_short(k)
        n = sum(1 for x in miss if x)
        if n:
            holders = sum(1 for s in pool.sids if k in pool.skills[s])
            out.append({"code": "SKILL_COVERAGE_GAP", "zone_id": z, "message": (
                "%d intervals short of agents with skill %s, worst by %d; %d available hold it."
                % (n, k, max(miss), holders))[:500]})
    return out


def _pct(x):
    return "%d%%" % math.floor(x * 100 + 1e-6)


def _cells(z, pool, ts, elig, viol, info=None):
    cells = []
    worst = 0
    short_n = 0
    causes = set()
    low, low_n = None, 0
    for t in range(N):
        req, planned = pool.req[t], pool.cov[t]
        share = info[2][t] if info else None
        if share is not None and share < info[0].target - EPS:
            low_n += 1
            low = share if low is None else min(low, share)
        if req == 0 and planned == 0:
            continue
        d = planned - req
        cell = {"zone_id": z, "interval_start": ts(t), "interval_index": t,
                "required": req, "planned": planned, "delta": d,
                "kind": "gap" if d < 0 else "surplus" if d > 0 else "balanced",
                "cause": None}
        if share is not None:
            cell["reach_share"] = round(share, 4)
        if d > 0:
            cell["cause"] = "people"
            cell["cause_detail"] = "more agents on shift than required."
        elif d < 0:
            spare = sum(1 for s in pool.sids if any(
                t in p.shift for p in elig[s])
                and not (s in pool.pat and t in pool.pat[s].shift))
            if info and planned >= info[1][t]:
                cell["cause"] = "geography"
                cell["cause_detail"] = (
                    "standby positions reach %s of field demand within %s min; target %s."
                    % (_pct(share or 0.0), _mins(info[0].threshold), _pct(info[0].target)))
            elif pool.cap is not None and pool.on[t] >= pool.cap and spare:
                cell["cause"] = "vehicles"
                cell["cause_detail"] = "all vehicles in use; %d agents could cover." % spare
            else:
                cell["cause"] = "people"
                cell["cause_detail"] = "no more eligible agents for this interval."
            causes.add(cell["cause"])
            worst = max(worst, -d)
            short_n += 1
        cells.append(cell)
    if short_n:
        viol.append({"code": "COVERAGE_GAP", "zone_id": z, "message":
                     "%d intervals short, worst by %d; cause: %s." % (
                         short_n, worst, ", ".join(sorted(causes)))})
    if low_n:
        viol.append({"code": "SERVICE_LEVEL_REACH", "zone_id": z, "message":
                     "%d intervals below the %s target of field demand within %s min; lowest %s."
                     % (low_n, _pct(info[0].target), _mins(info[0].threshold), _pct(low))})
    return cells


def _mins(seconds):
    m = seconds / 60
    return "%d" % m if m == int(m) else "%.1f" % m
