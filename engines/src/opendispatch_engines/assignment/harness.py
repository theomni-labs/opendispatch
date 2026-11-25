# SPDX-License-Identifier: AGPL-3.0-only
"""Scorer vs nearest on replayed SYNTHETIC days.

Run: python -m opendispatch_engines.assignment.harness --fixtures ../fixtures [--tune]
Every figure is synthetic and Illustrative.
"""
import argparse
import json
import math
import os
import uuid
from dataclasses import asdict, replace
from datetime import datetime, timedelta, timezone

from ..simulator import _rows
from ..simulator.core import Sim, haversine_km, parse_ts, quantile
from . import DEFAULT_WEIGHTS, DemandCell, Weights, rank
from .reposition import DEFAULT_REPOSITION, Reposition, plan

THRESHOLD = 600  # the 10-minute measure
PRAYER_MINUTES = 30  # breaks.prayer_window_minutes default
PRAYERS = ("fajr", "dhuhr", "asr", "maghrib", "isha")
CELL_DEG = 0.01  # micro-cell edge, about 1.1 km
TRAIN_DAYS = ("2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09")
HELD_OUT_DAYS = ("2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13")
REPLAY_DAY = "2026-09-13"
TZ = timezone(timedelta(hours=3))
MAX_WORKERS = 6  # shared server: keep the pool small
LAST_TICK_SECONDS = 3600  # replans stop this long after the last case


def _load(fx, rel):
    with open(os.path.join(fx, rel), encoding="utf-8") as f:
        return json.load(f)


def _shift(ts, days):
    return (parse_ts(ts) + timedelta(days=days)).isoformat() if ts else ts


def _complete_rosters(fx):
    """Roster days that staff every zone."""
    zones = {z["id"] for z in _load(fx, "locations/zones.json")}
    out = []
    for f in sorted(os.listdir(os.path.join(fx, "plans/roster_assignments"))):
        lines = _load(fx, f"plans/roster_assignments/{f}")
        if zones <= {ln["zone_id"] for ln in lines}:
            out.append(f[:-5])
    return out


def _roster_file(fx, when):
    """Same-weekday roster day, else the last complete one."""
    have = _complete_rosters(fx)
    pick = next((n for n in have if datetime.fromisoformat(n).weekday() == when.weekday()),
                have[-1])
    return f"plans/roster_assignments/{pick}.json", (when - datetime.fromisoformat(pick)).days


def day_request(fx, day, travel_model=None, seed=1):
    """Simulator request for one synthetic day."""
    if day == REPLAY_DAY:
        cases = _load(fx, "replay/cases.json")
    else:
        cases = _load(fx, f"cases/{day}.json")
    d = datetime.fromisoformat(day)
    start = d.replace(tzinfo=TZ).timestamp()
    lines = []
    for when in (d - timedelta(days=1), d):
        f, lag = _roster_file(fx, when)
        lines += [(ln, lag) for ln in _load(fx, f)]
    points = {p["id"]: p for p in _load(fx, "locations/standby_points.json")}
    sim_lines = []
    for ln, lag in lines:
        if ln["zone_id"] is None:
            continue  # remote reviewers: not field capacity
        if parse_ts(_shift(ln["end_at"], lag)).timestamp() <= start:
            continue
        s = {"agent_id": ln["agent_id"],
             "shift_pattern_id": ln["shift_pattern_id"],
             "zone_id": ln["zone_id"],
             "start_at": _shift(ln["start_at"], lag),
             "end_at": _shift(ln["end_at"], lag),
             "break_start_at": _shift(ln.get("break_start_at"), lag),
             "break_end_at": _shift(ln.get("break_end_at"), lag)}
        p = points.get(ln.get("standby_point_id"))
        if p:
            s["start_latitude"], s["start_longitude"] = p["latitude"], p["longitude"]
        sim_lines.append(s)
    return {
        "schema_version": "1.0", "request_id": str(uuid.UUID(int=int(d.timestamp()))),
        "requested_at": f"{day}T00:00:00+03:00", "data_source": "SYNTHETIC",
        "clock_start_primary": "registration", "threshold_seconds": THRESHOLD,
        "assignment_policy": "nearest", "seed": seed,
        "travel_model": travel_model or {"average_speed_kmh": 40.0, "detour_factor": 1.3},
        "cases": [{"case_id": c["id"], "registered_at": c["registered_at"],
                   "zone_id": c["zone_id"], "latitude": c["latitude"],
                   "longitude": c["longitude"], "handling": c["handling"]}
                  for c in cases],
        "roster": {"roster_ref": f"synthetic-{day}", "assignments": sim_lines},
    }


