"""Tests for the sync server (stdlib only). Run from the project folder:

    python -m unittest discover -s tests

They use a throw-away data folder and a local port, never the real server or data.
"""
import json
import os
import pathlib
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

_DATA_DIR = tempfile.mkdtemp(prefix="second-memory-test-")
os.environ["DATA_DIR"] = _DATA_DIR
os.environ["SYNC_TOKEN"] = "unused-by-tests"
os.environ["PORT"] = "0"

import sync_server as s  # noqa: E402


def rec(record_id, version=1, deleted=False, **extra):
    base = {"id": record_id, "name": "item", "version": version, "deleted": deleted,
            "updatedAt": "2026-10-07T10:00:00Z", "deviceId": "A", "dateAdded": "2026-10-01T00:00:00Z"}
    base.update(extra)
    return base


class MergeRules(unittest.TestCase):
    def merge(self, server_items, client_items, name="shoppingList"):
        conflicts = s.merge_collection(server_items, client_items, name)
        return server_items, conflicts

    def test_new_record_is_added_at_version_1(self):
        items, c = self.merge([], [rec("a", version=0)])
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["version"], 1)
        self.assertEqual(c, [])

    def test_clean_edit_bumps_the_version(self):
        items, c = self.merge([rec("a", 3, name="old")], [rec("a", 3, name="new")])
        self.assertEqual((items[0]["name"], items[0]["version"]), ("new", 4))
        self.assertEqual(c, [])

    def test_resending_identical_content_changes_nothing(self):
        items, c = self.merge([rec("a", 6)], [rec("a", 5)])
        self.assertEqual((len(items), items[0]["version"]), (1, 6))
        self.assertEqual(c, [])

    def test_bookkeeping_changes_alone_are_not_an_edit(self):
        items, _ = self.merge([rec("a", 2)], [rec("a", 2, updatedAt="2030-01-01T00:00:00Z", deviceId="B")])
        self.assertEqual(items[0]["version"], 2)

    def test_stale_live_copy_never_overwrites_a_delete(self):
        items, c = self.merge([rec("a", 6, deleted=True)], [rec("a", 5)])
        self.assertTrue(items[0]["deleted"])
        self.assertEqual((len(items), c), (1, []))

    def test_stale_edited_copy_of_a_deleted_record_is_dropped(self):
        items, c = self.merge([rec("a", 6, deleted=True)], [rec("a", 5, name="edited after delete")])
        self.assertTrue(items[0]["deleted"])
        self.assertEqual((len(items), c), (1, []))

    def test_a_delete_from_a_stale_device_wins_over_a_newer_edit(self):
        items, c = self.merge([rec("a", 6, name="edited elsewhere")], [rec("a", 5, deleted=True, updatedAt="2026-10-08T00:00:00Z")])
        self.assertEqual((len(items), items[0]["deleted"], items[0]["version"], items[0]["name"]), (1, True, 7, "edited elsewhere"))
        self.assertEqual(c, [])

    def test_a_real_edit_conflict_is_kept_as_a_second_record(self):
        items, c = self.merge([rec("a", 6, name="A")], [rec("a", 5, name="B")])
        self.assertEqual(len(items), 2)
        self.assertEqual(len(c), 1)
        self.assertEqual(c[0]["originalId"], "a")

    def test_restoring_a_deleted_record_at_the_current_version_works(self):
        items, _ = self.merge([rec("a", 6, deleted=True)], [rec("a", 6, deleted=False)])
        self.assertEqual((items[0]["deleted"], items[0]["version"]), (False, 7))

    def test_clean_delete(self):
        items, _ = self.merge([rec("a", 5)], [rec("a", 5, deleted=True)])
        self.assertEqual((items[0]["deleted"], items[0]["version"]), (True, 6))

    def test_income_ignores_dateAdded_differences(self):
        items, c = self.merge([rec("2026-09-22", 4, dateAdded="x", amount=100)], [rec("2026-09-22", 4, dateAdded="y", amount=100)], "income")
        self.assertEqual((len(items), items[0]["version"], c), (1, 4, []))

    def test_malformed_records_do_not_abort_the_sync(self):
        items, _ = self.merge([], [None, 5, "x", {"no": "id"}, {"id": ["list"]}, {"id": ""}, rec("ok", 0), rec("bad-version", version="abc")])
        self.assertEqual(sorted(i["id"] for i in items), ["bad-version", "ok"])

    def test_tombstone_against_tombstone_never_forks(self):
        items, c = self.merge([rec("a", 6, deleted=True, name="x")], [rec("a", 5, deleted=True, name="y")])
        self.assertEqual((len(items), c), (1, []))


