# SPDX-License-Identifier: AGPL-3.0-only
"""Fit the simulator parameters from recorded days.

Input: simulator requests whose field cases carry actual_assigned_at,
actual_agent_id, actual_arrived_at and on_scene_seconds. Output: a
SimParams relative to the requests' travel model.
"""
import gzip
import json
import os
import pprint
import sys
from dataclasses import fields

import numpy as np

from .core import Sim, parse_ts
from .params import HOURS, SimParams

ACK_GRID = np.arange(0.0, 601.0, 5.0)
HOUR_BLOCK = 2
MIN_BLOCK_CASES = 200
FACTOR_CLIP = (0.4, 2.5)
ROUNDS = 3
BANDS = 10
QUANTILES = 21
RESIDUAL_FLOOR = 0.02


def _median_p90(v):
    v = np.asarray(v, dtype=float)
    return float(np.quantile(v, 0.5)), float(np.quantile(v, 0.9))


def _recorded(requests):
    asg_arr, delay, scene = [], [], []
    for req in requests:
        for c in req["cases"]:
            if c["handling"] != "field" or not c.get("actual_arrived_at"):
                continue
            reg = parse_ts(c["registered_at"]).timestamp()
            asg = parse_ts(c["actual_assigned_at"]).timestamp()
            arr = parse_ts(c["actual_arrived_at"]).timestamp()
            asg_arr.append((c["case_id"], arr - asg))
            delay.append(max(0.0, asg - reg))
            if c.get("on_scene_seconds") is not None:
                scene.append(float(c["on_scene_seconds"]))
    return dict(asg_arr), delay, scene


def _base_travel(requests, params):
    """Model drive seconds at factor 1, per replayed case."""
    plain = params.with_(travel_noise_sigma=0.0, travel_bands_km=(),
                         travel_residual_quantiles=())
    rows = {}
    for req in requests:
        sim = Sim(dict(req, assignment_policy="replay_actual"), plain)
        sim.run()
        zone = {c["case_id"]: c["zone_id"] for c in req["cases"]}
        for cid, o in sim.res.items():
            if o is None:
                continue
            h = int((o["assigned"] - _midnight(sim, o["assigned"])) // 3600)
            # undo the factors: base at factor 1
            scale = plain.speed_factor_by_hour[h] * dict(plain.speed_factor_by_zone).get(
                zone[cid], 1.0)
            rows[cid] = (o["base_travel"] * scale, h, o["km"], zone[cid])
    return rows


def _midnight(sim, t):
    from datetime import datetime
    d = datetime.fromtimestamp(t, sim.tz)
    return d.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()


def _factor(ack, x, y, other, m):
    """Speed factor that centres the drive residual on 1."""
    if m.sum() < MIN_BLOCK_CASES:
        return None
    r = np.median(np.maximum(y[m] - ack, 1.0) * other[m] / x[m])
    return float(np.clip(1.0 / r, *FACTOR_CLIP))


def _factors(ack, x, y, hr, zn, zones):
    """Hour-block and zone factors, alternating."""
    fz = np.ones_like(x)
    zf = {}
    for _ in range(ROUNDS):
        overall = _factor(ack, x, y, fz, np.ones_like(x, dtype=bool)) or 1.0
        hf = []
        for b in range(0, HOURS, HOUR_BLOCK):
            f = _factor(ack, x, y, fz, (hr >= b) & (hr < b + HOUR_BLOCK))
            hf += [overall if f is None else f] * HOUR_BLOCK
        fh = np.array([hf[h] for h in hr])
        zf = {z: _factor(ack, x, y, fh, zn == z) or 1.0 for z in zones}
        fz = np.array([zf[z] for z in zn])
    return hf, zf, fh * fz


def _sse(ack, x, y, f):
    r = np.log(y / (ack + x / f))
    return float(r @ r)


def _residual_table(ack, x, y, km, f):
    r = np.maximum((y - ack) * f / x, RESIDUAL_FLOOR)
    edges = np.quantile(km, np.linspace(0, 1, BANDS + 1))[1:-1]
    band = np.searchsorted(edges, km, side="left")
    u = np.linspace(0, 1, QUANTILES)
    table = tuple(tuple(round(float(v), 3) for v in np.quantile(r[band == b], u))
                  for b in range(BANDS))
    return tuple(round(float(e), 3) for e in edges), table, r


def fit(requests, base=SimParams(), iterations=3):
    """Parameters fitted on recorded days.

    Trip = overhead + drive x residual. Speed factors by
    hour and zone are relative to the requests' travel
    model, shared by every engine.
    """
    rec, delay, scene = _recorded(requests)
    dmed, dp90 = _median_p90(delay)
    smed, sp90 = _median_p90(scene)
    p = base.with_(dispatch_delay_median_seconds=round(dmed),
                   dispatch_delay_p90_seconds=round(dp90),
                   on_scene_median_seconds=round(smed),
                   on_scene_p90_seconds=round(sp90),
                   speed_factor_by_hour=(1.0,) * HOURS, speed_factor_by_zone=())
    for _ in range(iterations):
        rows = _base_travel(requests, p)
        ids = sorted(k for k in rec if k in rows and rec[k] > 0)
        x = np.maximum(np.array([rows[k][0] for k in ids]), 1.0)
        hr = np.array([rows[k][1] for k in ids])
        km = np.array([rows[k][2] for k in ids])
        zn = np.array([rows[k][3] for k in ids])
        y = np.array([rec[k] for k in ids])
        zones = sorted(set(zn.tolist()))
        best = None
        for ack in ACK_GRID:
            hf, zf, f = _factors(ack, x, y, hr, zn, zones)
            sse = _sse(ack, x, y, f)
            if best is None or sse < best[0]:
                best = (sse, float(ack), hf, zf, f)
        _, ack, hf, zf, f = best
        # zone factors centred on 1, scale in the hours
        mid = float(np.median([zf[z] for z in zn]))
        edges, table, r = _residual_table(ack, x, y, km, f)
        p = p.with_(trip_overhead_seconds=round(ack),
                    travel_noise_sigma=round(float(np.std(np.log(r))), 3),
                    speed_factor_by_hour=tuple(round(v * mid, 3) for v in hf),
                    speed_factor_by_zone=tuple(
                        (z, round(zf[z] / mid, 3)) for z in zones),
                    travel_bands_km=edges, travel_residual_quantiles=table)
    return p


def render(p):
    """Python source for fitted.py."""
    body = pprint.pformat({f.name: getattr(p, f.name) for f in fields(p)},
                          width=79, compact=True, sort_dicts=False)
    return ('"""Generated by calibrate.py from SYNTHETIC days."""\n'
            f"FITTED = {body}\n")


def load_days(directory, first=0, count=None):
    """Gzipped simulator requests, sorted by name."""
    names = sorted(n for n in os.listdir(directory) if n.endswith(".json.gz"))
    names = names[first:] if count is None else names[first:first + count]
    out = []
    for n in names:
        with gzip.open(os.path.join(directory, n), "rt", encoding="utf-8") as f:
            out.append(json.load(f))
    return out


if __name__ == "__main__":
    # usage: calibrate <dir> <training days>
    sys.stdout.write(render(fit(load_days(sys.argv[1], 0, int(sys.argv[2])))))
