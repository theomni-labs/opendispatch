# SPDX-License-Identifier: AGPL-3.0-only
import gzip
import json
import os
import threading
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import __version__
from .common import ENGINES

MAX_BODY = 16 * 1024 * 1024
MAX_DECOMPRESSED = 128 * 1024 * 1024
CHUNK = 1024 * 1024
MAX_DEPTH = 64
MAX_LIST = 2_000_000
NODE_FACTOR = 10
MAX_NODES = MAX_LIST * NODE_FACTOR
GZIP_MIN = 64 * 1024
MAX_HORIZON_DAYS = 30
LOOPBACK = ("127.0.0.1", "localhost", "::1")


def _env_num(key: str, default, cast):
    try:
        value = cast(os.environ.get(key, default))
    except ValueError:
        raise SystemExit(f"{key} must be a number")
    if value <= 0:
        raise SystemExit(f"{key} must be positive")
    return value


def load_engine(name: str):
    if name not in ENGINES:
        raise SystemExit(f"OPENDISPATCH_ENGINE must be one of {'|'.join(ENGINES)}")
    return __import__(f"opendispatch_engines.{name}", fromlist=["handle"]).handle


def load_routes(name: str, handle) -> dict:
    """POST path to handler: /v1/<name> and extras."""
    module = __import__(f"opendispatch_engines.{name}", fromlist=["ROUTES"])
    routes = {f"/v1/{name}": handle}
    for key, fn in getattr(module, "ROUTES", {}).items():
        routes[f"/v1/{name}/{key}"] = fn
    return routes


def check_limits(name: str, request: dict, max_list: int | None = None,
                 max_nodes: int | None = None) -> bool:
    # one pass, no recursion: depth, list and node caps
    max_list = MAX_LIST if max_list is None else max_list
    max_nodes = MAX_NODES if max_nodes is None else max_nodes
    stack = [(request, 1)]
    nodes = 0
    while stack:
        item, depth = stack.pop()
        nodes += 1
        if depth > MAX_DEPTH or nodes > max_nodes:
            return False
        if isinstance(item, dict):
            children = item.values()
        elif isinstance(item, list):
            if len(item) > max_list:
                return False
            children = item
        else:
            continue
        nodes += len(children)
        stack.extend((c, depth + 1) for c in children if isinstance(c, (dict, list)))
    if name == "forecaster" and "horizon" in request:
        horizon = request["horizon"]
        days = horizon.get("days") if isinstance(horizon, dict) else None
        if type(days) is not int or not 1 <= days <= MAX_HORIZON_DAYS:
            return False
    return True


def gunzip(raw: bytes, limit: int):
    # chunked, stops at the limit: None means too large
    d = zlib.decompressobj(wbits=31)
    out = []
    size = 0
    try:
        data = raw
        while True:
            chunk = d.decompress(data, CHUNK)
            size += len(chunk)
            if size > limit:
                return None
            out.append(chunk)
            data = d.unconsumed_tail
            if not data:
                break
    except zlib.error:
        raise ValueError
    if not d.eof or d.unused_data:
        raise ValueError
    return b"".join(out)


def _accepts(header: str) -> set:
    # tokens with q=0 are refused
    out = set()
    for part in header.split(","):
        token, _, params = part.partition(";")
        if params.replace(" ", "").lower() in ("q=0", "q=0.0", "q=0.00", "q=0.000"):
            continue
        out.add(token.strip().lower())
    return out


