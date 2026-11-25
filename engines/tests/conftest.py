# SPDX-License-Identifier: AGPL-3.0-only
import json
import os

import pytest

from opendispatch_engines.common import contracts_dir

ENGINES = ("forecaster", "optimizer", "simulator", "assignment")


def _dir() -> str:
    return os.path.abspath(contracts_dir())


@pytest.fixture(scope="session")
def contracts() -> str:
    d = _dir()
    if not os.path.isdir(d):
        pytest.skip(f"contracts directory not found: {d} (set OPENDISPATCH_CONTRACTS_DIR)")
    return d


@pytest.fixture(scope="session")
def load(contracts):
    def _load(rel: str) -> dict:
        with open(os.path.join(contracts, rel), encoding="utf-8") as f:
            return json.load(f)
    return _load
