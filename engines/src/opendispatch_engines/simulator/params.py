# SPDX-License-Identifier: AGPL-3.0-only
"""Simulator parameters.

DEFAULTS are fitted by `calibrate.fit` on SYNTHETIC training days
(6 to 12 Sep 2026) and written to fitted.py. They are assumptions about
The customer's operation until refitted on Customer history; nothing is measured.
"""
from dataclasses import dataclass, replace

from .fitted import FITTED

HOURS = 24


@dataclass(frozen=True)
class SimParams:
    # fixed seconds per trip (dispatch, parking)
    trip_overhead_seconds: float = 0.0
    # trip lognormal sigma when no table
    travel_noise_sigma: float = 0.0
    # trip residual quantiles per km band
    travel_bands_km: tuple = ()
    travel_residual_quantiles: tuple = ()
    # times the shared model speed, by hour
    speed_factor_by_hour: tuple = (1.0,) * HOURS
    # (zone_id, factor) pairs; absent zones 1.0
    speed_factor_by_zone: tuple = ()
    # arrived -> closed, handover included
    on_scene_median_seconds: float = 1200.0
    on_scene_p90_seconds: float = 2000.0
    on_scene_min_seconds: float = 120.0
    on_scene_cap_seconds: float = 7200.0
    # registered -> assignable (nearest, scorer)
    dispatch_delay_median_seconds: float = 0.0
    dispatch_delay_p90_seconds: float = 0.0
    dispatch_delay_cap_seconds: float = 7200.0
    # drive back to the standby point after closing
    return_to_base: bool = True

    def with_(self, **kw):
        return replace(self, **kw)


DEFAULTS = SimParams(**FITTED)

# The pure travel model, nothing fitted.
PLAIN = SimParams(return_to_base=False)
