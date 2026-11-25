# SPDX-License-Identifier: AGPL-3.0-only
"""mlp-1: small temporal MLP on zone-hour series (CPU).

Research image only (torch). Features use only days up to
the origin, at the same leads as the horizon.
"""
import math
import time
import warnings as _w

import numpy as np
import torch
from torch import nn

from . import tabular as T

SEED = 11
THREADS = 4
EPOCHS = 40
BATCH = 2048
LR = 3e-3
BUDGET_S = 150.0  # training stops here; then not reproducible
CV_DAYS = 28
CV_WIDEN = 1.4
FEATURES = ["temporal_mlp", "hour", "daytype", "lead", "lags_7_14_28", "same_weekday_mean_4", "hour_mean_28",
            "zone_day_mean_7_28", "zone_embedding", "calendar_flags", "weather_flags", "intra_day_shape"]


def _nanmean(a, axis):
    with _w.catch_warnings():
        _w.simplefilter("ignore", RuntimeWarning)
        return np.nanmean(a, axis=axis)


class Ctx:
    def __init__(self, data):
        self.data = data
        Z, nd, H = len(data.zones), data.detail.shape[1], data.H
        hz = np.zeros((Z, nd, 24))
        np.add.at(hz, data.sub_zone, data.detail.reshape(len(data.subs), nd, 24, 4).sum(axis=3))
        Y = np.full((Z, nd + H, 24), np.nan)
        Y[:, :nd] = np.where(data.detail_known[None, :, None], hz, np.nan)
        self.Y, self.Z, self.nd = Y, Z, nd
        scale = _nanmean(Y[:, max(0, nd - 28):nd].reshape(Z, -1), axis=1)
        self.scale = np.where(np.isnan(scale) | (scale < 0.1), 0.1, scale)


def block(ctx, k, L):
    """(Z*24, F) features of detail day k at lead L."""
    d, Y, Z = ctx.data, ctx.Y, ctx.Z
    o = k - L
    nan = np.full((Z, 24), np.nan)

    def at(kk):
        return Y[:, kk] if 0 <= kk <= o else nan

    sw0 = k - 7 * math.ceil(L / 7)
    sw = _nanmean(np.stack([at(sw0 - 7 * j) for j in range(4)]), axis=0)
    h28 = _nanmean(Y[:, max(0, o - 27):o + 1], axis=1) if o >= 0 else nan
    dm7 = _nanmean(Y[:, max(0, o - 6):o + 1].sum(axis=2), axis=1) if o >= 0 else np.full(Z, np.nan)
    dm28 = _nanmean(Y[:, max(0, o - 27):o + 1].sum(axis=2), axis=1) if o >= 0 else np.full(Z, np.nan)
    s = ctx.scale[:, None]
    lags = [at(k - 7) if L <= 7 else nan, at(k - 14), at(k - 28), sw, h28]
    lag_f = [np.nan_to_num(x / s, nan=-1.0) for x in lags]
    da = d.d0 + k
    doy = 2 * math.pi * d.doy[da] / 365.25
    hour = np.tile(np.eye(24), (Z, 1, 1))
    dt = np.zeros((Z, 24, 4))
    dt[:, :, d.dt[da]] = 1.0
    fl = np.nan_to_num(d.flags[:, da], nan=0.0)
    cols = [np.stack(lag_f, axis=2), hour, dt,
            np.repeat(np.nan_to_num(np.stack([dm7, dm28], axis=1) / (24 * ctx.scale[:, None]), nan=-1.0)[:, None, :], 24, axis=1),
            np.repeat(fl[:, None, :], 24, axis=1),
            np.broadcast_to(np.array([math.sin(doy), math.cos(doy), L / 14.0]), (Z, 24, 3))]
    return np.concatenate(cols, axis=2).reshape(Z * 24, -1).astype(np.float32)


class Net(nn.Module):
    def __init__(self, n_in, n_zones):
        super().__init__()
        self.emb = nn.Embedding(n_zones, 4)
        self.mlp = nn.Sequential(nn.Linear(n_in + 4, 64), nn.ReLU(), nn.Linear(64, 64), nn.ReLU(), nn.Linear(64, 1))

    def forward(self, x, z):
        return self.mlp(torch.cat([x, self.emb(z)], dim=1)).squeeze(1)


def run(request, budget=BUDGET_S):
    t0 = time.monotonic()
    torch.manual_seed(SEED)
    torch.use_deterministic_algorithms(True)
    torch.set_num_threads(THREADS)
    data = T.Data(request)
    warnings = []
    if not data.detail_known.any():
        return T.empty(data, warnings, FEATURES)
    ctx = Ctx(data)
    Z, nd, H = ctx.Z, ctx.nd, data.H
    rng = np.random.default_rng(SEED)
    X, y, days = [], [], []
    for k in range(nd):
        L = int(rng.integers(1, H + 1))
        if k - L - 27 < 0 or not data.detail_known[k]:
            continue
        X.append(block(ctx, k, L))
        y.append(ctx.Y[:, k].reshape(-1))
        days.append(k)
    if not days:
        return {"values": data.emit(np.zeros((len(data.subs), H, 96)), 0.5), "warnings": warnings, "info": data.info(FEATURES)}
    zid = np.tile(np.repeat(np.arange(Z), 24), len(days))
    Xt = torch.from_numpy(np.concatenate(X))
    yt = torch.from_numpy(np.concatenate(y).astype(np.float32))
    zt = torch.from_numpy(zid)
    off = torch.from_numpy(np.log(ctx.scale[zid]).astype(np.float32))
    net = Net(Xt.shape[1], Z)
    opt = torch.optim.Adam(net.parameters(), lr=LR)
    loss_f = nn.PoissonNLLLoss(log_input=True, full=False)
    gen = torch.Generator().manual_seed(SEED)
    stopped = None
    for ep in range(EPOCHS):
        perm = torch.randperm(len(yt), generator=gen)
        for i in range(0, len(yt), BATCH):
            b = perm[i:i + BATCH]
            opt.zero_grad()
            loss = loss_f(net(Xt[b], zt[b]) + off[b], yt[b])
            loss.backward()
            opt.step()
        if time.monotonic() - t0 > budget:
            stopped = ep + 1
            break
    if stopped is not None:
        warnings.append({"code": "TIME_LIMIT", "message": f"mlp-1 stopped after {stopped} of {EPOCHS} epochs; the result depends on machine speed."})
    net.eval()
    with torch.no_grad():
        zh = np.repeat(np.arange(Z), 24)
        pz, po = torch.from_numpy(zh), torch.from_numpy(np.log(ctx.scale[zh]).astype(np.float32))
        P = np.stack([torch.exp(net(torch.from_numpy(block(ctx, nd + h, h + 1)), pz) + po).numpy().reshape(Z, 24)
                      for h in range(H)], axis=1)
        n_last = sum(1 for k in days if k >= nd - CV_DAYS)
        fit = torch.exp(net(Xt[-n_last * Z * 24:], zt[-n_last * Z * 24:]) + off[-n_last * Z * 24:]).numpy()
    act = yt[-n_last * Z * 24:].numpy().reshape(n_last, Z, 24).sum(axis=2).T
    cv = T.cv_from(act, fit.reshape(n_last, Z, 24).sum(axis=2).T) * CV_WIDEN
    E = data.spread_hourly(P)
    return {"values": data.emit(E, np.minimum(cv, 1.0)), "warnings": warnings, "info": data.info(FEATURES)}
