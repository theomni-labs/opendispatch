# SPDX-License-Identifier: AGPL-3.0-only
import gzip
import http.client
import json
import resource
import threading
from datetime import datetime

import pytest

from opendispatch_engines import server

ENGINES = ("forecaster", "optimizer", "simulator", "assignment")


@pytest.fixture()
def running(monkeypatch):
    servers = []

    def start(name, **env):
        for k, v in env.items():
            monkeypatch.setenv(k, str(v))
        s = server.serve(name, "127.0.0.1:0")
        threading.Thread(target=s.serve_forever, daemon=True).start()
        servers.append(s)
        return s.server_address[1]

    yield start
    for s in servers:
        s.shutdown()
        s.server_close()


def _post(port, name, body, encoding=None):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    headers = {"Content-Encoding": encoding} if encoding else {}
    c.request("POST", f"/v1/{name}", body=body, headers=headers)
    r = c.getresponse()
    data = r.read()
    c.close()
    return r.status, data


@pytest.mark.parametrize("name", ENGINES)
def test_gzip_matches_plain(running, load, name):
    port = running(name)
    plain = json.dumps(load(f"examples/{name}.input.json")).encode()
    s1, d1 = _post(port, name, plain)
    s2, d2 = _post(port, name, gzip.compress(plain), "gzip")
    s3, d3 = _post(port, name, plain, "identity")
    assert s1 == s2 == s3 == 200
    answers = [json.loads(d) for d in (d1, d2, d3)]
    # run_seconds and generated_at are wall-clock: three requests can straddle a second.
    for a in answers:
        a.pop("run_seconds", None)
        if "generated_at" in a:
            datetime.fromisoformat(a.pop("generated_at"))
    assert answers[0] == answers[1] == answers[2]


def test_bomb_gets_413_with_small_memory(running):
    port = running("assignment", OPENDISPATCH_ENGINE_MAX_DECOMPRESSED=1024 * 1024)
    bomb = gzip.compress(b"0" * (400 * 1024 * 1024), 9)
    assert len(bomb) < 1024 * 1024
    before = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    status, data = _post(port, "assignment", bomb, "gzip")
    grown = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss - before
    assert status == 413
    assert grown < 100 * 1024
    assert b"000" not in data


def test_plain_over_decompressed_limit(running):
    port = running("assignment", OPENDISPATCH_ENGINE_MAX_DECOMPRESSED=100)
    assert _post(port, "assignment", b" " * 200)[0] == 413


def test_wire_cap_applies_to_compressed(running):
    port = running("assignment", OPENDISPATCH_ENGINE_MAX_BODY=100)
    assert _post(port, "assignment", b"x" * 200, "gzip")[0] == 413


def test_bad_gzip_400(running):
    port = running("assignment")
    good = gzip.compress(b'{"a": 1}')
    assert _post(port, "assignment", b"not gzip", "gzip")[0] == 400
    assert _post(port, "assignment", good[:-6], "gzip")[0] == 400
    assert _post(port, "assignment", good + b"junk", "gzip")[0] == 400
    assert _post(port, "assignment", gzip.compress(b"{bad"), "gzip")[0] == 400


def test_unknown_encoding_415(running):
    port = running("assignment")
    for enc in ("br", "deflate", "gzip, br"):
        assert _post(port, "assignment", b"{}", enc)[0] == 415


def test_depth_limit_on_decoded(running):
    port = running("assignment")
    deep = b"[" * 100 + b"]" * 100
    assert _post(port, "assignment", gzip.compress(b'{"a":' + deep + b"}"), "gzip")[0] == 400


def _get(port, name, body, accept=None):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=60)
    headers = {"Accept-Encoding": accept} if accept else {}
    c.request("POST", f"/v1/{name}", body=body, headers=headers)
    r = c.getresponse()
    data = r.read()
    out = (r.status, r.getheader("Content-Encoding"), r.getheader("Content-Length"), data)
    c.close()
    return out


def _big_request(load):
    request = load("examples/assignment.input.json")
    request["candidates"] = request["candidates"] * 1000
    return json.dumps(request).encode()


def test_queue_size():
    assert server.BoundedServer.request_queue_size == 128
    assert server.BoundedServer.daemon_threads is True


def test_compact_json_same_content(running, load):
    port = running("assignment")
    body = json.dumps(load("examples/assignment.input.json")).encode()
    status, enc, length, data = _get(port, "assignment", body)
    assert status == 200 and enc is None
    assert b'": ' not in data and b'", ' not in data
    assert int(length) == len(data)
    old = json.dumps(json.loads(data)).encode()
    assert json.loads(old) == json.loads(data)
    assert len(old) > len(data)


def test_gzip_response_when_asked_and_large(running, load):
    port = running("assignment", OPENDISPATCH_ENGINE_MAX_LIST=1_000_000)
    body = _big_request(load)
    s1, e1, l1, d1 = _get(port, "assignment", body)
    s2, e2, l2, d2 = _get(port, "assignment", body, "gzip")
    s3, e3, l3, d3 = _get(port, "assignment", body, "gzip;q=0")
    assert s1 == s2 == s3 == 200
    assert len(d1) > server.GZIP_MIN
    assert e1 is None and e3 is None and e2 == "gzip"
    assert int(l2) == len(d2) < len(d1)
    answers = [json.loads(x) for x in (d1, gzip.decompress(d2), d3)]
    for a in answers:
        a.pop("run_seconds", None)
        a.pop("decision_time_ms", None)
        a.pop("generated_at", None)
    assert answers[0] == answers[1] == answers[2]


def test_small_response_not_gzipped(running, load):
    port = running("assignment")
    body = json.dumps(load("examples/assignment.input.json")).encode()
    status, enc, _, data = _get(port, "assignment", body, "gzip")
    assert status == 200 and enc is None
    json.loads(data)


def test_large_list_accepted_and_configurable(running, load):
    request = load("examples/assignment.input.json")
    request["candidates"] = request["candidates"] * 70000
    assert len(request["candidates"]) > 200_000
    body = gzip.compress(json.dumps(request).encode())
    port = running("assignment")
    assert _post(port, "assignment", body, "gzip")[0] == 200
    small = running("assignment", OPENDISPATCH_ENGINE_MAX_LIST=1000)
    assert _post(small, "assignment", body, "gzip")[0] == 400


def test_node_cap_scales_and_is_bounded():
    big = {"a": [[0] * 5 for _ in range(1000)]}
    assert server.check_limits("assignment", big, 10_000, 10_000 * server.NODE_FACTOR)
    assert not server.check_limits("assignment", big, 10_000, 3000)


def test_over_list_cap_memory_bounded(running):
    port = running("assignment", OPENDISPATCH_ENGINE_MAX_LIST=1_000_000)
    body = json.dumps({"x": [0] * 1_500_000}).encode()
    before = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    status, _ = _post(port, "assignment", body)
    grown = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss - before
    assert status == 400
    assert grown < 400 * 1024
