# SPDX-License-Identifier: AGPL-3.0-only
"""Decision time at the synthetic national peak.

Run: python -m opendispatch_engines.assignment.peak [--url URL]
All positions are random synthetic points.
"""
import argparse
import json
import random
import threading
import time
import urllib.request
import uuid
from datetime import datetime, timedelta

from . import DemandCell, rank

PEAK_RATE = 3.0  # new cases a second
ZONES = 36  # national dispatch zones (plan)
FIELD_PER_ZONE = 32  # 42 per zone x 0.75 field (calibration)
CELLS_PER_ZONE = 100  # micro-cells of look-ahead demand
NOW = datetime.fromisoformat("2026-09-14T16:00:00+03:00")


def _iso(t):
    return t.isoformat()


def national(seed=1):
    """Synthetic zones, agents and demand cells."""
    rng = random.Random(seed)
    zones = [(str(uuid.UUID(int=0xA000 + z)), 21 + rng.uniform(0, 6), 39 + rng.uniform(0, 11))
             for z in range(ZONES)]
    cands, cells = [], {}
    for zid, lat, lon in zones:
        cells[zid] = [DemandCell(lat + rng.uniform(-0.06, 0.06), lon + rng.uniform(-0.06, 0.06),
                                 rng.uniform(0.0, 0.3)) for _ in range(CELLS_PER_ZONE)]
        for _ in range(FIELD_PER_ZONE):
            st = rng.choices(["available", "en_route", "on_scene", "on_break", "offline"],
                             [60, 12, 13, 10, 5])[0]
            c = {"agent_id": str(uuid.UUID(int=0xB0000 + len(cands))), "status": st,
                 "latitude": lat + rng.uniform(-0.06, 0.06),
                 "longitude": lon + rng.uniform(-0.06, 0.06),
                 "position_at": _iso(NOW - timedelta(seconds=rng.randint(0, 200))),
                 "roster_zone_id": zid,
                 "shift_end_at": _iso(NOW + timedelta(minutes=rng.randint(20, 480))),
                 "next_break_due_at": _iso(NOW + timedelta(minutes=rng.randint(5, 240))),
                 "skills": ["general"], "has_vehicle": rng.random() > 0.02,
                 "cases_today": rng.randint(0, 9)}
            if st in ("en_route", "on_scene"):
                c["busy_until"] = _iso(NOW + timedelta(seconds=rng.randint(60, 1800)))
            if st == "on_break":
                c["on_break_until"] = _iso(NOW + timedelta(minutes=rng.randint(1, 30)))
            cands.append(c)
    return zones, cands, cells


def requests(n, seed=1):
    """n case requests, each with every field agent."""
    zones, cands, cells = national(seed)
    rng = random.Random(seed + 1)
    out = []
    for _ in range(n):
        zid, lat, lon = rng.choice(zones)
        out.append(({
            "schema_version": "1.0", "request_id": str(uuid.UUID(int=rng.getrandbits(128))),
            "requested_at": _iso(NOW), "data_source": "SYNTHETIC", "now": _iso(NOW),
            "stage": "automatic", "decision_deadline_ms": 2000, "top_n": 5,
            "case": {"case_id": str(uuid.UUID(int=rng.getrandbits(128))),
                     "registered_at": _iso(NOW), "zone_id": zid,
                     "latitude": lat + rng.uniform(-0.05, 0.05),
                     "longitude": lon + rng.uniform(-0.05, 0.05),
                     "handling": "field", "required_skills": [],
                     "existing_assignment_id": None},
            "candidates": cands,
            "prayer_window": {"name": "asr", "starts_at": _iso(NOW + timedelta(minutes=5)),
                              "ends_at": _iso(NOW + timedelta(minutes=35))},
            "travel_model": {"average_speed_kmh": 40.0, "detour_factor": 1.3},
        }, cells[zid]))
    return out


def _pct(v, q):
    v = sorted(v)
    return v[min(len(v) - 1, int(q * len(v)))]


def in_process(n=600, rate=PEAK_RATE, seed=1):
    """Open-loop at rate on one thread; ms per decision."""
    reqs = requests(n, seed)
    lat, exceeded = [], 0
    t0 = time.perf_counter()
    for i, (r, cells) in enumerate(reqs):
        wait = t0 + i / rate - time.perf_counter() if rate else 0
        if wait > 0:
            time.sleep(wait)
        a = time.perf_counter()
        out = rank(r, demand=cells)
        lat.append((time.perf_counter() - a) * 1000)
        exceeded += bool(out["deadline_exceeded"])
    return lat, exceeded


def reposition_round(seed=1):
    """ms to replan every zone once (its idle agents)."""
    from .reposition import plan
    zones, cands, cells = national(seed)
    t0 = time.perf_counter()
    moves = 0
    for zid, _, _ in zones:
        idle = [(c["agent_id"], (c["latitude"], c["longitude"]),
                 (c["latitude"], c["longitude"])) for c in cands
                if c["roster_zone_id"] == zid and c["status"] == "available"]
        moves += len(plan(idle, [(d.latitude, d.longitude, d.expected_cases)
                                 for d in cells[zid]]))
    return (time.perf_counter() - t0) * 1000, moves


def over_http(url, n=600, rate=PEAK_RATE, seed=1):
    """Open-loop POSTs at rate; round-trip ms."""
    reqs = [json.dumps(r).encode() for r, _ in requests(n, seed)]
    lat = [None] * n
    t0 = time.perf_counter()

    def one(i):
        a = time.perf_counter()
        q = urllib.request.Request(url, data=reqs[i], method="POST",
                                   headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(q, timeout=10) as resp:
            resp.read()
        lat[i] = (time.perf_counter() - a) * 1000

    threads = []
    for i in range(n):
        wait = t0 + i / rate - time.perf_counter()
        if wait > 0:
            time.sleep(wait)
        th = threading.Thread(target=one, args=(i,))
        th.start()
        threads.append(th)
    for th in threads:
        th.join()
    return [x for x in lat if x is not None]


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=600)
    ap.add_argument("--rate", type=float, default=PEAK_RATE)
    ap.add_argument("--url", help="engine /v1/assignment to load")
    a = ap.parse_args(argv)
    lat, exceeded = in_process(a.n, a.rate)
    rep = {"candidates": ZONES * FIELD_PER_ZONE, "rate_per_s": a.rate, "n": a.n,
           "in_process_ms": {"p50": round(_pct(lat, 0.5), 1), "p99": round(_pct(lat, 0.99), 1),
                             "max": round(max(lat), 1)}, "deadline_exceeded": exceeded}
    rms, moves = reposition_round()
    rep["reposition_all_zones_ms"] = round(rms, 1)
    rep["reposition_moves"] = moves
    if a.url:
        h = over_http(a.url, a.n, a.rate)
        rep["http_ms"] = {"p50": round(_pct(h, 0.5), 1), "p99": round(_pct(h, 0.99), 1),
                          "max": round(max(h), 1), "answered": len(h)}
    print(json.dumps(rep, indent=1))
    return rep


if __name__ == "__main__":
    main()