def demand_model(fx, days):
    """Field cases per hour per micro-cell, from days."""
    acc = {}
    for day in days:
        for c in _load(fx, f"cases/{day}.json"):
            if c["handling"] != "field":
                continue
            h = parse_ts(c["registered_at"]).astimezone(TZ).hour
            cell = (math.floor(c["latitude"] / CELL_DEG), math.floor(c["longitude"] / CELL_DEG))
            a = acc.setdefault((c["zone_id"], h), {}).setdefault(cell, [0, 0.0, 0.0])
            a[0] += 1
            a[1] += c["latitude"]
            a[2] += c["longitude"]
    n = len(days)
    return {k: [(v[1] / v[0], v[2] / v[0], v[0] / n) for v in cells.values()]
            for k, cells in acc.items()}


def demand_at(model, zone, ts):
    """Expected field cases in the next hour."""
    t = datetime.fromtimestamp(ts, TZ)
    f = t.minute / 60
    out = {}
    for h, share in ((t.hour, 1 - f), ((t.hour + 1) % 24, f)):
        for lat, lon, rate in model.get((zone, h), ()):
            k = (round(lat, 5), round(lon, 5))
            out[k] = out.get(k, 0.0) + rate * share
    return [DemandCell(k[0], k[1], v) for k, v in out.items() if v > 0]


def cell_model(fx, days):
    """Per zone: micro-cells with field cases per hour (24)."""
    acc = {}
    for day in days:
        for c in _load(fx, f"cases/{day}.json"):
            if c["handling"] != "field":
                continue
            h = parse_ts(c["registered_at"]).astimezone(TZ).hour
            cell = (math.floor(c["latitude"] / CELL_DEG), math.floor(c["longitude"] / CELL_DEG))
            a = acc.setdefault(c["zone_id"], {}).setdefault(cell, [0.0, 0.0, [0] * 24])
            a[0] += c["latitude"]
            a[1] += c["longitude"]
            a[2][h] += 1
    n = len(days)
    return {z: [(v[0] / sum(v[2]), v[1] / sum(v[2]), [x / n for x in v[2]])
                for v in cells.values()] for z, cells in acc.items()}


def cells_at(model, zone, ts, hours=1):
    """Every cell of the zone, with cases expected over hours from ts."""
    h = datetime.fromtimestamp(ts, TZ).hour
    return [(lat, lon, sum(by[(h + i) % 24] for i in range(hours)))
            for lat, lon, by in model.get(zone, ())]


def prayer_windows(fx, day):
    """Per city: list of (start, end) epoch seconds."""
    rows = _load(fx, "reference/prayer_times.json")
    have = sorted({r["prayer_date"] for r in rows})
    use = day if day in have else have[-1]
    out = {}
    for r in rows:
        if r["prayer_date"] != use:
            continue
        for p in PRAYERS:
            hh, mm = map(int, r[p].split(":"))
            st = datetime.fromisoformat(day).replace(hour=hh, minute=mm, tzinfo=TZ)
            out.setdefault(r["city_id"], []).append(
                (p, st.timestamp(), st.timestamp() + PRAYER_MINUTES * 60))
    return out


def _iso(ts):
    return datetime.fromtimestamp(ts, TZ).isoformat()


