# SPDX-License-Identifier: AGPL-3.0-only
"""Discrete-event simulation of one zone-day."""
import bisect
import heapq
import math
import random
import uuid
from datetime import datetime, timezone

from .params import DEFAULTS

DEFAULT_SPEED_KMH = 40.0
DEFAULT_DETOUR = 1.3
Z90 = 1.2815515655446004
OVERRUN_SECONDS = 300  # busy_until once the estimate passed
SCORER_DEADLINE_MS = 2000
INTERVAL_SECONDS = 900
EARTH_KM = 6371.0088


def _iso(ts, tz):
    return datetime.fromtimestamp(ts, tz).isoformat()


def parse_ts(s):
    d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def haversine_km(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_KM * math.asin(math.sqrt(h))


def quantile(sorted_v, q):
    if not sorted_v:
        return None
    k = (len(sorted_v) - 1) * q
    lo = int(math.floor(k))
    hi = min(lo + 1, len(sorted_v) - 1)
    return sorted_v[lo] + (sorted_v[hi] - sorted_v[lo]) * (k - lo)


def normal(seed, case_id, tag):
    return random.Random(f"{seed}:{case_id}:{tag}").gauss(0.0, 1.0)


def lognormal(median, p90, z):
    if median <= 0:
        return 0.0
    sigma = math.log(p90 / median) / Z90 if p90 > median else 0.0
    return median * math.exp(sigma * z)


def on_scene_seconds(case, seed, p=DEFAULTS):
    if case.get("on_scene_seconds") is not None:
        return float(case["on_scene_seconds"])
    v = lognormal(p.on_scene_median_seconds, p.on_scene_p90_seconds,
                  normal(seed, case["case_id"], "scene"))
    return min(max(v, p.on_scene_min_seconds), p.on_scene_cap_seconds)


def dispatch_delay_seconds(case, seed, p=DEFAULTS):
    v = lognormal(p.dispatch_delay_median_seconds, p.dispatch_delay_p90_seconds,
                  normal(seed, case["case_id"], "delay"))
    return min(v, p.dispatch_delay_cap_seconds)


class Agent:
    def __init__(self, sid):
        self.id = sid
        self.lines = []
        self.pos = None
        self.home = None
        self.back_until = None
        self.free_at = -math.inf
        self.done = 0
        self.busy = []

    def serves(self, zone):
        # a line with no zone is remote review, not field
        return any(ln["zone"] == zone for ln in self.lines)

    def line(self, t, zone):
        for ln in self.lines:
            if ln["zone"] == zone and ln["start"] <= t < ln["end"]:
                return ln
        return None

    def on_duty(self, t, zone):
        for ln in self.lines:
            if ln["zone"] != zone:
                continue
            if ln["start"] <= t < ln["end"]:
                if ln["bs"] is not None and ln["bs"] <= t < ln["be"]:
                    continue
                return True
        return False


def build_agents(roster, cases):
    field = [c for c in cases if c["handling"] == "field"]
    allpts = [(c["latitude"], c["longitude"]) for c in cases]
    zpts = {}
    for c in field:
        zpts.setdefault(c["zone_id"], []).append((c["latitude"], c["longitude"]))

    def centroid(pts):
        if not pts:
            return (0.0, 0.0)
        return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))

    sv = {}
    for a in roster["assignments"]:
        s = sv.setdefault(a["agent_id"], Agent(a["agent_id"]))
        bs, be = a.get("break_start_at"), a.get("break_end_at")
        s.lines.append({
            "zone": a.get("zone_id"),
            "start": parse_ts(a["start_at"]).timestamp(),
            "end": parse_ts(a["end_at"]).timestamp(),
            "bs": parse_ts(bs).timestamp() if bs and be else None,
            "be": parse_ts(be).timestamp() if bs and be else None,
        })
        if s.pos is None:
            if "start_latitude" in a and "start_longitude" in a:
                s.pos = (a["start_latitude"], a["start_longitude"])
            else:
                z = a.get("zone_id")
                s.pos = centroid(zpts.get(z) or allpts)
            s.home = s.pos
    return sv


