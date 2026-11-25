# SPDX-License-Identifier: AGPL-3.0-only
"""Idle repositioning: where free agents should wait.

The harness calls plan(); the service
answers POST /v1/assignment/reposition through handle()
(contracts/engines/reposition.*.schema.json). Advisory: moves idle
agents only; never assigns or reassigns a case.
"""
import math
import time
from dataclasses import dataclass, replace

import numpy as np
from scipy.optimize import linear_sum_assignment

from ..common import envelope

EARTH_KM = 6371.0088


@dataclass(frozen=True)
class Reposition:
    """Named repositioning settings (tuned on training days)."""
    period_seconds: int = 1800  # how often a zone is re-planned
    min_move_km: float = 2.0  # smaller shifts are not worth a drive
    max_move_km: float = 5.0  # longer drives are not sent
    look_ahead_hours: int = 1  # demand window from now


DEFAULT_REPOSITION = Reposition()


def km_matrix(a, b):
    """Great-circle km between two lists of (lat, lon)."""
    a = np.radians(np.asarray(a, float).reshape(-1, 2))
    b = np.radians(np.asarray(b, float).reshape(-1, 2))
    dlat = a[:, None, 0] - b[None, :, 0]
    dlon = a[:, None, 1] - b[None, :, 1]
    h = (np.sin(dlat / 2) ** 2
         + np.cos(a[:, None, 0]) * np.cos(b[None, :, 0]) * np.sin(dlon / 2) ** 2)
    return 2 * EARTH_KM * np.arcsin(np.sqrt(np.minimum(1.0, h)))


def p_median(dist, weight, k):
    """Greedy k sites, then one swap pass per site."""
    n = dist.shape[0]
    k = min(k, n)
    cur = np.full(dist.shape[1], np.inf)
    chosen = []
    for _ in range(k):
        tot = (np.minimum(dist, cur[None, :]) * weight[None, :]).sum(1)
        tot[chosen] = np.inf
        j = int(np.argmin(tot))
        chosen.append(j)
        cur = np.minimum(cur, dist[j])
    for i in range(len(chosen)):
        others = chosen[:i] + chosen[i + 1:]
        base = dist[others].min(0) if others else np.full(dist.shape[1], np.inf)
        tot = (np.minimum(dist, base[None, :]) * weight[None, :]).sum(1)
        tot[others] = np.inf
        chosen[i] = int(np.argmin(tot))
    return chosen


def plan(idle, cells, settings=DEFAULT_REPOSITION):
    """Waiting spots for idle agents of one zone.

    idle: [(agent_id, (lat, lon) now, (lat, lon) heading to)].
    cells: [(lat, lon, expected_cases)]; zero-demand cells are still sites.
    Returns [(agent_id, (lat, lon))] for those who should move.
    """
    if not idle or not cells:
        return []
    w = np.array([max(0.0, c[2]) for c in cells], float)
    if w.sum() <= 0:
        return []
    idle = sorted(idle, key=lambda x: x[0])
    pts = np.array([(c[0], c[1]) for c in cells])
    w = w / w.sum()
    sites = p_median(km_matrix(pts, pts), w, len(idle))
    targets = pts[sites]
    now = np.array([x[1] for x in idle])
    cost = km_matrix(now, targets)
    rows, cols = linear_sum_assignment(cost)
    moves = []
    for i, j in zip(rows, cols):
        sid, _, heading = idle[i]
        tgt = (float(targets[j][0]), float(targets[j][1]))
        if km_matrix([heading], [tgt])[0, 0] < settings.min_move_km:
            continue
        if settings.max_move_km and cost[i, j] > settings.max_move_km:
            continue
        moves.append((sid, tgt))
    return moves


MODEL_VERSION = "scorer-0.3"
MAX_IDLE = 2000
MAX_CELLS = 20000


def _num(value, lo, hi, what):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{what} must be a number")
    if not math.isfinite(value) or not lo <= value <= hi:
        raise ValueError(f"{what} out of range")
    return float(value)


def _settings(raw):
    """Request settings over the named defaults."""
    if raw is None:
        return DEFAULT_REPOSITION
    if not isinstance(raw, dict) or set(raw) - {"min_move_km", "max_move_km", "look_ahead_hours"}:
        raise ValueError("settings")
    out = DEFAULT_REPOSITION
    if "min_move_km" in raw:
        out = replace(out, min_move_km=_num(raw["min_move_km"], 0, 50, "min_move_km"))
    if "max_move_km" in raw:
        km = _num(raw["max_move_km"], 0, 50, "max_move_km")
        if km <= 0:
            raise ValueError("max_move_km must be above 0")
        out = replace(out, max_move_km=km)
    if "look_ahead_hours" in raw:
        h = raw["look_ahead_hours"]
        if type(h) is not int or not 1 <= h <= 6:
            raise ValueError("look_ahead_hours")
        out = replace(out, look_ahead_hours=h)
    return out


def handle(request: dict) -> dict:
    """Waiting spots for one zone (the contract's shape)."""
    started = time.monotonic()
    if request.get("schema_version") != "1.0":
        raise ValueError("schema_version")
    zone = request["zone_id"]
    if not isinstance(zone, str):
        raise ValueError("zone_id")
    settings = _settings(request.get("settings"))
    idle_in = request["idle_agents"]
    cells_in = request["demand_cells"]
    if not isinstance(idle_in, list) or len(idle_in) > MAX_IDLE:
        raise ValueError("idle_agents")
    if not isinstance(cells_in, list) or len(cells_in) > MAX_CELLS:
        raise ValueError("demand_cells")
    idle, seen = [], set()
    for s in idle_in:
        sid = s["agent_id"]
        if not isinstance(sid, str) or sid in seen:
            raise ValueError("agent_id")
        seen.add(sid)
        pos = (_num(s["latitude"], -90, 90, "latitude"),
               _num(s["longitude"], -180, 180, "longitude"))
        idle.append((sid, pos, pos))
    cells = [(_num(c["latitude"], -90, 90, "latitude"),
              _num(c["longitude"], -180, 180, "longitude"),
              _num(c["expected_cases"], 0, float("inf"), "expected_cases"))
             for c in cells_in]
    where = {sid: pos for sid, pos, _ in idle}
    spots = []
    for sid, (lat, lon) in plan(idle, cells, settings):
        km = float(km_matrix([where[sid]], [(lat, lon)])[0, 0])
        spots.append({"agent_id": sid, "latitude": round(lat, 6),
                      "longitude": round(lon, 6), "move_km": round(km, 2),
                      "reason_code": "cover_expected_demand"})
    spots.sort(key=lambda x: x["agent_id"])
    out = envelope(request, "assignment", model_version=MODEL_VERSION,
                   zone_id=zone, waiting_spots=spots)
    out["decision_time_ms"] = int((time.monotonic() - started) * 1000)
    return out
