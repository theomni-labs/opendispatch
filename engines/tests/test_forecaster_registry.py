# SPDX-License-Identifier: AGPL-3.0-only
"""model.model_version picks the model; SYNTHETIC data only."""
import copy

import pytest
from jsonschema import Draft202012Validator, FormatChecker

from opendispatch_engines.forecaster import MODEL_VERSION, handle
from opendispatch_engines.forecaster import ensemble, ensemble2, ensemble3, ensemble4, registry
from opendispatch_engines.forecaster.profile import forecast as v1_forecast

from test_forecaster_engine import _invariants, _split, _strip


@pytest.fixture(scope="module")
def req():
    r, *_ = _split()
    return r


def _ask(req, version):
    r = copy.deepcopy(req)
    r["model"]["model_version"] = version
    return handle(r)


def _codes(out):
    return [w["code"] for w in out.get("warnings", [])]


def test_default_is_ensemble4():
    assert registry.DEFAULT == MODEL_VERSION == "ensemble-4"
    assert set(registry.MODELS) == {"ensemble-6", "ensemble-5", "ensemble-4", "ensemble-3", "ensemble-2",
                                    "seasonal-profile-1"}


@pytest.mark.parametrize("version", ["ensemble-6", "ensemble-5", "ensemble-4", "ensemble-3", "ensemble-2",
                                     "seasonal-profile-1"])
def test_each_version_runs_and_is_named(load, req, version):
    out = _ask(req, version)
    Draft202012Validator(load("forecaster.output.schema.json"), format_checker=FormatChecker()).validate(out)
    _invariants(out, req)
    assert out["model_version"] == version
    assert "UNKNOWN_MODEL_VERSION" not in _codes(out)


def test_versions_run_their_own_code(req):
    v6, v5, v4, v3, v2, v1 = (_ask(req, v)["values"] for v in (
        "ensemble-6", "ensemble-5", "ensemble-4", "ensemble-3", "ensemble-2", "seasonal-profile-1"))
    assert v6 == ensemble.run(copy.deepcopy(req), low_volume=True)["values"]
    assert v5 == ensemble.run(copy.deepcopy(req))["values"]
    assert v4 == ensemble4.run(copy.deepcopy(req))["values"]
    assert v3 == ensemble3.run(copy.deepcopy(req))["values"]
    assert v2 == ensemble2.run(copy.deepcopy(req))["values"]
    assert v1 == v1_forecast(copy.deepcopy(req))[0]
    assert v1 != v3 and v1 != v2


def test_unknown_version_runs_default_with_warning(req):
    out = _ask(req, "placeholder-0.1")
    assert out["model_version"] == "ensemble-4"
    assert _codes(out)[-1] == "UNKNOWN_MODEL_VERSION"
    assert "placeholder-0.1" in out["warnings"][-1]["message"]
    known = _ask(req, "ensemble-4")
    assert out["values"] == known["values"]
    assert _codes(out)[:-1] == _codes(known)


def test_default_output_unchanged(req):
    out = _ask(req, "ensemble-4")
    res = ensemble4.run(copy.deepcopy(req))
    assert out["values"] == res["values"]
    assert out.get("warnings", []) == res["warnings"]
    assert out["model_info"] == res["info"]
    assert _strip(out) == _strip(_ask(req, "ensemble-4"))


def test_ensemble3_output_unchanged(req):
    out = _ask(req, "ensemble-3")
    res = ensemble3.run(copy.deepcopy(req))
    assert out["values"] == res["values"]
    assert out["model_info"] == res["info"]
