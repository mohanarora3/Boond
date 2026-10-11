"""Run the Lambda handlers locally without AWS: `python local_server.py` → http://localhost:3001

Uses a JSON file store (.local/db.json). For the real stack use `sam local start-api` or deploy.
"""
from __future__ import annotations

import json
import mimetypes
import os
import re
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable
from urllib.parse import parse_qsl, urlparse

os.environ.setdefault("BOOND_LOCAL_DB", os.path.join(os.path.dirname(__file__), ".local", "db.json"))

from src.common import s3  # noqa: E402
from src.agent.handler import lambda_handler as agent_handler  # noqa: E402
from src.application.pdf import lambda_handler as application_handler  # noqa: E402
from src.maintenance.handler import lambda_handler as maintenance_handler  # noqa: E402
from src.dashboard.handler import lambda_handler as dashboard_handler  # noqa: E402
from src.rules.handler import lambda_handler as rules_handler  # noqa: E402
from src.wards.handler import lambda_handler as wards_handler  # noqa: E402
from src.geocode.handler import lambda_handler as geocode_handler  # noqa: E402
from src.plans.handler import lambda_handler as plans_handler  # noqa: E402
from src.review.handler import lambda_handler as review_handler  # noqa: E402

Handler = Callable[[dict[str, Any], Any], dict[str, Any]]

# (method, path regex, handler) — mirrors template.yaml
ROUTES: list[tuple[str, str, Handler]] = [
    ("POST", r"^/plans$", plans_handler),
    ("GET", r"^/plans/(?P<id>[^/]+)$", plans_handler),
    ("PATCH", r"^/plans/(?P<id>[^/]+)$", plans_handler),
    ("GET", r"^/geocode$", geocode_handler),
    ("GET", r"^/dashboard$", dashboard_handler),
    ("GET", r"^/dashboard/attention$", dashboard_handler),
    ("GET", r"^/dashboard/gap$", dashboard_handler),
    ("GET", r"^/rules$", rules_handler),
    ("GET", r"^/wards$", wards_handler),
    ("GET", r"^/wards/(?P<ward>[^/]+)$", wards_handler),
    ("GET", r"^/wards/(?P<ward>[^/]+)/simulate$", wards_handler),
    ("POST", r"^/plans/(?P<id>[^/]+)/application$", application_handler),
    ("POST", r"^/plans/(?P<id>[^/]+)/certificate$", application_handler),
    ("GET", r"^/verify/(?P<id>[^/]+)$", plans_handler),
    ("GET", r"^/plans/(?P<id>[^/]+)/impact$", plans_handler),
    ("GET", r"^/officer/applications$", review_handler),
    ("GET", r"^/plans/(?P<id>[^/]+)/nearby-water$", review_handler),
    ("POST", r"^/plans/(?P<id>[^/]+)/review$", review_handler),
    ("POST", r"^/plans/(?P<id>[^/]+)/chat$", agent_handler),
    ("GET", r"^/plans/(?P<id>[^/]+)/chat$", agent_handler),
    ("POST", r"^/plans/(?P<id>[^/]+)/photos/upload-url$", maintenance_handler),
    ("POST", r"^/plans/(?P<id>[^/]+)/installation$", maintenance_handler),
    ("POST", r"^/plans/(?P<id>[^/]+)/checks$", maintenance_handler),
    ("GET", r"^/plans/(?P<id>[^/]+)/checks$", maintenance_handler),
]


class LocalApi(BaseHTTPRequestHandler):
    def _dispatch(self) -> None:
        url = urlparse(self.path)
        if self.command == "OPTIONS":
            return self._send(204, {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type",
                                    "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,OPTIONS"}, b"")
        if url.path.startswith("/_files/"):
            return self._files(url.path[len("/_files/"):])
        for verb, pattern, handler in ROUTES:
            match = re.match(pattern, url.path)
            if verb == self.command and match:
                length = int(self.headers.get("Content-Length") or 0)
                event = {
                    "version": "2.0",
                    "rawPath": url.path,
                    "requestContext": {"http": {"method": verb, "path": url.path}},
                    "pathParameters": match.groupdict() or None,
                    "queryStringParameters": dict(parse_qsl(url.query)) or None,
                    "body": self.rfile.read(length).decode("utf-8") if length else None,
                    "isBase64Encoded": False,
                }
                res = handler(event, None)
                return self._send(res["statusCode"], res.get("headers", {}), res.get("body", "").encode("utf-8"))
        self._send(404, {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
                   json.dumps({"ok": False, "error": "Not found"}).encode())

    def _files(self, key: str) -> None:
        """Stand-in for S3 presigned URLs."""
        root = Path(os.environ["BOOND_LOCAL_DB"]).parent
        path = s3.local_path(key).resolve()  # type: ignore[union-attr]
        if root.resolve() not in path.parents:
            return self._send(400, {}, b"bad key")
        cors = {"Access-Control-Allow-Origin": "*"}
        if self.command == "PUT":
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(self.rfile.read(int(self.headers.get("Content-Length") or 0)))
            return self._send(200, cors, b"")
        if not path.is_file():
            return self._send(404, cors, b"not found")
        if path.name.endswith(".geojson.gz"):  # stored gzipped, like S3 with Content-Encoding: gzip
            return self._send(200, {**cors, "Content-Type": "application/geo+json", "Content-Encoding": "gzip"}, path.read_bytes())
        kind = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        return self._send(200, {**cors, "Content-Type": kind}, path.read_bytes())

    def _send(self, status: int, headers: dict[str, str], body: bytes) -> None:
        self.send_response(status)
        for k, v in headers.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    do_GET = do_POST = do_PATCH = do_PUT = do_OPTIONS = _dispatch


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "3001"))
    print(f"Boond local API on http://localhost:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), LocalApi).serve_forever()
