# SPDX-License-Identifier: AGPL-3.0-only
"""cpsat-1: field roster as a CP-SAT integer model."""
import math

N = 96
REACH_UNITS = 1000


def load():
    """The cp_model module, or None without ortools."""
    try:
        from ortools.sat.python import cp_model
    except ImportError:
        return None
    return cp_model


def _breaks(p):
    return list(p.breaks) if p.needs_break else [None]


def solve_job(cp_model, pool, rz, seconds, seed):
    """Best roster of one pool: ({sid: (p, b, j)}, optimal) or None."""
    groups = {}
    for s in pool.sids:
        ok = pool.allowed.get(s)
        sig = tuple(sorted(pool.skills.get(s, ())))
        if s in pool.locked:
            p = pool.pat[s]
            key, pats = ("L", ok, sig, p.id), [p]
        else:
            pats = pool.elig[s]
            key = ("F", ok, sig) + tuple(p.id for p in pats)
        if pats:
            groups.setdefault(key, (pats, []))[1].append(s)
    reach_on = rz is not None and bool(rz.points)
    m = cp_model.CpModel()
    opts = []
    cov = [[] for _ in range(N)]
    on = [[] for _ in range(N)]
    duty = {}
    brk = [[] for _ in range(N)]
    skc = {k: [[] for _ in range(N)] for k in pool.sreq}
    for gi, (key, (pats, members)) in enumerate(groups.items()):
        size = len(members)
        gv = []
        pts = ([None] if not reach_on
               else list(range(len(rz.points))) if key[1] is None else list(key[1]))
        for p in pats:
            for b in _breaks(p):
                for j in pts:
                    v = m.new_int_var(0, size, "n%d_%d" % (gi, len(opts)))
                    opts.append((gi, p, b, j, v))
                    gv.append(v)
                    for t in p.contrib(b):
                        cov[t].append(v)
                        for k in key[2]:
                            skc[k][t].append(v)
                        if j is not None:
                            duty.setdefault((j, t), []).append(v)
                    for t in p.shift:
                        on[t].append(v)
                    if b is not None:
                        for t in p.break_idx(b):
                            brk[t].append(v)
        if key[0] == "L":
            m.add(sum(gv) == size)
        else:
            m.add(sum(gv) <= size)
    staff = sum(len(g[1]) for g in groups.values())
    unmet, over = [], []
    for t in range(N):
        if pool.cap is not None and on[t]:
            m.add(sum(on[t]) <= pool.cap)
        r = pool.req[t]
        if not cov[t] and not r:
            continue
        c = sum(cov[t]) if cov[t] else 0
        u = m.new_int_var(0, r, "u%d" % t)
        m.add(u >= r - c)
        unmet.append(u)
        o = m.new_int_var(0, staff, "o%d" % t)
        m.add(o >= c - r)
        over.append(o)
    for k, need in sorted(pool.sreq.items()):
        for t in range(N):
            r = need[t]
            if r <= 0:
                continue
            u = m.new_int_var(0, r, "k%s_%d" % (len(unmet), t))
            m.add(u >= r - sum(skc[k][t])) if skc[k][t] else m.add(u == r)
            unmet.append(u)
    reach_short = []
    reach_max = 0
    if reach_on:
        all_pts = list(range(len(rz.points)))
        goal = math.ceil(rz.target * REACH_UNITS - 1e-9)
        for t in range(N):
            if not rz.has_demand(t):
                continue
            terms = []
            for s in rz.subs:
                d = rz.dem[s][t]
                if d <= 0:
                    continue
                cover = [v for j in all_pts if s in rz.sets[j] for v in duty.get((j, t), [])]
                if not cover:
                    continue
                w = round(REACH_UNITS * d / rz.total[t])
                if w <= 0:
                    continue
                x = m.new_bool_var("r%d" % t)
                m.add(x <= sum(cover))
                terms.append(w * x)
            sh = m.new_int_var(0, goal, "s%d" % t)
            m.add(sh >= goal - sum(terms)) if terms else m.add(sh == goal)
            reach_short.append(sh)
            reach_max += goal
    stag = []
    for t in range(N):
        if len(brk[t]) > 0:
            x = m.new_int_var(0, staff, "b%d" % t)
            m.add(x >= sum(brk[t]) - 1)
            stag.append(x)
    w_over = N * staff + 1
    w_reach = w_over * (N * staff + 1)
    w_unmet = w_reach * (reach_max + 1)
    m.minimize(w_unmet * sum(unmet) + w_reach * sum(reach_short)
               + w_over * sum(over) + sum(stag))
    solver = cp_model.CpSolver()
    prm = solver.parameters
    prm.num_workers = 1
    prm.random_seed = seed % (2 ** 31)
    prm.max_time_in_seconds = max(0.05, seconds)
    prm.max_deterministic_time = max(0.05, seconds)
    st = solver.solve(m)
    if st not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None
    queues = {}
    for key, (pats, members) in groups.items():
        queues[len(queues)] = list(members)
    picks = {}
    for gi, p, b, j, v in opts:
        for _ in range(solver.value(v)):
            picks[queues[gi].pop(0)] = (p, b, j)
    return picks, st == cp_model.OPTIMAL
