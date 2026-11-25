# SPDX-License-Identifier: AGPL-3.0-only
"""Day-level weather and traffic flags per zone, by city."""

RAIN_MM = 1.0  # rain day from this many mm
LOW_VIS_KM = 2.0  # low visibility below this
HEAT_40 = 40.0
HEAT_45 = 45.0
PREFIX = "weather_"
FEATS = ("weather_rain", "weather_dust", "weather_low_visibility", "weather_heat_40", "weather_heat_45")
TRAFFIC_PREFIX = "traffic_"
TRAFFIC_HEAVY = 1.2  # congestion index: 1.0 is typical
TRAFFIC_FEATS = ("traffic_heavy",)


def is_weather(f):
    """Weather or traffic: known only by city-day."""
    return f.startswith((PREFIX, TRAFFIC_PREFIX))


def is_traffic(f):
    return f.startswith(TRAFFIC_PREFIX)


def _day_flags(w):
    out = dict.fromkeys(FEATS)
    r = w.get("rain_mm")
    if r is not None:
        out["weather_rain"] = int(r >= RAIN_MM)
    if w.get("dust_event") is not None:
        out["weather_dust"] = int(bool(w["dust_event"]))
    v = w.get("visibility_km")
    if v is not None:
        out["weather_low_visibility"] = int(v < LOW_VIS_KM)
    t = w.get("max_temp_c")
    if t is not None:
        out["weather_heat_40"] = int(HEAT_40 <= t < HEAT_45)
        out["weather_heat_45"] = int(t >= HEAT_45)
    return out


def _traffic_flags(t):
    i = t.get("congestion_index")
    return {"traffic_heavy": None if i is None else int(i >= TRAFFIC_HEAVY)}


class Weather:
    """Weather (and traffic) flags by (date, zone); inactive without either."""

    def __init__(self, request, traffic=False):
        city = {z["zone_id"]: z.get("city_id") for z in request["zones"]}
        cities = {c for c in city.values() if c}
        self.city = city
        self.days = {}
        seen = set()
        for w in request.get("weather") or ():
            if w.get("city_id") not in cities:
                continue
            f = _day_flags(w)
            self.days[(w["city_id"], w["date"])] = f
            seen.update(k for k, v in f.items() if v is not None)
        names = FEATS
        if traffic:
            names = FEATS + TRAFFIC_FEATS
            for t in request.get("traffic") or ():
                if t.get("city_id") not in cities:
                    continue
                f = _traffic_flags(t)
                k = (t["city_id"], t["date"])
                self.days[k] = {**dict.fromkeys(FEATS), **self.days.get(k, {}), **f}
                seen.update(n for n, v in f.items() if v is not None)
        self.feats = [f for f in names if f in seen]
        self.active = bool(self.feats)
        self._none = dict.fromkeys(self.feats)

    def flags(self, d, z):
        c = self.city.get(z)
        f = self.days.get((c, d)) if c else None
        if f is None:
            return self._none
        return {k: f.get(k) for k in self.feats}
