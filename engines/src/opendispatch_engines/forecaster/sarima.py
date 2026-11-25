# SPDX-License-Identifier: AGPL-3.0-only
"""sarima-1: SARIMAX per zone on log daily totals.

Research image only (statsmodels).
"""
import warnings as _w

import numpy as np
from statsmodels.tsa.statespace.sarimax import SARIMAX

from . import tabular as T

MAX_DAYS = 730  # days fitted per zone
ORDER = (1, 0, 1)
SEASONAL = (1, 1, 1, 7)
MAXITER = 60
FEATURES = ["sarimax_weekly", "log_daily_total", "calendar_exog", "weather_exog", "intra_day_shape"]


def _fallback(y, wd, wd_h):
    """Mean of the last 4 same weekdays."""
    out = []
    for w in wd_h:
        v = y[wd == w][-4:]
        v = v[~np.isnan(v)]
        out.append(float(v.mean()) if len(v) else 0.0)
    return np.array(out)


def run(request):
    data = T.Data(request)
    warnings = []
    used = data.used_flags()
    if not data.known[:data.Dh].any():
        return T.empty(data, warnings, FEATURES + used)
    zd = data.zone_daily()
    first = int(np.argmax(data.known[:data.Dh]))
    lo = max(first, data.Dh - MAX_DAYS)
    idx = [T.FLAGS.index(f) for f in used]
    Z, H = len(data.zones), data.H
    daily = np.zeros((Z, H))
    cv = np.full(Z, 0.3)
    failed = 0
    for z in range(Z):
        y = zd[z, lo:data.Dh]
        X = np.nan_to_num(data.flags[z, lo:][:, idx], nan=0.0) if idx else None
        keep = []
        if X is not None:
            Xt = X[:len(y)]
            keep = [j for j in range(X.shape[1]) if Xt[:, j].std() > 0]
        Xk = X[:, keep] if keep else None
        try:
            with _w.catch_warnings():
                _w.simplefilter("ignore")
                m = SARIMAX(np.log1p(y), exog=None if Xk is None else Xk[:len(y)], order=ORDER, seasonal_order=SEASONAL,
                            enforce_stationarity=False, enforce_invertibility=False)
                res = m.fit(disp=False, maxiter=MAXITER, method="lbfgs")
                fc = res.get_forecast(H, exog=None if Xk is None else Xk[len(y):])
                mu, var = np.asarray(fc.predicted_mean), np.asarray(fc.var_pred_mean)
            if not np.all(np.isfinite(mu)) or not np.all(np.isfinite(var)):
                raise ValueError("non-finite forecast")
            daily[z] = np.maximum(np.expm1(mu + 0.5 * var), 0.0)
            cv[z] = float(np.sqrt(np.expm1(np.mean(var))))
        except (ValueError, np.linalg.LinAlgError):
            failed += 1
            daily[z] = _fallback(y, data.wd[lo:data.Dh], data.wd[data.Dh:])
    if failed:
        warnings.append({"code": "MODEL_FIT_FALLBACK", "message": f"SARIMAX failed for {failed} zone(s); they use the mean of the last 4 same weekdays."})
    E = data.spread_daily(daily)
    return {"values": data.emit(E, np.minimum(cv, 1.0)), "warnings": warnings, "info": data.info(FEATURES + used)}
