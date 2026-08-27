from __future__ import annotations

import hashlib
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import yaml
from psycopg.conninfo import make_conninfo

from services.pipeline.seek_saved import persist_saved_seek_jobs, rank_saved_seek_jobs

PROFILE_PATH = ROOT / "resume" / "facts" / "profile.yaml"


def _profile() -> dict[str, Any]:
    return yaml.safe_load(PROFILE_PATH.read_text(encoding="utf-8"))


def _profile_version() -> str:
    digest = hashlib.sha256(PROFILE_PATH.read_bytes()).hexdigest()[:12]
    return f"sha256:{digest}"


def _database_url() -> str:
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if database_url:
        return database_url

    host = os.environ.get("DB_HOST", "").strip()
    user = os.environ.get("DB_USER", "").strip()
    password = os.environ.get("DB_PASSWORD", "")
    port = os.environ.get("DB_PORT", "5432").strip() or "5432"
    dbname = os.environ.get("DB_NAME", "postgres").strip() or "postgres"
    if not host or not user or not password:
        raise RuntimeError(
            "Set DATABASE_URL or DB_HOST/DB_USER/DB_PASSWORD before starting the receiver"
        )
    return make_conninfo(
        host=host,
        port=int(port),
        dbname=dbname,
        user=user,
        password=password,
        sslmode="require",
    )


def _allowed_origin(origin: str | None) -> str | None:
    if not origin:
        return None
    parsed = urlparse(origin)
    host = (parsed.hostname or "").lower()
    if parsed.scheme == "https" and (host == "seek.co.nz" or host.endswith(".seek.co.nz")):
        return origin
    return None


class Handler(BaseHTTPRequestHandler):
    server_version = "JobPilotSeekSaved/0.1"

    def _cors(self) -> None:
        origin = _allowed_origin(self.headers.get("Origin"))
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        if not _allowed_origin(self.headers.get("Origin")):
            self._json(403, {"error": "origin_not_allowed"})
            return
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/seek-saved/sync":
            self._json(404, {"error": "not_found"})
            return
        if not _allowed_origin(self.headers.get("Origin")):
            self._json(403, {"error": "origin_not_allowed"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
            urls = payload.get("urls")
            if not isinstance(urls, list) or not all(isinstance(url, str) for url in urls):
                raise ValueError("Body must contain a string array named 'urls'")
            if not urls:
                raise ValueError("No SEEK job URLs were found on this page")

            batch = rank_saved_seek_jobs(urls=urls, profile=_profile())
            result = persist_saved_seek_jobs(
                database_url=_database_url(),
                batch=batch,
                profile_version=_profile_version(),
            )
            self._json(200, result)
        except ValueError as exc:
            self._json(400, {"error": str(exc)})
        except Exception as exc:
            self._json(500, {"error": type(exc).__name__, "message": str(exc)[:300]})

    def log_message(self, format: str, *args: object) -> None:
        print(f"[seek-saved] {format % args}")


def main() -> None:
    host = os.environ.get("JOBPILOT_SEEK_SYNC_HOST", "127.0.0.1")
    port = int(os.environ.get("JOBPILOT_SEEK_SYNC_PORT", "8765"))
    print(f"JobPilot SEEK Saved receiver: http://{host}:{port}/seek-saved/sync")
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