class ScorerSim(Sim):
    """The simulator, with optional engine dispatch and idle repositioning."""

    def __init__(self, req, weights=DEFAULT_WEIGHTS, demand=None, cells=None,
                 reposition=None, prayers=None, zone_city=None, deadline_ms=2000):
        super().__init__(req)
        self.weights = weights
        self.demand = demand
        self.cells = cells
        self.repo = reposition
        self.prayers = prayers or {}
        self.zone_city = zone_city or {}
        self.deadline_ms = deadline_ms
        self.decision_ms = []
        self.moves = 0
        self.move_km = 0.0
        self.next_tick = -math.inf
        self.last_tick = None
        self.by_zone = {}
        for s in self.sv.values():
            for ln in s.lines:
                self.by_zone.setdefault(ln["zone"], set()).add(s)

    def _window(self, zone, t):
        for name, st, en in sorted(self.prayers.get(self.zone_city.get(zone), ()),
                                   key=lambda x: x[1]):
            if en > t:
                return {"name": name, "starts_at": _iso(st), "ends_at": _iso(en)}
        return None

    def ask_engine(self, c, t, zone, free):
        pool = sorted(((s, s.line(t, zone)) for s in self.by_zone.get(zone, ())),
                      key=lambda x: x[0].id)
        pool = [(s, ln) for s, ln in pool if ln is not None]
        if not pool:
            return None
        rid = uuid.uuid5(uuid.NAMESPACE_URL, f"{c['case_id']}:{t}")
        req = {"schema_version": "1.0", "request_id": str(rid),
               "requested_at": _iso(t), "data_source": "SYNTHETIC", "now": _iso(t),
               "stage": "automatic", "decision_deadline_ms": self.deadline_ms, "top_n": 1,
               "case": {"case_id": c["case_id"], "registered_at": c["registered_at"],
                        "zone_id": zone, "latitude": c["latitude"],
                        "longitude": c["longitude"], "handling": "field",
                        "required_skills": [], "existing_assignment_id": None},
               "candidates": [self.candidate(s, ln, t, zone) for s, ln in pool],
               "prayer_window": self._window(zone, t),
               "travel_model": {"average_speed_kmh": self.speed,
                                "detour_factor": self.detour}}
        demand = demand_at(self.demand, zone, t) if self.demand else None
        out = rank(req, self.weights, demand)
        self.decisions += 1
        self.decision_ms.append(out["decision_time_ms"])
        if out["status"] == "ranked" and not out.get("deadline_exceeded"):
            return self.sv.get(out["ranking"][0]["agent_id"])
        if free:
            self.fallbacks += 1  # The customer's dispatch: nearest
        return None

    def reposition(self, t):
        """Send idle agents to the zone's waiting spots."""
        rp = self.repo
        for zone in sorted(z for z in self.by_zone if z is not None):
            idle = [s for s in self.by_zone[zone] if s.free_at <= t and s.on_duty(t, zone)]
            if not idle:
                continue
            now = {s.id: self.origin(s, t) for s in idle}
            heading = [(s.id, now[s.id], s.home if s.home is not None else s.pos)
                       for s in idle]
            cells = cells_at(self.cells, zone, t, rp.look_ahead_hours)
            for sid, tgt in plan(heading, cells, rp):
                s, o = self.sv[sid], now[sid]
                s.pos, s.home = o, tgt
                s.back_until = (t, t + self.travel(o, tgt, t, zone))
                self.moves += 1
                self.move_km += haversine_km(o, tgt)

    def dispatch(self, t, queues, push, queued_ids):
        if self.repo and self.cells and t >= self.next_tick:
            if self.last_tick is None:
                self.last_tick = (max(self.elig.values()) if self.elig else t) + LAST_TICK_SECONDS
            self.reposition(t)
            self.next_tick = t + self.repo.period_seconds
            if self.next_tick < self.last_tick:
                push(self.next_tick, 2)
        super().dispatch(t, queues, push, queued_ids)


def _mean(v):
    return sum(v) / len(v) if v else None


