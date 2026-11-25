# SPDX-License-Identifier: AGPL-3.0-only
import importlib

import pytest
from jsonschema import Draft202012Validator, FormatChecker

from conftest import ENGINES


def _validator(schema: dict) -> Draft202012Validator:
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, format_checker=FormatChecker())


@pytest.mark.parametrize("name", ENGINES)
def test_example_is_valid_input(load, name):
    v = _validator(load(f"{name}.input.schema.json"))
    v.validate(load(f"examples/{name}.input.json"))


@pytest.mark.parametrize("name", ENGINES)
def test_engine_output_is_valid_and_labelled(load, name):
    request = load(f"examples/{name}.input.json")
    out = importlib.import_module(f"opendispatch_engines.{name}").handle(request)
    _validator(load(f"{name}.output.schema.json")).validate(out)
    assert out["illustrative"] is True
    assert out["data_source"] == request["data_source"]
    assert out["engine"]["name"] == name
    assert out["model_version"]


def test_assignment_example_ranks_available_only(load):
    from opendispatch_engines.assignment import handle
    out = handle(load("examples/assignment.input.json"))
    assert out["status"] == "ranked"
    ids = [r["agent_id"] for r in out["ranking"]]
    assert "85b352dd-77f5-4e0a-96f7-85126ee6000a" not in ids
    assert [r["rank"] for r in out["ranking"]] == list(range(1, len(ids) + 1))


def test_assignment_already_assigned(load):
    from opendispatch_engines.assignment import handle
    req = load("examples/assignment.input.json")
    req["case"]["existing_assignment_id"] = "3f6f1b1e-7a55-4c27-9d0a-0000000000ff"
    out = handle(req)
    assert out["status"] == "already_assigned" and out["ranking"] == []
