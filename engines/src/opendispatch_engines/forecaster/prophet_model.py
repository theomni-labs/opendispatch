# SPDX-License-Identifier: AGPL-3.0-only
"""prophet-1: Prophet per zone on daily totals.

Research image only (prophet ships its own Stan model).
"""
import logging
from datetime import date

import numpy as np
import pandas as pd
from prophet import Prophet

from . import tabular as T

logging.getLogger("cmdstanpy").setLevel(logging.ERROR)
logging.getLogger("prophet").setLevel(logging.ERROR)

MAX_DAYS = 1100
CV_DAYS = 90
CV_WIDEN = 1.3
HOLIDAY_FLAGS = ("holiday", "ramadan", "eid", "event_other", "payday", "school_break", "school_exams")
FEATURES = ["prophet", "weekly_season", "yearly_season", "calendar_holidays", "weather_regressors", "intra_day_shape"]


def run(request):
    data = T.Data(request)
    warnings = []
    used = data.used_flags()
    if not data.known[:data.Dh].any():
        return T.empty(data, warnings, FEATURES + used)
    zd = data.zone_daily()
    first = int(np.argmax(data.known[:data.Dh]))
    lo = max(first, data.Dh - MAX_DAYS)
    dates = pd.to_datetime([date.fromordinal(int(o)).isoformat() for o in data.ords[lo:]])
    hist_n = data.Dh - lo
    hol_names = [f for f in used if f in HOLIDAY_FLAGS]
    wx_names = [f for f in used if f not in HOLIDAY_FLAGS]
    Z, H = len(data.zones), data.H
    daily = np.zeros((Z, H))
    cv = np.full(Z, 0.3)
    for z in range(Z):
        F = np.nan_to_num(data.flags[z, lo:], nan=0.0)
        rows = [(n, dates[i]) for n in hol_names for i in np.where(F[:, T.FLAGS.index(n)] > 0)[0]]
        hol = pd.DataFrame(rows, columns=["holiday", "ds"]) if rows else None
        m = Prophet(holidays=hol, weekly_seasonality=True, yearly_seasonality=hist_n >= 365, daily_seasonality=False,
                    seasonality_mode="multiplicative", uncertainty_samples=0)
        df = pd.DataFrame({"ds": dates, "y": zd[z, lo:]})
        for n in wx_names:
            m.add_regressor(n, mode="multiplicative")
            df[n] = F[:, T.FLAGS.index(n)]
        train = df.iloc[:hist_n].dropna(subset=["y"])
        m.fit(train, algorithm="LBFGS")
        pred = m.predict(df.drop(columns=["y"]))["yhat"].to_numpy()
        daily[z] = np.maximum(pred[hist_n:], 0.0)
        fit = pred[:hist_n][-CV_DAYS:]
        cv[z] = T.cv_from(zd[z:z + 1, lo:data.Dh][:, -CV_DAYS:], fit[None, :])[0] * CV_WIDEN
    E = data.spread_daily(daily)
    return {"values": data.emit(E, np.minimum(cv, 1.0)), "warnings": warnings, "info": data.info(FEATURES + used)}