def metrics(sim):
    rows = [r for r in _rows(sim) if r["field"]]
    served = [r for r in rows if r["served"]]
    reg = sorted(r["reg_arr"] for r in served)
    asg = sorted(r["asg_arr"] for r in served)
    n = len(rows)
    return {
        "field_cases": n, "served": len(served),
        "reg_mean": _mean(reg), "reg_p50": quantile(reg, 0.5), "reg_p90": quantile(reg, 0.9),
        "asg_mean": _mean(asg), "asg_p50": quantile(asg, 0.5), "asg_p90": quantile(asg, 0.9),
        "within_reg": sum(1 for x in reg if x <= THRESHOLD) / n if n else None,
        "within_asg": sum(1 for x in asg if x <= THRESHOLD) / n if n else None,
        "trip_km": sum(o["km"] for o in sim.res.values() if o),
    }


def zone_cities(fx):
    return {z["id"]: z["city_id"] for z in _load(fx, "locations/zones.json")}


# arm: (engine dispatch, prayer penalty, repositioning)
ARMS = {"nearest": (False, False, False), "scorer": (True, False, False),
        "reposition": (False, False, True), "scorer_reposition": (True, False, True)}
COUNTS = ("field_cases", "served", "decisions", "fallbacks", "moves")
SUMS = ("move_km", "trip_km")


def run_day(fx, day, arm, weights=DEFAULT_WEIGHTS, demand=None, cells=None,
            reposition=DEFAULT_REPOSITION, seed=1):
    engine, prayer, repo = ARMS[arm]
    req = day_request(fx, day, seed=seed)
    if engine:
        req["assignment_policy"] = "scorer"
    sim = ScorerSim(req, weights, demand if engine else None, cells,
                    reposition if repo else None,
                    prayer_windows(fx, day) if prayer else None, zone_cities(fx))
    sim.run()
    out = metrics(sim)
    out.update(decisions=sim.decisions, fallbacks=sim.fallbacks, moves=sim.moves,
               move_km=sim.move_km,
               decision_ms_max=max(sim.decision_ms) if sim.decision_ms else 0)
    return out


def pooled(results):
    """Case-weighted means over runs; counts and km per run."""
    keys = [k for k in results[0] if isinstance(results[0][k], (int, float))]
    n = sum(r["field_cases"] for r in results)
    out = {}
    for k in keys:
        if k in COUNTS or k in SUMS:
            out[k] = sum(r[k] for r in results) / len(results)
        elif k == "decision_ms_max":
            out[k] = max(r[k] for r in results)
        else:
            out[k] = sum(r[k] * r["field_cases"] for r in results) / n
    return out


def paired(res, arm, key, runs):
    """Mean and standard error of the % change vs nearest."""
    d = [(res[(dy, sd, arm)][key] - res[(dy, sd, "nearest")][key])
         / res[(dy, sd, "nearest")][key] * 100 for dy, sd in runs]
    m = sum(d) / len(d)
    se = (sum((x - m) ** 2 for x in d) / (len(d) - 1) / len(d)) ** 0.5 if len(d) > 1 else None
    return {"pct": round(m, 2), "se": round(se, 2) if se is not None else None}


def paired_pp(res, arm, key, runs):
    d = [(res[(dy, sd, arm)][key] - res[(dy, sd, "nearest")][key]) * 100 for dy, sd in runs]
    m = sum(d) / len(d)
    se = (sum((x - m) ** 2 for x in d) / (len(d) - 1) / len(d)) ** 0.5 if len(d) > 1 else None
    return {"pp": round(m, 2), "se": round(se, 2) if se is not None else None}


_MODELS = {}


def _models(fx, train):
    k = (fx, tuple(train))
    if k not in _MODELS:
        _MODELS[k] = (demand_model(fx, train), cell_model(fx, train))
    return _MODELS[k]


def _work(job):
    fx, day, seed, arm, wd, rd, train = job
    demand, cells = _models(fx, train)
    return (day, seed, arm, json.dumps([wd, rd], sort_keys=True)), run_day(
        fx, day, arm, Weights(**wd), demand, cells, Reposition(**rd), seed)


