# SPDX-License-Identifier: AGPL-3.0-only
"""ets-1: damped Holt-Winters on zone-day totals, numpy only."""
import itertools

import numpy as np

from . import tabular as T

ALPHA = (0.05, 0.1, 0.2, 0.35)
BETA = (0.0, 0.02, 0.08)
GAMMA = (0.02, 0.05, 0.15)
PHI = (0.8, 0.9, 0.98)
GRID = np.array(list(itertools.product(ALPHA, BETA, GAMMA, PHI)))
BASE = np.array([[0.1, 0.02, 0.05, 0.9]])
MAX_DAYS = 1100  # days of history fitted
SCORE_DAYS = 365  # days scored for the grid
RIDGE = 5.0  # pull of each calendar effect to 1
CV_DAYS = 120
CV_WIDEN = 1.3  # one-step to multi-step errors
FEATURES = ["holt_winters_damped", "weekly_season", "calendar_multipliers", "intra_day_shape"]


def holt_winters(y, wd, params, skip=None):
    """One-step fits (Z, G, n) and end states."""
    Z, n = y.shape
    G = len(params)
    a, b_, g, phi = (params[:, k][None, :] for k in range(4))
    init = np.nanmean(y[:, :28], axis=1)
    init = np.where(np.isnan(init) | (init <= 0), 1.0, init)
    lev = np.repeat(init[:, None], G, axis=1)
    tr = np.zeros((Z, G))
    sea = np.ones((Z, G, 7))
    for k in range(7):
        m = np.nanmean(np.where(wd[:28] == k, y[:, :28], np.nan), axis=1)
        sea[:, :, k] = np.where(np.isnan(m), 1.0, np.maximum(m, 0.1) / init)[:, None]
    fit = np.empty((Z, G, n))
    for t in range(n):
        k = wd[t]
        s = sea[:, :, k]
        base = lev + phi * tr
        fit[:, :, t] = base * s
        yt = y[:, t]
        ok = ~np.isnan(yt) if skip is None else (~np.isnan(yt) & ~skip[:, t])
        if not ok.any():
            lev, tr = base, phi * tr
            continue
        yv = np.where(ok, yt, 0.0)[:, None]
        nl = a * yv / np.maximum(s, 1e-3) + (1 - a) * base
        nl = np.maximum(nl, 1e-3)
        nt = b_ * (nl - lev) + (1 - b_) * phi * tr
        ns = g * yv / nl + (1 - g) * s
        okg = ok[:, None]
        lev = np.where(okg, nl, base)
        tr = np.where(okg, nt, phi * tr)
        sea[:, :, k] = np.where(okg, ns, s)
    return fit, lev, tr, sea


def _forecast(lev, tr, sea, phi, wd_h):
    H = len(wd_h)
    out = np.empty(lev.shape + (H,))
    damp = 0.0
    for h in range(H):
        damp += phi ** (h + 1)
        out[..., h] = (lev + damp * tr) * sea[..., wd_h[h]]
    return np.maximum(out, 0.0)


def _effects(data, y, fit, used):
    """Log calendar effects (k,), city level."""
    idx = [T.FLAGS.index(f) for f in used]
    X = np.nan_to_num(data.flags[:, :data.Dh][:, -y.shape[1]:, idx], nan=0.0)
    w = np.nansum(y, axis=0)
    p = np.nansum(np.where(np.isnan(y), np.nan, fit), axis=0)
    ok = ~np.isnan(y).all(axis=0) & (p > 0)
    r = np.log((w[ok] + 1.0) / (p[ok] + 1.0))
    Xc = (X[:, ok] * np.nan_to_num(y[:, ok], nan=0.0)[:, :, None]).sum(axis=0)
    Xc = Xc / np.maximum(w[ok][:, None], 1e-9)
    A = Xc.T @ Xc + RIDGE * np.eye(len(idx))
    return np.linalg.solve(A, Xc.T @ r), idx


def run(request):
    data = T.Data(request)
    warnings = []
    used = data.used_flags()
    feats = FEATURES + used
    if not data.known[:data.Dh].any():
        return T.empty(data, warnings, feats)
    zd = data.zone_daily()[:, :data.Dh]
    lo = max(0, int(np.argmax(data.known[:data.Dh])), data.Dh - MAX_DAYS)
    y = zd[:, lo:]
    wd = data.wd[lo:data.Dh]
    wd_h = data.wd[data.Dh:]
    flagged = np.nan_to_num(data.flags[:, lo:data.Dh, [T.FLAGS.index(f) for f in used]], nan=0.0).sum(axis=2) > 0
    beta = np.zeros(0)
    idx = []
    if used:
        fit0, *_ = holt_winters(y, wd, BASE, skip=flagged)
        beta, idx = _effects(data, y, fit0[:, 0], used)
    X = np.nan_to_num(data.flags[:, lo:, idx], nan=0.0) if idx else np.zeros((len(data.zones), data.D - lo, 0))
    mult = np.exp(np.clip(X @ beta, -1.5, 1.5)) if idx else np.ones(X.shape[:2])
    ya = y / mult[:, :y.shape[1]]
    fit, lev, tr, sea = holt_winters(ya, wd, GRID)
    sc = min(SCORE_DAYS, ya.shape[1] - 28)
    err = np.nanmean((fit[:, :, -sc:] - ya[:, None, -sc:]) ** 2, axis=2)
    err = np.where(np.isnan(err), np.inf, err)
    best = np.argmin(err, axis=1)
    Z = len(data.zones)
    zi = np.arange(Z)
    fc = np.stack([_forecast(lev[z, best[z]], tr[z, best[z]], sea[z, best[z]], GRID[best[z], 3], wd_h)
                   for z in range(Z)])
    fc = fc * mult[:, y.shape[1]:]
    cv = T.cv_from(ya[:, -CV_DAYS:], fit[zi, best][:, -CV_DAYS:]) * CV_WIDEN
    E = data.spread_daily(fc)
    return {"values": data.emit(E, cv), "warnings": warnings, "info": data.info(feats)}
