# SPDX-License-Identifier: AGPL-3.0-only
import os
from datetime import datetime, timezone

from . import __version__

MODEL_VERSION = "stub-0"
ENGINES = ("forecaster", "optimizer", "simulator", "assignment")


def contracts_dir() -> str:
    return os.environ.get("OPENDISPATCH_CONTRACTS_DIR", "../contracts/engines")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def envelope(request: dict, name: str, **extra) -> dict:
    out = {
        "schema_version": "1.0",
        "request_id": request["request_id"],
        "engine": {"name": name, "version": __version__},
        "model_version": MODEL_VERSION,
        "generated_at": now_iso(),
        "data_source": request["data_source"],
        "illustrative": True,
    }
    if "input_data_sources" in request:
        out["input_data_sources"] = list(request["input_data_sources"])
    out.update(extra)
    return out