def make_handler(name: str, read_timeout: float, slots: threading.BoundedSemaphore,
                 max_body: int, max_plain: int = MAX_DECOMPRESSED,
                 max_list: int | None = None):
    routes = load_routes(name, load_engine(name))

    class Handler(BaseHTTPRequestHandler):
        timeout = read_timeout

        def log_message(self, fmt, *args):
            return

        def _send(self, code: int, body: dict):
            data = json.dumps(body, separators=(",", ":")).encode()
            gz = len(data) > GZIP_MIN and "gzip" in _accepts(
                self.headers.get("Accept-Encoding", ""))
            if gz:
                data = gzip.compress(data, 3, mtime=0)
            try:
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                if gz:
                    self.send_header("Content-Encoding", "gzip")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.write(data)
            except OSError:
                self.close_connection = True

        def do_GET(self):
            if self.path == "/health":
                self._send(200, {"name": name, "version": __version__})
            else:
                self._send(404, {"error": "not found"})

        def do_POST(self):
            handle = routes.get(self.path)
            if handle is None:
                self._send(400, {"error": "unknown engine"})
                return
            if not slots.acquire(blocking=False):
                self._send(503, {"error": "busy"})
                return
            try:
                self._post(handle)
            except OSError:
                self.close_connection = True
            except MemoryError:
                self._send(500, {"error": "server error"})
            finally:
                slots.release()

        def _post(self, handle):
            try:
                length = int(self.headers.get("Content-Length", ""))
            except ValueError:
                self._send(400, {"error": "length required"})
                return
            if length < 0:
                self._send(400, {"error": "bad length"})
                return
            if length > max_body:
                self._send(413, {"error": "body too large"})
                return
            encoding = self.headers.get("Content-Encoding", "identity").strip().lower()
            if encoding not in ("identity", "gzip"):
                self._send(415, {"error": "unsupported encoding"})
                return
            raw = self.rfile.read(length)
            if len(raw) < length:
                self._send(400, {"error": "short body"})
                return
            if encoding == "gzip":
                try:
                    plain = gunzip(raw, max_plain)
                except ValueError:
                    self._send(400, {"error": "invalid gzip"})
                    return
                if plain is None:
                    self._send(413, {"error": "body too large"})
                    return
                raw = plain
            elif len(raw) > max_plain:
                self._send(413, {"error": "body too large"})
                return
            try:
                request = json.loads(raw)
                if not isinstance(request, dict):
                    raise ValueError
            except (ValueError, RecursionError):
                self._send(400, {"error": "invalid json"})
                return
            del raw
            if not check_limits(name, request, max_list,
                                None if max_list is None else max_list * NODE_FACTOR):
                self._send(400, {"error": "invalid request"})
                return
            try:
                result = handle(request)
            except (KeyError, TypeError, ValueError, RecursionError):
                self._send(400, {"error": "invalid request"})
                return
            except Exception:
                self._send(500, {"error": "server error"})
                return
            self._send(200, result)

    return Handler


class BoundedServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 128

    def __init__(self, addr, handler, max_conns: int):
        super().__init__(addr, handler)
        self._conns = threading.BoundedSemaphore(max_conns)

    def process_request(self, request, client_address):
        if not self._conns.acquire(blocking=False):
            try:
                request.settimeout(1)
                request.sendall(
                    b"HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json"
                    b"\r\nContent-Length: 17\r\nConnection: close\r\n\r\n"
                    b'{"error": "busy"}'
                )
            except OSError:
                pass
            self.shutdown_request(request)
            return
        super().process_request(request, client_address)

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._conns.release()

    def handle_error(self, request, client_address):
        return


def serve(name: str, addr: str) -> BoundedServer:
    host, _, port = addr.rpartition(":")
    host = host or "0.0.0.0"
    timeout = _env_num("OPENDISPATCH_ENGINE_READ_TIMEOUT", 10, float)
    limit = _env_num("OPENDISPATCH_ENGINE_MAX_CONCURRENT", 16, int)
    max_body = _env_num("OPENDISPATCH_ENGINE_MAX_BODY", MAX_BODY, int)
    max_plain = _env_num("OPENDISPATCH_ENGINE_MAX_DECOMPRESSED", MAX_DECOMPRESSED, int)
    max_list = _env_num("OPENDISPATCH_ENGINE_MAX_LIST", MAX_LIST, int)
    max_conns = _env_num("OPENDISPATCH_ENGINE_MAX_CONNECTIONS", max(limit * 8, 64), int)
    slots = threading.BoundedSemaphore(limit)
    server = BoundedServer((host, int(port)), make_handler(name, timeout, slots, max_body, max_plain, max_list),
                           max_conns)
    if host not in LOOPBACK:
        print(f"opendispatch-engine {name}: listening on {host}, restrict with a NetworkPolicy",
              flush=True)
    return server


def main():
    name = os.environ.get("OPENDISPATCH_ENGINE", "")
    addr = os.environ.get("OPENDISPATCH_ENGINE_ADDR", "0.0.0.0:8080")
    serve(name, addr).serve_forever()


if __name__ == "__main__":
    main()
