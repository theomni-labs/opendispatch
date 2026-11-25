# SPDX-License-Identifier: AGPL-3.0-only
"""lightgbm-1: gradient boosting on sub-zone x 15-minute cells.

Needs numpy and lightgbm; imported only through the registry.
"""
import math
import time
import warnings as _w

import lightgbm as lgb
import numpy as np

from . import tabular as T

SEED = 7
THREADS = 4
ROUNDS = 300
BUDGET_S = 40.0  # training stops here; then not reproducible
MIN_DAYS = 35  # detail days needed to train
CV_DAYS = 28
CV_WIDEN = 1.4  # in-sample errors are optimistic
PARAMS = {
    "objective": "poisson", "learning_rate": 0.08, "num_leaves": 63, "min_data_in_leaf": 200,
    "feature_fraction": 1.0, "bagging_fraction": 1.0, "lambda_l2": 1.0, "max_bin": 255,
    "deterministic": True, "force_row_wise": True, "num_threads": THREADS, "seed": SEED, "verbose": -1,
}
TIME_FEATS = ["slot", "hour", "daytype", "weekday", "doy_sin", "doy_cos", "lead", "sub", "zone"]
LAG_FEATS = ["lag_7", "lag_14", "lag_28", "same_weekday_mean_4", "slot_mean_28", "sub_day_mean_7",
             "sub_day_mean_28", "zone_day_mean_28", "year_ago_ratio", "long_calendar_mult"]
WX_RAW = ["max_temp_c", "rain_mm"]
FEATURES = TIME_FEATS + LAG_FEATS + list(T.FLAGS) + WX_RAW


class Ctx:
    """Arrays the features read; nothing else."""

    def __init__(self, data):
        self.data = data
        self.S, self.H = len(data.subs), data.H
        nd = data.detail.shape[1]
        self.nd = nd
        Y = np.full((self.S, nd + self.H, 96), np.nan)
        Y[:, :nd] = np.where(data.detail_known[None, :, None], data.detail, np.nan)
        self.Y = Y
        self.daily = data.daily.copy()
        self.daily[:, data.Dh:] = np.nan
        self.zd = data.zone_daily()
        self.zd[:, data.Dh:] = np.nan
        self.mult = _long_mult(data)


def _nanmean(a, axis):
    with _w.catch_warnings():
        _w.simplefilter("ignore", RuntimeWarning)
        return np.nanmean(a, axis=axis)


def _long_mult(data):
    """(Z, D) calendar multiplier from older days."""
    used = data.used_flags(T.EVENT_FLAGS + ("payday",))
    Z = len(data.zones)
    out = np.ones((Z, data.D))
    if not used:
        return out
    zd = data.zone_daily()
    hi = data.d0 if data.d0 >= 365 else data.Dh
    city = np.nansum(zd[:, :hi], axis=0)
    known = ~np.isnan(zd[:, :hi]).all(axis=0)
    idx = [T.FLAGS.index(f) for f in used]
    F = np.nan_to_num(data.flags[0, :, idx].T, nan=0.0)
    plain = known & (F[:hi].sum(axis=1) == 0)
    eff = []
    for j in range(len(idx)):
        days = np.where(known & (F[:hi, j] > 0))[0]
        r = []
        for d in days:
            lo, up = max(0, d - 14), min(hi, d + 15)
            base = city[lo:up][plain[lo:up] & (data.wd[lo:up] == data.wd[d])]
            if len(base) >= 2 and np.median(base) > 0:
                r.append(math.log((city[d] + 1) / (np.median(base) + 1)))
        n = len(r)
        eff.append(sum(r) / (n + 3.0) if n else 0.0)
    eff = np.array(eff)
    for z in range(Z):
        Fz = np.nan_to_num(data.flags[z][:, idx], nan=0.0)
        out[z] = np.exp(np.clip(Fz @ eff, -1.5, 1.5))
    return out


