# SPDX-License-Identifier: AGPL-3.0-only
import copy
import http.client
import json
import socket
import threading
import time

import pytest
from jsonschema import Draft202012Validator

from opendispatch_engines import server

ENGINES = ("forecaster", "optimizer", "simulator", "assignment")


@pytest.fixture()
def running(monkeypatch):
    servers = []

    def start(name, engine=None, **env):
        for k, v in env.items():
            monkeypatch.setenv(k, str(v))
        if engine:
            monkeypatch.setattr(server, "load_engine", lambda n: engine)
        s = server.serve(name, "127.0.0.1:0")
        threading.Thread(target=s.serve_forever, daemon=True).start()
        servers.append(s)
        return s.server_address[1]

    yield start
    for s in servers:
        s.shutdown()
        s.server_close()


def _req(port, method, path, body=None):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    c.request(method, path, body=body)
    r = c.getresponse()
    data = r.read()
    c.close()
    return r.status, data


def test_slow_client_cut_others_served(running):
    port = running("assignment", OPENDISPATCH_ENGINE_READ_TIMEOUT="0.5")
    s = socket.create_connection(("127.0.0.1", port), timeout=5)
    s.sendall(b"POST /v1/assignment HTTP/1.1\r\nHost: x\r\nContent-Length: 50\r\n\r\n{")
    assert _req(port, "GET", "/health")[0] == 200
    start = time.time()
    first = s.recv(256)
    assert time.time() - start < 3
    assert first == b"" or first.split()[1] == b"400"
    s.close()


def test_slow_headers_cut(running):
    port = running("assignment", OPENDISPATCH_ENGINE_READ_TIMEOUT="0.5")
    with socket.create_connection(("127.0.0.1", port), timeout=5) as s:
        s.sendall(b"GET /health HTTP/1.1\r\nHost: x\r\n")
        start = time.time()
        assert s.recv(256) == b""
        assert time.time() - start < 3


def test_deep_json_400(running):
    port = running("assignment")
    for depth in (100, 100_000):
        body = b'{"a":' + b"[" * depth + b"]" * depth + b"}"
        assert _req(port, "POST", "/v1/assignment", body)[0] == 400


def test_oversize_413(running):
    port = running("assignment", OPENDISPATCH_ENGINE_MAX_BODY=1024)
    assert _req(port, "POST", "/v1/assignment", b" " * 1025)[0] == 413
    assert _req(port, "POST", "/v1/assignment", b"{}")[0] == 400


def test_default_cap_413(running):
    port = running("assignment")
    with socket.create_connection(("127.0.0.1", port), timeout=5) as s:
        s.sendall(b"POST /v1/assignment HTTP/1.1\r\nHost: x\r\n"
                  b"Content-Length: 16777217\r\n\r\n")
        assert s.recv(64).split()[1] == b"413"


def test_concurrency_503_health_ok(running):
    gate = threading.Event()
    entered = threading.Event()

    def slow(request):
        entered.set()
        gate.wait(5)
        return {}

    port = running("assignment", engine=slow, OPENDISPATCH_ENGINE_MAX_CONCURRENT=1)
    t = threading.Thread(target=_req, args=(port, "POST", "/v1/assignment", b"{}"))
    t.start()
    assert entered.wait(5)
    status, data = _req(port, "POST", "/v1/assignment", b"{}")
    assert status == 503 and json.loads(data) == {"error": "busy"}
    assert _req(port, "GET", "/health")[0] == 200
    gate.set()
    t.join()
    assert _req(port, "POST", "/v1/assignment", b"{}")[0] == 200


def test_connection_cap_503(running):
    port = running("assignment", OPENDISPATCH_ENGINE_MAX_CONNECTIONS=1, OPENDISPATCH_ENGINE_READ_TIMEOUT="5")
    hold = socket.create_connection(("127.0.0.1", port), timeout=5)
    time.sleep(0.2)
    assert _req(port, "GET", "/health")[0] == 503
    hold.close()


def test_client_disconnect_midresponse(running):
    port = running("assignment")
    s = socket.create_connection(("127.0.0.1", port), timeout=5)
    s.sendall(b"POST /v1/assignment HTTP/1.1\r\nHost: x\r\nContent-Length: 2\r\n\r\n{}")
    s.close()
    assert _req(port, "GET", "/health")[0] == 200


def test_no_request_content_in_errors(running):
    port = running("assignment")
    _, data = _req(port, "POST", "/v1/assignment", b"{secret-token")
    assert b"secret" not in data


def test_horizon_limits(running, load):
    port = running("forecaster")
    request = load("examples/forecaster.input.json")
    for days in (31, 0, "3", True):
        bad = copy.deepcopy(request)
        bad["horizon"]["days"] = days
        assert _req(port, "POST", "/v1/forecaster", json.dumps(bad).encode())[0] == 400
    ok = copy.deepcopy(request)
    ok["horizon"]["days"] = 30
    assert _req(port, "POST", "/v1/forecaster", json.dumps(ok).encode())[0] == 200


def test_list_size_cap(running, load, monkeypatch):
    monkeypatch.setattr(server, "MAX_LIST", 3)
    port = running("assignment")
    request = load("examples/assignment.input.json")
    request["candidates"] = request["candidates"] * 3
    assert _req(port, "POST", "/v1/assignment", json.dumps(request).encode())[0] == 400


@pytest.mark.parametrize("name", ENGINES)
def test_examples_still_valid(running, load, name):
    port = running(name)
    request = load(f"examples/{name}.input.json")
    status, data = _req(port, "POST", f"/v1/{name}", json.dumps(request).encode())
    assert status == 200
    Draft202012Validator(load(f"{name}.output.schema.json")).validate(json.loads(data))
