#!/usr/bin/env python3
"""Second Memory local sync server.

Serves the app's static files (index.html/style.css/app.js) exactly like
`python -m http.server`, plus one API endpoint: POST /api/sync. Runs over
HTTPS on a self-signed certificate, gated by a shared passphrase. Stdlib
only — no pip installs.
"""

import hmac
import json
import os
import secrets
import shutil
import socket
import ssl
import subprocess
import sys
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CERT_PATH = ROOT / "cert.pem"
KEY_PATH = ROOT / "key.pem"
SECRET_PATH = ROOT / ".sync_secret"
DATA_PATH = ROOT / "sync_data.json"
PORT = 8443

COLLECTION_NAMES = [
    "books", "recipes", "medications", "diagnoses", "todos",
    "shoppingList", "notes", "links", "courses",
]

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
}

# Explicit allowlist, not just a path-traversal check: the app root also
# holds .sync_secret, cert.pem, key.pem, sync_data.json, and this script's
# own source — a traversal guard alone still serves all of those to any
# unauthenticated request. Only these exact files are ever servable.
ALLOWED_STATIC_FILES = {"index.html", "style.css", "app.js"}

data_lock = threading.Lock()


def get_lan_ip():
    """Finds this machine's outbound-facing LAN IPv4 without any real
    network traffic: connecting a UDP socket never sends a packet, it just
    asks the OS routing table which local address it would use."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def find_openssl():
    candidates = [
        r"C:\Program Files\Git\usr\bin\openssl.exe",
        r"C:\Program Files\Git\mingw64\bin\openssl.exe",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return candidate
    return shutil.which("openssl")


def cert_covers_ip(openssl, cert_path, ip):
    try:
        out = subprocess.run(
            [openssl, "x509", "-in", str(cert_path), "-noout", "-text"],
            capture_output=True, text=True, check=True,
        ).stdout
    except (subprocess.CalledProcessError, OSError):
        return False
    return f"IP Address:{ip}" in out


def ensure_cert(ip):
    openssl = find_openssl()
    have_existing = CERT_PATH.exists() and KEY_PATH.exists()

    if have_existing and openssl and cert_covers_ip(openssl, CERT_PATH, ip):
        return

    if have_existing and not openssl:
        # Can't verify SAN coverage without openssl, but a cert already on
        # disk from a prior run is far more likely to work than refusing to
        # start — only require openssl when actually regenerating below.
        return

    if not openssl:
        print(
            "ERROR: could not find the openssl binary needed to generate a "
            "self-signed TLS certificate.\n"
            "Git for Windows (already installed in this project) ships one — checked:\n"
            r"  C:\Program Files\Git\usr\bin\openssl.exe" "\n"
            r"  C:\Program Files\Git\mingw64\bin\openssl.exe" "\n"
            "and the system PATH, none found. Install/repair Git for Windows, or put\n"
            "openssl on PATH, then re-run this server."
        )
        sys.exit(1)

    print(f"Generating a self-signed TLS certificate for {ip} ...")
    san = f"IP:{ip},IP:127.0.0.1,DNS:localhost"
    subprocess.run(
        [
            openssl, "req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-days", "825",
            "-keyout", str(KEY_PATH),
            "-out", str(CERT_PATH),
            "-subj", "/CN=second-memory-local",
            "-addext", f"subjectAltName={san}",
        ],
        check=True,
    )
    print(f"Certificate written to {CERT_PATH} and {KEY_PATH}.")


def ensure_secret():
    if SECRET_PATH.exists():
        return SECRET_PATH.read_text(encoding="utf-8").strip()
    token = secrets.token_urlsafe(24)
    SECRET_PATH.write_text(token, encoding="utf-8")
    print("=" * 64)
    print("Generated a new sync passphrase:")
    print(f"  {token}")
    print("Enter this passphrase in the app on each device you want to sync.")
    print("Saved locally to .sync_secret — never commit this file.")
    print("=" * 64)
    return token


def empty_dataset():
    return {name: [] for name in COLLECTION_NAMES}


def load_dataset():
    if not DATA_PATH.exists():
        return empty_dataset()
    try:
        with DATA_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return empty_dataset()
    if not isinstance(data, dict):
        return empty_dataset()
    for name in COLLECTION_NAMES:
        if not isinstance(data.get(name), list):
            data[name] = []
    return data


def save_dataset(data):
    # The threading.Lock around every caller of this function is the real
    # correctness mechanism; os.replace() is defense in depth on top of it
    # (its atomicity isn't fully guaranteed on Windows, per CPython #143909).
    tmp_path = DATA_PATH.with_suffix(".tmp")
    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(tmp_path, DATA_PATH)


def _content_matches(a, b):
    """True if two records are identical in every field except `version` —
    i.e. this is a retried resend of an already-applied edit, not a genuine
    conflicting change."""
    keys = set(a.keys()) | set(b.keys())
    keys.discard("version")
    return all(a.get(k) == b.get(k) for k in keys)


def merge_collection(server_items, client_items):
    """Applies one collection's client-submitted records onto the server's
    stored records, per the server-owned-version optimistic-concurrency
    algorithm. Mutates `server_items` and returns the list of genuine
    conflicts created (each `{"originalId": ..., "newId": ...}`). Never
    removes a record — tombstones (`deleted: true`) are merged like any
    other record so a delete round-trips to every other device instead of
    being lost."""
    by_id = {item["id"]: item for item in server_items if "id" in item}
    conflicts = []

    for incoming in client_items:
        record_id = incoming.get("id")
        if not record_id:
            continue
        client_version = incoming.get("version", 0)
        existing = by_id.get(record_id)

        if existing is None:
            new_record = dict(incoming)
            new_record["version"] = 1
            server_items.append(new_record)
            by_id[record_id] = new_record
            continue

        server_version = existing.get("version", 0)

        if client_version < server_version:
            # A dropped response can make a client retry a payload the server
            # already applied — its version bookkeeping never advanced, so
            # this looks like a conflict even though nothing actually
            # diverged. If the content is identical to what's already stored
            # (ignoring version), treat it as a no-op replay instead of
            # manufacturing a duplicate.
            if _content_matches(existing, incoming):
                continue

            # Genuine conflict: someone else's write already landed on this
            # id since this client last synced. Keep the server's record
            # untouched and save the client's content as a brand-new record
            # instead — never silently discard either side.
            conflict_record = dict(incoming)
            conflict_record["id"] = str(uuid.uuid4())
            conflict_record["version"] = 1
            server_items.append(conflict_record)
            by_id[conflict_record["id"]] = conflict_record
            conflicts.append({"originalId": record_id, "newId": conflict_record["id"]})
            continue

        # client_version == server_version is the expected clean-update case.
        # client_version > server_version shouldn't happen under normal
        # operation (the server is the sole version authority) but is
        # accepted the same defensive way — e.g. if the datastore file was
        # ever reset — so a client is never left permanently stuck.
        new_record = dict(incoming)
        new_record["version"] = max(server_version, client_version) + 1
        by_id[record_id] = new_record
        for i, item in enumerate(server_items):
            if item.get("id") == record_id:
                server_items[i] = new_record
                break

    return conflicts


class SyncHandler(BaseHTTPRequestHandler):
    server_version = "SecondMemorySync/1"

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _check_token(self):
        expected = self.server.sync_token
        got = self.headers.get("X-Sync-Token", "")
        return hmac.compare_digest(got, expected)

    def do_POST(self):
        if self.path != "/api/sync":
            self._send_json(404, {"error": "not found"})
            return
        if not self._check_token():
            self._send_json(401, {"error": "invalid or missing X-Sync-Token"})
            return

        length = int(self.headers.get("Content-Length", 0) or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._send_json(400, {"error": "invalid JSON"})
            return

        client_collections = body.get("collections")
        if not isinstance(client_collections, dict):
            self._send_json(400, {"error": "invalid payload: 'collections' must be an object"})
            return

        with data_lock:
            dataset = load_dataset()
            all_conflicts = []
            for name in COLLECTION_NAMES:
                incoming = client_collections.get(name)
                if isinstance(incoming, list):
                    for conflict in merge_collection(dataset[name], incoming):
                        all_conflicts.append({"collection": name, **conflict})
            save_dataset(dataset)
            response_collections = {name: dataset[name] for name in COLLECTION_NAMES}

        self._send_json(200, {"collections": response_collections, "conflicts": all_conflicts})

    def do_GET(self):
        if self.path.startswith("/api/"):
            self._send_json(404, {"error": "not found"})
            return
        self._serve_static()

    def _serve_static(self):
        req_path = self.path.split("?", 1)[0]
        if req_path == "/":
            req_path = "/index.html"
        name = req_path.lstrip("/")

        if name not in ALLOWED_STATIC_FILES:
            self.send_error(404)
            return

        file_path = (ROOT / name).resolve()
        if ROOT not in file_path.parents or not file_path.is_file():
            self.send_error(404)
            return

        content_type = CONTENT_TYPES.get(file_path.suffix, "application/octet-stream")
        body = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass


def main():
    ip = get_lan_ip()
    ensure_cert(ip)
    token = ensure_secret()

    if not DATA_PATH.exists():
        save_dataset(empty_dataset())

    server = ThreadingHTTPServer(("0.0.0.0", PORT), SyncHandler)
    server.sync_token = token

    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certfile=str(CERT_PATH), keyfile=str(KEY_PATH))
    server.socket = context.wrap_socket(server.socket, server_side=True)

    print(f"Second Memory sync server running at https://{ip}:{PORT}")
    print(f"(also reachable at https://127.0.0.1:{PORT} on this machine)")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