class Storage(unittest.TestCase):
    def setUp(self):
        self.dir = pathlib.Path(tempfile.mkdtemp(prefix="sm-store-"))
        s.DATA_DIR = self.dir
        s.DATA_PATH = self.dir / "sync_data.json"
        s.BACKUP_DIR = self.dir / "backups"

    def test_missing_file_gives_an_empty_dataset(self):
        data = s.load_dataset()
        self.assertEqual(sorted(data), sorted(s.COLLECTION_NAMES))
        self.assertTrue(all(v == [] for v in data.values()))

    def test_lists_the_app_no_longer_has_are_dropped(self):
        s.DATA_PATH.write_text(json.dumps({"books": [{"id": "b"}], "courses": [{"id": "c"}], "deadlines": [{"id": "d"}]}))
        data = s.load_dataset()
        self.assertNotIn("courses", data)
        self.assertNotIn("deadlines", data)
        self.assertEqual(len(data["books"]), 1)
        s.save_dataset(data)
        saved = json.loads(s.DATA_PATH.read_text())
        self.assertNotIn("courses", saved)

    def test_first_save_makes_no_backup_but_later_saves_do(self):
        d = s.empty_dataset()
        d["notes"].append(rec("n1", t="v1"))
        s.save_dataset(d)
        self.assertFalse(s.BACKUP_DIR.exists() and any(s.BACKUP_DIR.iterdir()))
        d["notes"][0]["t"] = "v2"
        s.save_dataset(d)
        today = time.strftime("%Y-%m-%d", time.gmtime())
        snap = s.BACKUP_DIR / f"sync_data-{today}.json"
        self.assertTrue(snap.exists())
        self.assertEqual(json.loads(snap.read_text())["notes"][0]["t"], "v1")
        d["notes"][0]["t"] = "v3"
        s.save_dataset(d)
        self.assertEqual(json.loads(snap.read_text())["notes"][0]["t"], "v1", "today's restore point must not be overwritten")
        self.assertTrue((self.dir / "sync_data.bak").exists())

    def test_only_the_newest_30_restore_points_are_kept(self):
        d = s.empty_dataset()
        s.save_dataset(d)
        s.BACKUP_DIR.mkdir(exist_ok=True)
        import datetime
        for i in range(40):
            (s.BACKUP_DIR / f"sync_data-{(datetime.date(2026, 1, 1) + datetime.timedelta(i)).isoformat()}.json").write_text("{}")
        (s.BACKUP_DIR / "notes.txt").write_text("keep me")
        s.save_dataset(d)
        names = [f.name for f in s.BACKUP_DIR.iterdir() if s.BACKUP_NAME_RE.match(f.name)]
        self.assertEqual(len(names), s.BACKUP_KEEP)
        self.assertTrue((s.BACKUP_DIR / "notes.txt").exists())

    def test_a_corrupt_file_is_set_aside_and_the_backup_is_used(self):
        d = s.empty_dataset()
        d["notes"].append(rec("n1"))
        s.save_dataset(d)
        d["notes"].append(rec("n2"))
        s.save_dataset(d)
        s.DATA_PATH.write_text("{corrupt")
        data = s.load_dataset()
        self.assertEqual(len(data["notes"]), 1)
        self.assertTrue(any(p.name.startswith("sync_data.corrupt-") for p in self.dir.iterdir()))

    def test_a_read_error_is_not_treated_as_no_data(self):
        s.DATA_PATH.write_text(json.dumps(s.empty_dataset()))
        original = pathlib.Path.open

        def broken(self, *a, **k):
            if self.name == "sync_data.json":
                raise PermissionError("cannot read")
            return original(self, *a, **k)

        pathlib.Path.open = broken
        try:
            with self.assertRaises(PermissionError):
                s.load_dataset()
        finally:
            pathlib.Path.open = original


