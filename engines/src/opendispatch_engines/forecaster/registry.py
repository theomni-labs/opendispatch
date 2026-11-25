# SPDX-License-Identifier: AGPL-3.0-only
"""Forecast models by version, for model.model_version."""
import importlib

from . import ensemble, ensemble2, ensemble3, ensemble4
from . import profile as P

DEFAULT = "ensemble-4"
PROFILE_FEATURES = ["hour_of_week", "weekly_trend", "pooled_15min_shape", "prayer_lull"]


def _profile(request):
    values, warnings = P.forecast(request)
    days = sorted({r["interval_start"][:10] for r in request.get("history", {}).get("records", [])})
    info = {"feature_set": list(PROFILE_FEATURES), "history_days": len(days)}
    if days:
        info["training_start"], info["training_end"] = days[0], days[-1]
    return {"values": values, "warnings": warnings, "info": info}


def _ensemble6(request):
    return ensemble.run(request, low_volume=True)


MODELS = {
    "ensemble-6": _ensemble6,
    "ensemble-5": ensemble.run,
    "ensemble-4": ensemble4.run,
    "ensemble-3": ensemble3.run,
    "ensemble-2": ensemble2.run,
    "seasonal-profile-1": _profile,
}


# Optional models: module, libraries needed
OPTIONAL = {
    "lightgbm-1": ("lgbm", ("numpy", "lightgbm")),
    "ets-1": ("ets", ("numpy",)),
    "sarima-1": ("sarima", ("numpy", "statsmodels")),
    "prophet-1": ("prophet_model", ("numpy", "pandas", "prophet")),
    "mlp-1": ("mlp", ("numpy", "torch")),
}
KNOWN = sorted(set(MODELS) | set(OPTIONAL))
# Old names that run another model, with a warning
ALIASES = {"lstm-1": "mlp-1"}


def alias_of(version):
    return next(a for a, v in ALIASES.items() if v == version)


def optional(version):
    """(function, None) or (None, missing library)."""
    mod, libs = OPTIONAL[version]
    for lib in libs:
        try:
            importlib.import_module(lib)
        except ImportError:
            return None, lib
    try:
        return importlib.import_module(f"{__package__}.{mod}").run, None
    except ImportError as e:
        return None, e.name or mod


def available():
    """Model versions this engine can run."""
    return [v for v in KNOWN if v in MODELS or optional(v)[0] is not None]


def resolve(version):
    """(version that runs, its function, warning or None)."""
    if version in MODELS:
        return version, MODELS[version], None
    alias = ALIASES.get(version)
    if alias:
        version = alias
    if version in OPTIONAL:
        fn, lib = optional(version)
        if fn is not None and alias:
            msg = f"{alias_of(version)} is a temporal MLP, not an LSTM; it ran as {version}. Ask for {version}."
            return version, fn, {"code": "MODEL_ALIAS", "message": msg}
        if fn is not None:
            return version, fn, None
        msg = (f"Model version {version} needs the library {lib}, which this engine image does not have; "
               f"{DEFAULT} ran instead.")
        return DEFAULT, MODELS[DEFAULT], {"code": "MODEL_UNAVAILABLE", "message": msg[:500]}
    msg = (f"Model version {str(version)[:64]!r} is not known to this engine; {DEFAULT} ran instead. "
           f"Known: {', '.join(KNOWN)}.")
    return DEFAULT, MODELS[DEFAULT], {"code": "UNKNOWN_MODEL_VERSION", "message": msg[:500]}