def reposition_grid():
    return [Reposition(period_seconds=p, min_move_km=mm, max_move_km=mx)
            for p in (900, 1800) for mm in (2.0, 3.0) for mx in (5.0, 0.0)]


def tune(pool, fx, train, seeds, weights):
    """Best reg median on training days, idle km capped at nearest's trip km."""
    cands = reposition_grid()
    arms = ("nearest", "scorer_reposition")
    jobs = [(fx, d, sd, arm, asdict(weights), asdict(r), train)
            for r in cands for d in train for sd in seeds for arm in arms]
    res = dict(pool.map(_work, jobs, chunksize=1))
    near = pooled([v for (_, _, a, _), v in res.items() if a == "nearest"])
    table = []
    for r in cands:
        k = json.dumps([asdict(weights), asdict(r)], sort_keys=True)
        p = pooled([v for (_, _, a, wk), v in res.items() if wk == k and a != "nearest"])
        table.append((p["move_km"] > near["trip_km"], p["reg_p50"], p["move_km"], r))
    table.sort(key=lambda x: (x[0], x[1]))
    return table


def evaluate(pool, fx, days, seeds, weights, repo, train, arms=tuple(ARMS)):
    jobs = [(fx, d, sd, arm, asdict(weights), asdict(repo), train)
            for d in days for sd in seeds for arm in arms]
    res = {(d, sd, arm): r for (d, sd, arm, _), r in pool.map(_work, jobs, chunksize=1)}
    runs = [(d, sd) for d in days for sd in seeds]
    out = {"pooled": {}, "vs_nearest": {}, "days": {}}
    for arm in arms:
        out["pooled"][arm] = pooled([res[(d, sd, arm)] for d, sd in runs])
        for d in days:
            out["days"].setdefault(d, {})[arm] = pooled([res[(d, sd, arm)] for sd in seeds])
        if arm != "nearest":
            v = {k: paired(res, arm, k, runs) for k in (
                "reg_mean", "reg_p50", "reg_p90", "asg_mean", "asg_p50", "asg_p90")}
            for k in ("within_reg", "within_asg"):
                v[k + "_pp"] = paired_pp(res, arm, k, runs)
            v["days_reg_p50"] = {d: paired(res, arm, "reg_p50", [(d, sd) for sd in seeds])["pct"]
                                 for d in days}
            out["vs_nearest"][arm] = v
    return out


def main(argv=None):
    import multiprocessing as mp
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixtures", default=os.environ.get("OPENDISPATCH_FIXTURES_DIR", "../fixtures"))
    ap.add_argument("--tune", action="store_true", help="repositioning grid on training days")
    ap.add_argument("--seeds", type=int, default=5, help="on-scene draws per day")
    ap.add_argument("--workers", type=int, default=MAX_WORKERS)
    a = ap.parse_args(argv)
    fx, train, seeds = a.fixtures, list(TRAIN_DAYS), list(range(1, a.seeds + 1))
    weights, repo = DEFAULT_WEIGHTS, DEFAULT_REPOSITION
    report = {"train_days": train, "held_out_days": list(HELD_OUT_DAYS), "seeds": seeds,
              "data_source": "SYNTHETIC", "illustrative": True}
    with mp.Pool(min(a.workers, MAX_WORKERS)) as pool:
        if a.tune:
            table = tune(pool, fx, train, seeds, weights)
            report["tuning"] = [dict(over_km_cap=o, reg_p50=round(m, 1), move_km=round(k),
                                     **asdict(r)) for o, m, k, r in table]
            repo = table[0][3]
        report["weights"] = asdict(weights)
        report["reposition"] = asdict(repo)
        report["held_out"] = evaluate(pool, fx, list(HELD_OUT_DAYS), seeds, weights, repo, train)
    print(json.dumps(report, indent=1, default=float))
    return report


if __name__ == "__main__":
    main()
