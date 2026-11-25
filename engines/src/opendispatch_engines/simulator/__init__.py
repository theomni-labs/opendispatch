# SPDX-License-Identifier: AGPL-3.0-only
"""Deterministic discrete-event simulator (see README)."""
from datetime import datetime

from ..common import envelope
from .core import INTERVAL_SECONDS, Sim, parse_ts, quantile

SIMULATOR_VERSION = "0.3.0"
REAL = ("LIVE", "IMPORTED")


def _pct(v):
    v = sorted(v)
    if not v:
        return {"median_seconds": None, "p90_seconds": None}
    return {"median_seconds": round(quantile(v, 0.5), 1),
            "p90_seconds": round(quantile(v, 0.9), 1)}


def _reading(flags):
    n = len(flags)
    w = sum(1 for f in flags if f)
    return {"within_count": w, "case_count": n, "share": round(w / n, 6) if n else None}


def _level(rows, util, th):
    field = [r for r in rows if r["field"]]
    served = [r for r in field if r["served"]]
    out = {
        "case_count": len(rows),
        "field_case_count": len(field),
        "remote_case_count": len(rows) - len(field),
        "from_registration": _reading(
            [r["served"] and r["reg_arr"] <= th for r in field]),
        "from_assignment": _reading(
            [r["served"] and r["asg_arr"] <= th for r in field]),
        "registered_to_assigned": _pct([max(0.0, r["reg_asg"]) for r in served]),
        "assigned_to_arrived": _pct([r["asg_arr"] for r in served]),
        "registered_to_arrived": _pct([r["reg_arr"] for r in served]),
    }
    if util is not None:
        out["agent_utilisation"] = util
    return out


def _utilisation(sim, zone):
    busy = duty = 0.0
    for s in sim.sv.values():
        if zone is not None and not any(ln["zone"] == zone for ln in s.lines):
            continue
        for ln in s.lines:
            if ln["zone"] is None or zone is not None and ln["zone"] != zone:
                continue
            d = ln["end"] - ln["start"]
            if ln["bs"] is not None:
                d -= ln["be"] - ln["bs"]
            duty += d
            busy += sum(max(0.0, min(e, ln["end"]) - max(b, ln["start"]))
                        for b, e in s.busy)
    return round(min(1.0, busy / duty), 4) if duty > 0 else None


def _rows(sim):
    rows = []
    for c in sim.cases:
        reg = sim.reg[c["case_id"]]
        r = {"case": c, "zone": c["zone_id"], "field": c["handling"] == "field",
             "served": False, "reg": reg}
        if r["field"]:
            o = sim.res.get(c["case_id"])
            if o:
                r.update(served=True, agent=o["agent"], asg=o["assigned"],
                         arr=o["arrived"], reg_asg=o["assigned"] - reg.timestamp(),
                         asg_arr=o["arrived"] - o["assigned"],
                         reg_arr=o["arrived"] - reg.timestamp())
        rows.append(r)
    return rows


def _interval(reg):
    secs = reg.hour * 3600 + reg.minute * 60 + reg.second
    idx = secs // INTERVAL_SECONDS
    start = reg.replace(hour=0, minute=0, second=0, microsecond=0)
    start = datetime.fromtimestamp(start.timestamp() + idx * INTERVAL_SECONDS, reg.tzinfo)
    return int(idx), start


TOL_MEDIAN_PCT, TOL_SHARE_PP = 10.0, 5.0


def _clock(pairs, th):
    rec = sorted(x[0] for x in pairs)
    sim = sorted(x[1] for x in pairs)
    rm, sm = quantile(rec, 0.5), quantile(sim, 0.5)
    rs = sum(1 for x in rec if x <= th) / len(rec)
    ss = sum(1 for x in sim if x <= th) / len(sim)
    return {"recorded_median": rm, "simulated_median": sm,
            "median_dev_pct": (sm - rm) / rm * 100 if rm else float("nan"),
            "recorded_mean": sum(rec) / len(rec), "simulated_mean": sum(sim) / len(sim),
            "recorded_share": rs, "simulated_share": ss, "share_pp": (ss - rs) * 100}


def _met(c):
    return abs(c["median_dev_pct"]) <= TOL_MEDIAN_PCT and abs(c["share_pp"]) <= TOL_SHARE_PP