class Sim:
    def __init__(self, req, params=None):
        self.req = req
        self.p = params or DEFAULTS
        tm = req.get("travel_model") or {}
        self.speed = float(tm.get("average_speed_kmh", DEFAULT_SPEED_KMH))
        self.detour = float(tm.get("detour_factor", DEFAULT_DETOUR))
        self.policy = req.get("assignment_policy", "nearest")
        self.seed = req.get("seed", 0)
        self.cases = req["cases"]
        self.reg = {c["case_id"]: parse_ts(c["registered_at"]) for c in self.cases}
        self.tz = next(iter(self.reg.values())).tzinfo if self.reg else timezone.utc
        self.sv = build_agents(req["roster"], self.cases)
        self.zf = dict(self.p.speed_factor_by_zone)
        self.res = {}
        self.est = {}
        self.decisions = self.fallbacks = 0
        self.warnings = []
        remote = sum(1 for a in req["roster"]["assignments"] if a.get("zone_id") is None)
        if remote:
            self.warnings.append(
                f"{remote} roster lines with no zone (remote review) "
                "are not field capacity")

    def factor(self, t):
        h = datetime.fromtimestamp(t, self.tz).hour
        return self.p.speed_factor_by_hour[h]

    def travel(self, a, b, t=None, zone=None):
        f = 1.0 if t is None else self.factor(t)
        f *= self.zf.get(zone, 1.0)
        return haversine_km(a, b) * self.detour / (self.speed * f) * 3600.0

    def origin(self, s, t):
        # driving back to base after the last job
        if s.back_until is None or t >= s.back_until[1]:
            return s.home if s.back_until is not None else s.pos
        (lat0, lon0), (t0, t1) = s.pos, s.back_until
        if t <= t0 or t1 <= t0:
            return s.pos
        f = (t - t0) / (t1 - t0)
        return (lat0 + (s.home[0] - lat0) * f, lon0 + (s.home[1] - lon0) * f)

    def score(self, s, case_pos, t, zone=None):
        return self.travel(self.origin(s, t), case_pos, t, zone)

    def run(self):
        heap, seq = [], 0

        def push(t, kind, payload=None):
            nonlocal seq
            seq += 1
            heapq.heappush(heap, (t, kind, seq, payload))

        queues = {}
        self.elig = {}
        replay = self.policy == "replay_actual"
        unpinned = 0
        for c in sorted(self.cases, key=lambda c: (self.reg[c["case_id"]], c["case_id"])):
            if c["handling"] != "field":
                continue
            pin = None
            if replay and c.get("actual_assigned_at") and c.get("actual_agent_id") in self.sv:
                pin = parse_ts(c["actual_assigned_at"]).timestamp()
            if replay and pin is None:
                unpinned += 1
            if pin is not None:
                push(pin, 0, c)
            else:
                d = dispatch_delay_seconds(c, self.seed, self.p)
                self.elig[c["case_id"]] = self.reg[c["case_id"]].timestamp() + d
                push(self.elig[c["case_id"]], 1, c)
        if unpinned:
            self.warnings.append(
                f"replay_actual: {unpinned} field cases had no usable recorded "
                "assignment and were assigned by nearest")
        for s in self.sv.values():
            for ln in s.lines:
                push(ln["start"], 2)
                if ln["be"] is not None:
                    push(ln["be"], 2)
        queued_ids = set()
        while heap:
            t, kind, _, c = heapq.heappop(heap)
            if kind == 0:
                self.pin(c, t, push)
            elif kind == 1:
                queues.setdefault(c["zone_id"], []).append(c)
            self.dispatch(t, queues, push, queued_ids)
        self.queued = len(queued_ids)
        for q in queues.values():
            for c in q:
                self.res[c["case_id"]] = None

    def residual(self, km, z):
        bands, table = self.p.travel_bands_km, self.p.travel_residual_quantiles
        if not table:
            return math.exp(self.p.travel_noise_sigma * z)
        q = table[bisect.bisect_left(bands, km)]
        u = min(max(0.5 * math.erfc(-z / math.sqrt(2.0)), 0.0), 1.0)
        k = u * (len(q) - 1)
        i = min(int(k), len(q) - 2)
        return q[i] + (q[i + 1] - q[i]) * (k - i)

    def drive(self, s, c, start):
        pos = (c["latitude"], c["longitude"])
        o = self.origin(s, start)
        base = self.travel(o, pos, start, c["zone_id"])
        km = haversine_km(o, pos)
        r = self.residual(km, normal(self.seed, c["case_id"], "travel"))
        return self.p.trip_overhead_seconds + base * r, base, km

    def finish(self, s, c, start, assigned):
        pos = (c["latitude"], c["longitude"])
        took, base, km = self.drive(s, c, start)
        arrive = start + took
        end = arrive + on_scene_seconds(c, self.seed, self.p)
        s.busy.append((start, end))
        s.pos, s.free_at = pos, end
        if self.p.return_to_base and s.home is not None:
            back = self.travel(pos, s.home, end, c["zone_id"])
            s.back_until = (end, end + back)
        s.done += 1
        self.est[s.id] = arrive + self.p.on_scene_median_seconds
        self.res[c["case_id"]] = {"agent": s.id, "assigned": assigned,
                                  "arrived": arrive, "base_travel": base,
                                  "km": km}
        return end

    def pin(self, c, t, push):
        s = self.sv[c["actual_agent_id"]]
        end = self.finish(s, c, max(t, s.free_at), t)
        push(end, 2)

    def dispatch(self, t, queues, push, queued_ids):
        for zone, q in queues.items():
            while q:
                el = [s for s in self.sv.values()
                      if s.free_at <= t and s.serves(zone) and s.on_duty(t, zone)]
                c = q[0]
                s = None
                if self.policy == "scorer":
                    s = self.ask_engine(c, t, zone, el)
                if s is None and not el:
                    break
                if s is None:
                    pos = (c["latitude"], c["longitude"])
                    s = min(el, key=lambda x: (self.score(x, pos, t, zone), x.id))
                if self.elig[c["case_id"]] < t:
                    queued_ids.add(c["case_id"])
                q.pop(0)
                push(self.finish(s, c, max(t, s.free_at), t), 2)

    def busy_until(self, s, t):
        """What a live feed would send: an estimate."""
        if s.free_at <= t:
            return None
        return max(self.est.get(s.id, s.free_at), t + OVERRUN_SECONDS)

    def candidate(self, s, ln, t, zone):
        lat, lon = self.origin(s, t)
        c = {"agent_id": s.id, "latitude": lat, "longitude": lon,
             "position_at": _iso(t, self.tz), "roster_zone_id": zone,
             "shift_end_at": _iso(ln["end"], self.tz), "skills": [],
             "has_vehicle": True, "cases_today": s.done}
        if ln["bs"] is not None and ln["bs"] <= t < ln["be"]:
            c.update(status="on_break", on_break_until=_iso(ln["be"], self.tz))
        elif s.free_at > t:
            c.update(status="on_scene",
                     busy_until=_iso(self.busy_until(s, t), self.tz))
        else:
            c["status"] = "available"
        if ln["bs"] is not None and ln["bs"] > t:
            c["next_break_due_at"] = _iso(ln["bs"], self.tz)
        return c

    def ask_engine(self, c, t, zone, free):
        """The assignment engine's pick, in process."""
        from ..assignment import rank
        pool = [(s, s.line(t, zone)) for s in self.sv.values()]
        pool = [(s, ln) for s, ln in pool if ln is not None]
        if not pool:
            return None
        rid = uuid.uuid5(uuid.NAMESPACE_URL, f"{c['case_id']}:{t}")
        req = {"schema_version": "1.0", "request_id": str(rid),
               "requested_at": _iso(t, self.tz),
               "data_source": self.req["data_source"],
               "now": _iso(t, self.tz), "stage": "automatic",
               "decision_deadline_ms": SCORER_DEADLINE_MS, "top_n": 1,
               "case": {"case_id": c["case_id"], "registered_at": c["registered_at"],
                        "zone_id": zone, "latitude": c["latitude"],
                        "longitude": c["longitude"], "handling": "field",
                        "required_skills": [], "existing_assignment_id": None},
               "candidates": [self.candidate(s, ln, t, zone) for s, ln in pool],
               "prayer_window": None,
               "travel_model": {"average_speed_kmh": self.speed,
                                "detour_factor": self.detour}}
        out = rank(req)
        self.decisions += 1
        if out["status"] == "ranked" and not out.get("deadline_exceeded"):
            return self.sv.get(out["ranking"][0]["agent_id"])
        if free:
            self.fallbacks += 1  # The customer's dispatch: nearest
        return None

    def outcomes(self):
        return self.res