def block(ctx, k, L):
    """(S*96, F) features of detail day k at lead L."""
    d = ctx.data
    S, Y = ctx.S, ctx.Y
    o = k - L
    nan = np.full((S, 96), np.nan)

    def at(kk):
        return Y[:, kk, :] if 0 <= kk <= o else nan

    sw0 = k - 7 * math.ceil(L / 7)
    sw = _nanmean(np.stack([at(sw0 - 7 * j) for j in range(4)]), axis=0)
    slot28 = _nanmean(Y[:, max(0, o - 27):o + 1, :], axis=1) if o >= 0 else nan
    da, oa = d.d0 + k, d.d0 + o
    r7 = _nanmean(ctx.daily[:, max(0, oa - 6):oa + 1], axis=1)
    r28 = _nanmean(ctx.daily[:, max(0, oa - 27):oa + 1], axis=1)
    z28 = _nanmean(ctx.zd[:, max(0, oa - 27):oa + 1], axis=1)[d.sub_zone]
    if oa - 364 - 27 >= 0:
        num = _nanmean(ctx.zd[:, da - 367:da - 360], axis=1)
        den = _nanmean(ctx.zd[:, oa - 391:oa - 363], axis=1)
        yoy = (num / np.where(den > 0, den, np.nan))[d.sub_zone]
    else:
        yoy = np.full(S, np.nan)
    zi = d.sub_zone
    doy = 2 * math.pi * d.doy[da] / 365.25
    cols = [
        np.tile(np.arange(96.0), (S, 1)), np.tile(np.arange(96.0) // 4, (S, 1)),
        np.full((S, 96), float(d.dt[da])), np.full((S, 96), float(d.wd[da])),
        np.full((S, 96), math.sin(doy)), np.full((S, 96), math.cos(doy)), np.full((S, 96), float(L)),
        np.repeat(np.arange(S, dtype=float)[:, None], 96, axis=1), np.repeat(zi.astype(float)[:, None], 96, axis=1),
        at(k - 7) if L <= 7 else nan, at(k - 14) if L <= 14 else nan, at(k - 28), sw, slot28,
        np.repeat(r7[:, None], 96, axis=1), np.repeat(r28[:, None], 96, axis=1),
        np.repeat(z28[:, None], 96, axis=1), np.repeat(yoy[:, None], 96, axis=1),
        np.repeat(ctx.mult[zi, da][:, None], 96, axis=1),
    ]
    fl = d.flags[zi, da]
    cols += [np.repeat(fl[:, j][:, None], 96, axis=1) for j in range(fl.shape[1])]
    cols += [np.repeat(d.temp[zi, da][:, None], 96, axis=1), np.repeat(d.rain[zi, da][:, None], 96, axis=1)]
    return np.stack(cols, axis=2).reshape(S * 96, len(FEATURES))


def _budget(t0, limit):
    def cb(env):
        if time.monotonic() - t0 > limit:
            raise lgb.callback.EarlyStopException(env.iteration, env.evaluation_result_list or [])
    cb.order = 30
    return cb


def run(request, budget=BUDGET_S):
    t0 = time.monotonic()
    data = T.Data(request)
    warnings = []
    ctx = Ctx(data)
    if not data.detail_known.any():
        return T.empty(data, warnings, FEATURES)
    rng = np.random.default_rng(SEED)
    nd, H = ctx.nd, data.H
    X, y, days = [], [], []
    for k in range(nd):
        L = int(rng.integers(1, H + 1))
        if k - L - 27 < 0 or not data.detail_known[k]:
            continue
        X.append(block(ctx, k, L))
        y.append(ctx.Y[:, k, :].reshape(-1))
        days.append(k)
    if len(days) < MIN_DAYS - 28:
        warnings.append({"code": "SHORT_HISTORY", "message": f"Under {MIN_DAYS} days of 15-minute history; lightgbm-1 trains on few days."})
    if not days:
        E = np.zeros((ctx.S, H, 96))
        return {"values": data.emit(E, 0.5), "warnings": warnings, "info": data.info(FEATURES)}
    X, y = np.concatenate(X), np.concatenate(y)
    ds = lgb.Dataset(X, y, feature_name=FEATURES, categorical_feature=["sub", "zone"], free_raw_data=True)
    left = max(1.0, budget - (time.monotonic() - t0))
    booster = lgb.train(PARAMS, ds, num_boost_round=ROUNDS, callbacks=[_budget(t0, budget)])
    if booster.current_iteration() < ROUNDS:
        warnings.append({"code": "TIME_LIMIT", "message": f"lightgbm-1 stopped at {booster.current_iteration()} of {ROUNDS} rounds ({left:.0f} s budget); the result depends on machine speed."})
    E = np.stack([booster.predict(block(ctx, nd + h, h + 1)).reshape(ctx.S, 96) for h in range(H)], axis=1)
    last = [i for i, k in enumerate(days) if k >= nd - CV_DAYS]
    n_last = sum(1 for k in days if k >= nd - CV_DAYS)
    fit = booster.predict(X[-n_last * ctx.S * 96:]).reshape(n_last, ctx.S, 96).sum(axis=2) if last else None
    if fit is not None:
        act = y[-n_last * ctx.S * 96:].reshape(n_last, ctx.S, 96).sum(axis=2)
        Z = len(data.zones)
        za, zf = np.zeros((Z, n_last)), np.zeros((Z, n_last))
        np.add.at(za, data.sub_zone, act.T)
        np.add.at(zf, data.sub_zone, fit.T)
        cv = T.cv_from(za, zf) * CV_WIDEN
    else:
        cv = 0.3
    return {"values": data.emit(E, cv), "warnings": warnings, "info": data.info(FEATURES)}
