# SPDX-License-Identifier: AGPL-3.0-only
import copy
import json
import threading
import uuid

import pytest
from jsonschema import Draft202012Validator, FormatChecker

from opendispatch_engines.assignment.reposition import handle, km_matrix
from opendispatch_engines.server import serve

ZONE = "5b8c1a2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d"


def _v(schema):
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, format_checker=FormatChecker())


@pytest.fixture(scope="module")
def schemas(load):
    return (load("reposition.input.schema.json"), load("reposition.output.schema.json"))


def _req(idle, cells, **settings):
    r = {"schema_version": "1.0", "request_id": str(uuid.UUID(int=7)),
         "requested_at": "2026-09-13T09:00:00+03:00", "data_source": "SYNTHETIC",
         "now": "2026-09-13T09:00:00+03:00", "zone_id": ZONE,
         "idle_agents": idle, "demand_cells": cells}
    if settings:
        r["settings"] = settings
    return r


def _sv(i, lat, lon):
    return {"agent_id": str(uuid.UUID(int=i + 1)), "latitude": lat, "longitude": lon}


def _grid(base=0.05):
    # two hot spots about 4 km and 15 km east
    cells = [{"latitude": 24.70 + dy * 0.01, "longitude": 46.70 + dx * 0.01,
              "expected_cases": base} for dy in range(-3, 4) for dx in range(-3, 18)]
    cells.append({"latitude": 24.70, "longitude": 46.74, "expected_cases": 4.0})
    cells.append({"latitude": 24.70, "longitude": 46.85, "expected_cases": 4.0})
    return cells


def test_schema_example_round_trip(schemas):
    vin, vout = _v(schemas[0]), _v(schemas[1])
    for example in schemas[0]["examples"]:
        vin.validate(example)
        out = handle(copy.deepcopy(example))
        vout.validate(out)
        assert out["illustrative"] is True
        assert out["engine"]["name"] == "assignment"
        assert out["model_version"] == "scorer-0.3"
        assert out["zone_id"] == example["zone_id"]
        assert out["request_id"] == example["request_id"]
    for example in schemas[1]["examples"]:
        vout.validate(example)


def test_moves_respect_min_and_max(schemas):
    idle = [_sv(0, 24.70, 46.70), _sv(2, 24.70, 46.86)]
    req = _req(idle, _grid(0.0), min_move_km=2, max_move_km=5, look_ahead_hours=1)
    _v(schemas[0]).validate(req)
    out = handle(req)
    _v(schemas[1]).validate(out)
    where = {s["agent_id"]: (s["latitude"], s["longitude"]) for s in idle}
    assert out["waiting_spots"], "someone should move toward demand"
    for spot in out["waiting_spots"]:
        assert spot["agent_id"] in where
        km = float(km_matrix([where[spot["agent_id"]]], [(spot["latitude"], spot["longitude"])])[0, 0])
        assert 2 <= km <= 5 + 1e-6
        assert abs(km - spot["move_km"]) < 0.01
        assert spot["reason_code"] == "cover_expected_demand"
    assert [s["agent_id"] for s in out["waiting_spots"]] == [str(uuid.UUID(int=1))]
    # the one already near a hot spot stays
    assert str(uuid.UUID(int=3)) not in {s["agent_id"] for s in out["waiting_spots"]}


def test_max_move_caps_long_drives():
    idle = [_sv(0, 24.70, 46.70), _sv(1, 24.70, 46.701)]
    capped = handle(_req(idle, _grid(), max_move_km=3))
    assert all(s["move_km"] <= 3 for s in capped["waiting_spots"])
    wide = handle(_req(idle, _grid(), max_move_km=50))
    assert max(s["move_km"] for s in wide["waiting_spots"]) > 5


def test_empty_inputs_suggest_nothing(schemas):
    for idle, cells in (([], _grid()), ([_sv(0, 24.7, 46.7)], []),
                        ([_sv(0, 24.7, 46.7)], [{"latitude": 24.8, "longitude": 46.8, "expected_cases": 0}])):
        out = handle(_req(idle, cells))
        _v(schemas[1]).validate(out)
        assert out["waiting_spots"] == []


def test_deterministic():
    idle = [_sv(i, 24.70 + i * 0.002, 46.70) for i in range(6)]
    assert handle(_req(idle, _grid()))["waiting_spots"] == handle(_req(idle, _grid()))["waiting_spots"]


@pytest.mark.parametrize("settings", [{"max_move_km": 0}, {"look_ahead_hours": 9},
                                      {"min_move_km": -1}, {"other": 1}])
def test_bad_settings_refused(settings):
    with pytest.raises(ValueError):
        handle(_req([_sv(0, 24.7, 46.7)], _grid(), **settings))


def test_duplicate_agent_refused():
    with pytest.raises(ValueError):
        handle(_req([_sv(0, 24.7, 46.7), _sv(0, 24.7, 46.71)], _grid()))


@pytest.fixture()
def running():
    servers = []

    def start(name):
        s = serve(name, "127.0.0.1:0")
        threading.Thread(target=s.serve_forever, daemon=True).start()
        servers.append(s)
        return s.server_address[1]

    yield start
    for s in servers:
        s.shutdown()
        s.server_close()


def _post(port, path, body):
    import http.client
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    c.request("POST", path, body=body)
    r = c.getresponse()
    data = r.read()
    c.close()
    return r.status, data


def test_service_route(running, schemas):
    port = running("assignment")
    example = schemas[0]["examples"][0]
    status, data = _post(port, "/v1/assignment/reposition", json.dumps(example).encode())
    assert status == 200
    _v(schemas[1]).validate(json.loads(data))
    assert _post(port, "/v1/assignment/reposition", b"{}")[0] == 400
    assert _post(port, "/v1/assignment/nope", json.dumps(example).encode())[0] == 400
    other = running("forecaster")
    assert _post(other, "/v1/forecaster/reposition", json.dumps(example).encode())[0] == 400
