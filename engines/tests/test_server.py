# SPDX-License-Identifier: AGPL-3.0-only
import http.client
import json
import socket
import threading

import pytest
from jsonschema import Draft202012Validator

from opendispatch_engines.server import serve


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


def _req(port, method, path, body=None):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    c.request(method, path, body=body)
    r = c.getresponse()
    data = r.read()
    c.close()
    return r.status, data


def test_health_and_errors(running):
    port = running("assignment")
    status, data = _req(port, "GET", "/health")
    assert status == 200
    assert json.loads(data) == {"name": "assignment", "version": "0.7.0"}
    assert _req(port, "POST", "/v1/assignment", b"{not json")[0] == 400
    assert _req(port, "POST", "/v1/forecaster", b"{}")[0] == 400
    assert _req(port, "POST", "/v1/nope", b"{}")[0] == 400
    assert _req(port, "POST", "/v1/assignment", b"{}")[0] == 400


def test_oversize_body_refused(running):
    port = running("assignment")
    with socket.create_connection(("127.0.0.1", port), timeout=5) as s:
        s.sendall(
            b"POST /v1/assignment HTTP/1.1\r\nHost: x\r\n"
            b"Content-Length: 17825792\r\n\r\n"
        )
        first = s.recv(64)
    assert first.split()[1] in (b"413", b"400")


def test_valid_post(running, load):
    port = running("assignment")
    request = load("examples/assignment.input.json")
    status, data = _req(port, "POST", "/v1/assignment", json.dumps(request).encode())
    assert status == 200
    Draft202012Validator(load("assignment.output.schema.json")).validate(json.loads(data))