class Http(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = pathlib.Path(tempfile.mkdtemp(prefix="sm-http-"))
        s.DATA_DIR = cls.dir
        s.DATA_PATH = cls.dir / "sync_data.json"
        s.BACKUP_DIR = cls.dir / "backups"
        cls.server = s.ThreadingHTTPServer(("127.0.0.1", 0), s.SyncHandler)
        cls.server.sync_token = "test-secret"
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        time.sleep(0.2)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def call(self, body, token="test-secret", path="/api/sync", raw=None, origin=None):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else b"")
        headers = {"Content-Type": "application/json", "X-Sync-Token": token}
        if origin:
            headers["Origin"] = origin
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", data=data, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status, json.load(r), dict(r.headers)
        except urllib.error.HTTPError as e:
            try:
                payload = json.load(e)
            except Exception:
                payload = None
            return e.code, payload, dict(e.headers)

    def test_wrong_or_missing_passphrase_is_refused(self):
        self.assertEqual(self.call({"clientVersion": 2, "collections": {}}, token="nope")[0], 401)
        self.assertEqual(self.call({"clientVersion": 2, "collections": {}}, token="")[0], 401)

    def test_old_app_copies_are_turned_away(self):
        status, body, _ = self.call({"collections": {}})
        self.assertEqual(status, 426)
        self.assertIn("out of date", body["error"])
        self.assertEqual(self.call({"clientVersion": 1, "collections": {}})[0], 426)

    def test_bad_requests_get_a_clear_error(self):
        self.assertEqual(self.call(None, raw=b"[1, 2]")[0], 400)
        self.assertEqual(self.call(None, raw=b"{nope")[0], 400)
        self.assertEqual(self.call(None, raw=b"\xff\xfe")[0], 400)
        self.assertEqual(self.call({"clientVersion": 2, "collections": "not a dict"})[0], 400)
        self.assertEqual(self.call({}, path="/nope")[0], 404)

    def test_a_round_trip_stores_and_returns_records(self):
        status, body, _ = self.call({"clientVersion": 2, "collections": {"notes": [rec("rt1", 0, name="hello")]}})
        self.assertEqual(status, 200)
        self.assertEqual([r["id"] for r in body["collections"]["notes"]], ["rt1"])
        self.assertEqual(body["conflicts"], [])
        self.assertEqual(sorted(body["collections"]), sorted(s.COLLECTION_NAMES))

    def test_unknown_lists_are_ignored(self):
        status, body, _ = self.call({"clientVersion": 2, "collections": {"courses": [rec("x")], "notes": []}})
        self.assertEqual(status, 200)
        self.assertNotIn("courses", body["collections"])

    def test_non_ascii_passphrases_work_when_percent_encoded(self):
        self.server.sync_token = "pässwörd ✓"
        try:
            ok = self.call({"clientVersion": 2, "collections": {}}, token="u:" + urllib.parse.quote("pässwörd ✓"))[0]
            bad = self.call({"clientVersion": 2, "collections": {}}, token="u:" + urllib.parse.quote("nope"))[0]
            self.assertEqual((ok, bad), (200, 401))
        finally:
            self.server.sync_token = "test-secret"

    def test_a_passphrase_that_itself_starts_with_u_colon_works(self):
        self.server.sync_token = "u:literal"
        try:
            self.assertEqual(self.call({"clientVersion": 2, "collections": {}}, token="u:literal")[0], 200)
        finally:
            self.server.sync_token = "test-secret"

    def test_only_the_apps_own_sites_get_cors_headers(self):
        _, _, ok = self.call({"clientVersion": 2, "collections": {}}, origin="https://michellefeliciano.github.io")
        _, _, other = self.call({"clientVersion": 2, "collections": {}}, origin="https://evil.example")
        self.assertEqual(ok.get("Access-Control-Allow-Origin"), "https://michellefeliciano.github.io")
        self.assertIsNone(other.get("Access-Control-Allow-Origin"))

    def test_backup_endpoint_lists_and_returns_restore_points(self):
        self.call({"clientVersion": 2, "collections": {"notes": [rec("bk1", 0)]}})
        self.call({"clientVersion": 2, "collections": {"notes": [rec("bk2", 0)]}})
        status, body, _ = self.call({}, path="/api/backup")
        self.assertEqual(status, 200)
        today = time.strftime("%Y-%m-%d", time.gmtime())
        self.assertTrue(any(b["date"] == today for b in body["backups"]))
        status, body, _ = self.call({"date": today}, path="/api/backup")
        self.assertEqual(status, 200)
        self.assertEqual(sorted(body["collections"]), sorted(s.COLLECTION_NAMES))

    def test_backup_endpoint_is_protected_and_safe(self):
        self.assertEqual(self.call({}, token="nope", path="/api/backup")[0], 401)
        self.assertEqual(self.call({"date": "2020-01-01"}, path="/api/backup")[0], 404)
        self.assertEqual(self.call({"date": "../sync_data"}, path="/api/backup")[0], 400)
        self.assertEqual(self.call({"date": "2026-01-01/../../x"}, path="/api/backup")[0], 400)


if __name__ == "__main__":
    unittest.main()
