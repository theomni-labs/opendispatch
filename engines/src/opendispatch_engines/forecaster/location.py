# SPDX-License-Identifier: AGPL-3.0-only
"""Location distributions: probabilities over micro-cells.

Counts only in, probabilities out; hierarchical shrinkage
(group -> hour -> sub-zone all hours -> uniform). See README.
"""
import gc
from operator import itemgetter

VERSION = "0.1.0"
FEATURE = "location_distribution"
DAY_GROUPS = ("weekday", "thursday", "friday", "saturday")
MAX_CELLS = 400
MIN_CELL_CASES = 2
JEFFREYS = 0.5
HOUR_PER_CELL = 2.0  # pseudo-cases per cell, hour prior
GROUP_PER_CELL = 1.0  # pseudo-cases per cell, group prior
UNITS = 1_000_000  # probabilities in millionths

_DG = {g: i for i, g in enumerate(DAY_GROUPS)}
_HOURS = frozenset(range(24))
_FIELDS = itemgetter("sub_zone_id", "hour", "day_group", "cell_id", "cases")


def _collect(request):
    records = (request.get("history") or {}).get("location_records")
    if records is None:
        return None, []
    order = [s["sub_zone_id"] for z in request.get("zones", []) for s in z.get("sub_zones", [])]
    counts = {s: {} for s in order}
    get = counts.get
    for sub, h, g, c, n in map(_FIELDS, records):
        per = get(sub)
        if per is not None:
            key = (h, g, c)
            per[key] = per.get(key, 0) + n
    return counts, order


def _finish(cells, probs):
    # cap, renormalise, round; sum exactly 1
    if len(cells) > MAX_CELLS:
        idx = sorted(range(len(cells)), key=lambda i: (-probs[i], cells[i]))[:MAX_CELLS]
        idx.sort()
        cells = [cells[i] for i in idx]
        probs = [probs[i] for i in idx]
    scale = UNITS / sum(probs)
    units = [int(p * scale + 0.5) for p in probs]
    top = max(range(len(units)), key=units.__getitem__)
    units[top] += UNITS - sum(units)
    return [{"cell_id": c, "probability": u / UNITS} for c, u in zip(cells, units)]


def _groups(per):
    grp, cell_n = {}, {}
    for (h, g, c), n in per.items():
        gi = _DG.get(g)
        if gi is None or h not in _HOURS or type(n) is not int or n <= 0:
            continue
        grp.setdefault(h * 4 + gi, {})[c] = n
        cell_n[c] = cell_n.get(c, 0) + n
    return grp, cell_n


def _sub_zone(sub, per):
    grp, cell_n = _groups(per)
    if not cell_n:
        return []
    keep = sorted(c for c, n in cell_n.items() if n >= MIN_CELL_CASES) or sorted(cell_n)
    pos = {c: i for i, c in enumerate(keep)}
    k = len(keep)
    tot = sum(cell_n[c] for c in keep)
    p_s = [(cell_n[c] + JEFFREYS) / (tot + JEFFREYS * k) for c in keep]
    a_hour, a_group = HOUR_PER_CELL * k, GROUP_PER_CELL * k
    rows = [{pos[c]: n for c, n in grp.get(gi, {}).items() if c in pos} for gi in range(96)]
    out = []
    for h in range(24):
        hour = rows[h * 4:h * 4 + 4]
        n_h = {}
        for row in hour:
            for i, n in row.items():
                n_h[i] = n_h.get(i, 0) + n
        dh = sum(n_h.values()) + a_hour
        w = a_hour / dh
        p_h = [p * w for p in p_s]
        for i, n in n_h.items():
            p_h[i] += n / dh
        for g, row in enumerate(hour):
            dg = sum(row.values()) + a_group
            w = a_group / dg
            p_g = [x * w for x in p_h]
            for i, n in row.items():
                p_g[i] += n / dg
            out.append({"sub_zone_id": sub, "hour": h, "day_group": DAY_GROUPS[g], "cells": _finish(keep, p_g)})
    return out


def distributions(request):
    counts, order = _collect(request)
    if counts is None:
        return None
    out = []
    was_on = gc.isenabled()
    gc.disable()  # millions of small acyclic dicts
    try:
        for sub in order:
            out.extend(_sub_zone(sub, counts[sub]))
    finally:
        if was_on:
            gc.enable()
    return out