def replay_comparison(rows, th):
    """Recorded against simulated, per zone and overall, both clocks."""
    by = {}
    for r in rows:
        c = r["case"]
        if r["served"] and c.get("actual_arrived_at") and c.get("actual_assigned_at"):
            arr = parse_ts(c["actual_arrived_at"]).timestamp()
            asg = parse_ts(c["actual_assigned_at"]).timestamp()
            v = ((arr - asg, r["asg_arr"]), (arr - r["reg"].timestamp(), r["reg_arr"]))
            by.setdefault(r["zone"], []).append(v)
            by.setdefault(None, []).append(v)
    out = {}
    for z, v in by.items():
        a, g = _clock([x[0] for x in v], th), _clock([x[1] for x in v], th)
        out[z] = {"cases": len(v), "from_assignment": a, "from_registration": g,
                  "met": _met(a) and _met(g)}
    return out


def _deviation(report):
    msgs = []
    for z, d in sorted((k, v) for k, v in report.items() if k is not None):
        a, g = d["from_assignment"], d["from_registration"]
        msgs.append(
            f"replay deviation zone {z}: median {a['median_dev_pct']:+.1f}% "
            f"share-within {a['share_pp']:+.1f} pp; from registration "
            f"{g['median_dev_pct']:+.1f}% {g['share_pp']:+.1f} pp ({d['cases']} cases; "
            f"replay tolerance 10% / 5 pp: {'met' if d['met'] else 'NOT met'})")
    return msgs


def simulate(request: dict, params=None):
    sim = Sim(request, params)
    sim.run()
    th = request["threshold_seconds"]
    rows = _rows(sim)
    zones = sorted({r["zone"] for r in rows})
    out = {
        "overall": _level(rows, _utilisation(sim, None), th),
        "zones": [{"zone_id": z, "service_level": _level(
            [r for r in rows if r["zone"] == z], _utilisation(sim, z), th)}
            for z in zones],
    }
    groups = {}
    for r in rows:
        idx, start = _interval(r["reg"])
        groups.setdefault((r["zone"], start.timestamp()), (idx, start, []))[2].append(r)
    out["intervals"] = [
        {"zone_id": z, "interval_start": g[1].isoformat(), "interval_index": g[0],
         "service_level": _level(g[2], None, th)}
        for (z, _), g in sorted(groups.items())]
    unserved = [r for r in rows if r["field"] and not r["served"]]
    out["unserved_cases"] = len(unserved)
    if request.get("include_case_outcomes"):
        out["case_outcomes"] = [_outcome(r, th) for r in rows if r["field"]]
    warn = list(sim.warnings)
    if sim.policy == "scorer":
        warn.append(f"scorer: {sim.decisions} assignment engine decisions, "
                    f"{sim.fallbacks} fell back to nearest")
    warn.append(f"{sim.queued} field cases waited in the queue; "
                f"{len(unserved)} unserved (no agent on duty)")
    warn += _deviation(replay_comparison(rows, th))
    return out, warn


def replay_report(request: dict, params=None):
    """Recorded against simulated (needs actual_arrived_at)."""
    sim = Sim(request, params)
    sim.run()
    return replay_comparison(_rows(sim), request["threshold_seconds"])


def _iso(ts, tz):
    return datetime.fromtimestamp(ts, tz).isoformat()


def _outcome(r, th):
    o = {"case_id": r["case"]["case_id"], "served": r["served"]}
    if not r["served"]:
        return o
    tz = r["reg"].tzinfo
    o.update(
        agent_id=r["agent"], assigned_at=_iso(r["asg"], tz),
        arrived_at=_iso(r["arr"], tz),
        registered_to_arrived_seconds=round(r["reg_arr"]),
        assigned_to_arrived_seconds=round(r["asg_arr"]),
        within_from_registration=r["reg_arr"] <= th,
        within_from_assignment=r["asg_arr"] <= th)
    return o


def handle_with_warnings(request: dict, params=None):
    out, warn = simulate(request, params)
    srcs = list(request.get("input_data_sources") or [request["data_source"]])
    illustrative = not (request["data_source"] in REAL and all(s in REAL for s in srcs))
    policy = request.get("assignment_policy", "nearest")
    env = envelope(
        request, "simulator",
        roster_ref=request["roster"]["roster_ref"],
        assignment_policy=policy,
        primary_clock_start=request["clock_start_primary"],
        threshold_seconds=request["threshold_seconds"], **out)
    env["engine"]["version"] = SIMULATOR_VERSION
    env["model_version"] = f"des-{policy}-0.3"
    env["illustrative"] = illustrative
    return env, warn


def _coded(msg):
    code = "REPLAY_DEVIATION" if msg.startswith("replay deviation") else "SIM_NOTE"
    return {"code": code, "message": msg[:500]}


def handle(request: dict) -> dict:
    out, warn = handle_with_warnings(request)
    out["warnings"] = [_coded(w) for w in warn]
    return out
