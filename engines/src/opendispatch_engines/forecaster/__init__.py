# SPDX-License-Identifier: AGPL-3.0-only
from ..common import envelope
from . import location
from .guard import before_origin
from .registry import DEFAULT, MODELS, resolve

ENGINE_VERSION = "0.7.0"
MODEL_VERSION = DEFAULT
_MEASURED = {"LIVE", "IMPORTED"}


def handle(request: dict) -> dict:
    request, late = before_origin(request)
    ran, run, unknown = resolve(request["model"].get("model_version"))
    res = run(request)
    warnings = ([late] if late else []) + list(res["warnings"]) + ([unknown] if unknown else [])
    sources = set(request.get("input_data_sources") or [request["data_source"]])
    extra = {}
    if "rule_set_version" in request:
        extra["rule_set_version"] = request["rule_set_version"]
    out = envelope(
        request, "forecaster",
        horizon=dict(request["horizon"]),
        interval_minutes=15,
        intervals_per_day=96,
        range_coverage=request["model"].get("range_coverage", 0.8),
        values=res["values"],
        **extra,
    )
    out["engine"]["version"] = ENGINE_VERSION
    out["model_version"] = ran
    out["illustrative"] = not (sources <= _MEASURED)
    if warnings:
        out["warnings"] = warnings
    out["model_info"] = res["info"]
    if res.get("explanations"):
        out["explanations"] = res["explanations"]
    dist = location.distributions(request)
    if dist is not None:
        out["location_distributions"] = dist
        out["model_info"]["feature_set"] = out["model_info"]["feature_set"] + [location.FEATURE]
    return out
