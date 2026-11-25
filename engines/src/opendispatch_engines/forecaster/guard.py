# SPDX-License-Identifier: AGPL-3.0-only
"""History guard: nothing on or after the horizon start."""
from datetime import date, datetime

from .profile import TZ

CODE = "HISTORY_AFTER_ORIGIN"


def _day(ts, cache):
    o = cache.get(ts)
    if o is None:
        dt = datetime.fromisoformat(ts)
        dt = dt.replace(tzinfo=TZ) if dt.tzinfo is None else dt.astimezone(TZ)
        o = cache[ts] = dt.date().toordinal()
    return o


def before_origin(request):
    """(request without late history, warning or None)."""
    hist = request.get("history")
    if not isinstance(hist, dict):
        return request, None
    origin = date.fromisoformat(request["horizon"]["start_date"]).toordinal()
    cache, kept, dropped = {}, {}, 0
    for key, field in (("records", "interval_start"), ("aggregated_records", "period_start")):
        recs = hist.get(key)
        if not recs:
            continue
        ok = [r for r in recs if _day(r[field], cache) < origin]
        dropped += len(recs) - len(ok)
        if len(ok) != len(recs):
            kept[key] = ok
    if not dropped:
        return request, None
    out = dict(request)
    out["history"] = {**hist, **kept}
    msg = (f"{dropped} history records dated on or after the horizon start "
           f"{request['horizon']['start_date']} (UTC+3) were ignored, so the forecast "
           "never learns from the days it forecasts.")
    return out, {"code": CODE, "message": msg[:500]}
