# SPDX-License-Identifier: AGPL-3.0-only
import copy

import pytest

from opendispatch_engines.optimizer import _dist_m, cpsat, handle
from test_optimizer_cpsat import _small, _strict_rules
from test_optimizer_engine import _validate
from test_optimizer_reach import K, LAT, LON, PA, PB, Z, _geo, _validate_in, _zone_cells

NEEDS_CP = pytest.mark.skipif(cpsat.load() is None, reason="ortools not installed")
MODELS = [None, "greedy-ls-0.3", pytest.param("cpsat-1", marks=NEEDS_CP)]
U = "3f6f1b1e-7a55-4c27-9d0a-%012x"


def _with_points(model, dmax, centre=True):
    """Points 1, 5 and 9 km north of the centre."""
    req = _small(3, 3)
    z = req["zone_ids"][0]
    req["objective"].pop("model_version")
    if model:
        req["objective"]["model_version"] = model
    if dmax:
        req["objective"]["max_deploy_distance_km"] = dmax
    if centre:
        req["dispatch_centres"] = [{"zone_id": z, "latitude": LAT, "longitude": LON}]
    req["standby_points"] = [
        {"standby_point_id": U % (0xc10 + k), "zone_id": z,
         "latitude": LAT + km * 1000 / K, "longitude": LON}
        for k, km in enumerate((9, 5, 1))]
    return req


def _within(req, out, dmax):
    c = req["dispatch_centres"][0]
    pts = {p["standby_point_id"]: p for p in req["standby_points"]}
    for a in out["roster_assignments"]:
        sp = a["standby_point_id"]
        assert sp is None or _dist_m(pts[sp], c) <= dmax * 1000 + 1e-6


@pytest.mark.parametrize("model", MODELS)
def test_points_within_limit(load, model):
    req = _with_points(model, 3)
    _validate_in(load, req)
    out = handle(req)
    _validate(load, out)
    _strict_rules(req, out)
    _within(req, out, 3)
    assert {a["standby_point_id"] for a in out["roster_assignments"]} == {U % 0xc12}
    assert out["model_version"] == (model or "greedy-ls-0.3")


@pytest.mark.parametrize("model", MODELS)
def test_no_point_within_limit_waits_at_centre(load, model):
    req = _with_points(model, 0.5)
    out = handle(req)
    _validate(load, out)
    assert out["roster_assignments"]
    assert all(a["standby_point_id"] is None for a in out["roster_assignments"])


def test_absent_limit_uses_any_point(load):
    out = handle(_with_points(None, None))
    assert out["model_version"] == "greedy-ls-0.1"
    assert U % 0xc10 in {a["standby_point_id"] for a in out["roster_assignments"]}


def test_missing_centre_is_reported(load):
    req = _with_points(None, 3, centre=False)
    out = handle(req)
    _validate(load, out)
    assert "DISPATCH_CENTRE_MISSING" in {v["code"] for v in out["violations"]}


@pytest.mark.parametrize("model", MODELS[1:])
def test_limit_with_service_level(load, model):
    req = _geo(n_agents=2)
    req["objective"]["model_version"] = model
    req["objective"]["max_deploy_distance_km"] = 1
    req["dispatch_centres"] = [{"zone_id": Z, "latitude": LAT, "longitude": LON}]
    _validate_in(load, req)
    out = handle(req)
    _validate(load, out)
    _strict_rules(req, out)
    assert all(a["standby_point_id"] in (PA, None) for a in out["roster_assignments"])
    # S2, 9 km out, is now out of reach
    assert all(c["reach_share"] == 0.5 for c in _zone_cells(out))
    assert "SERVICE_LEVEL_REACH" in {v["code"] for v in out["violations"]}
    free = copy.deepcopy(req)
    free["objective"].pop("max_deploy_distance_km")
    assert PB in {a["standby_point_id"] for a in handle(free)["roster_assignments"]}
