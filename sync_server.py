#!/usr/bin/env python3
"""Second Memory sync server.

Serves a single API endpoint, POST /api/sync, over plain HTTP. Intended to
run on Render (Starter plan + persistent disk); Render terminates TLS at its
edge, so this process never handles certificates itself. The app's static
files (index.html/style.css/app.js) are hosted separately on GitHub Pages —
this server does not serve them. Stdlib only — no pip installs.
"""

import hmac
import json
import os
import sys
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = int(os.environ.get("PORT", "8443"))
DATA_DIR = Path(os.environ.get("DATA_DIR", "/var/data"))
DATA_PATH = DATA_DIR / "sync_data.json"

COLLECTION_NAMES = [
    "books", "recipes", "medications", "diagnoses", "todos",
    "shoppingList", "notes", "links", "courses", "bills",
]

# The app's HTML/JS is now hosted separately from this server (GitHub Pages,
# not this machine), so browsers treat sync requests as cross-origin and
# block them without an explicit CORS allowlist. Only these exact origins
# are ever allowed to call /api/sync from a browser.
ALLOWED_SYNC_ORIGINS = {"https://sagebrushsites.com", "https://michellefeliciano.github.io"}

data_lock = threading.Lock()


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

    def _allowed_origin(self):
        origin = self.headers.get("Origin")
        return origin if origin in ALLOWED_SYNC_ORIGINS else None

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        # CORS headers belong on every response, not just success — the
        # client's JS specifically branches on response.status === 401 to
        # show "check passphrase", and a browser hides that status behind a
        # generic network error if the response lacks these headers.
        origin = self._allowed_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(body)

    def _check_token(self):
        expected = self.server.sync_token
        got = self.headers.get("X-Sync-Token", "")
        return hmac.compare_digest(got, expected)

    def do_OPTIONS(self):
        if self.path != "/api/sync":
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        self.send_response(204)
        origin = self._allowed_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Sync-Token")
        self.send_header("Access-Control-Max-Age", "86400")
        self.send_header("Content-Length", "0")
        self.end_headers()

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
        self._send_json(404, {"error": "not found"})

    def log_message(self, fmt, *args):
        pass


def main():
    token = os.environ.get("SYNC_TOKEN", "").strip()
    if not token:
        print("FATAL: SYNC_TOKEN environment variable is not set. Set it in "
              "the Render dashboard before starting this service.")
        sys.exit(1)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Using data directory: {DATA_DIR}")

    if not DATA_PATH.exists():
        save_dataset(empty_dataset())

    server = ThreadingHTTPServer(("0.0.0.0", PORT), SyncHandler)
    server.sync_token = token
    print(f"Second Memory sync server listening on 0.0.0.0:{PORT} (plain HTTP; "
          f"TLS terminated by Render).")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
