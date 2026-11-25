# SPDX-License-Identifier: AGPL-3.0-only
"""Shared travel model: haversine x detour / speed."""
import math

DEFAULT_SPEED_KMH = 40.0  # api default
DEFAULT_DETOUR = 1.3  # straight line to road distance
EARTH_KM = 6371.0088  # same radius as the simulator


def km(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 2 * EARTH_KM * math.asin(math.sqrt(min(1.0, a)))


class TravelModel:
    def __init__(self, travel_model=None):
        tm = travel_model or {}
        self.speed = float(tm.get("average_speed_kmh") or DEFAULT_SPEED_KMH)
        self.detour = float(tm.get("detour_factor") or DEFAULT_DETOUR)
        self._k = self.detour / self.speed * 3600.0

    def seconds(self, lat1, lon1, lat2, lon2) -> float:
        return km(lat1, lon1, lat2, lon2) * self._k
