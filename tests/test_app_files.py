"""Checks that need no browser: facts about the app's own files that must stay true."""
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = (ROOT / "app.js").read_text(encoding="utf-8")
HTML = (ROOT / "index.html").read_text(encoding="utf-8")
SW = (ROOT / "sw.js").read_text(encoding="utf-8")

# Elements the app creates itself while running (so they are not in index.html).
CREATED_BY_APP = {"storage-warning", "therapy-summary-title"}


class AppFiles(unittest.TestCase):
    """Static checks on app.js, index.html and sw.js that catch packaging mistakes without a browser."""

    def test_version_label_matches_the_service_worker_cache(self):
        """APP_VERSION (shown in the Menu) must equal the number in CACHE_NAME in sw.js."""
        shown = re.search(r"const APP_VERSION = (\d+);", APP)
        cache = re.search(r"const CACHE_NAME = 'second-memory-v(\d+)';", SW)
        self.assertIsNotNone(shown)
        self.assertIsNotNone(cache)
        self.assertEqual(shown.group(1), cache.group(1))

    def test_no_duplicate_element_ids(self):
        """A repeated id makes getElementById silently pick the first one."""
        ids = re.findall(r'\bid="([^"]+)"', HTML)
        self.assertEqual(sorted(i for i in set(ids) if ids.count(i) > 1), [])

    def test_every_element_the_code_looks_up_exists(self):
        """A getElementById for an id that is not in index.html would crash the app at load."""
        html_ids = set(re.findall(r'\bid="([^"]+)"', HTML))
        used = set(re.findall(r"getElementById\('([^']+)'\)", APP))
        self.assertEqual(sorted(used - html_ids - CREATED_BY_APP), [])

    def test_no_external_scripts_or_styles(self):
        """CLAUDE.md: no CDN script tags, no external dependencies."""
        self.assertEqual(re.findall(r'<script[^>]+src="https?://', HTML), [])
        self.assertEqual(re.findall(r'<link[^>]+href="https?://', HTML), [])

    def test_network_calls_go_only_to_the_sync_server(self):
        """The app has exactly two fetch() calls (the sync itself and the wake-up poke before it), both to the sync server."""
        calls = re.findall(r"fetch\(([^,)]*)", APP)
        self.assertEqual(len(calls), 2)
        for call in calls:
            self.assertIn("SYNC_SERVER_URL", call)

    def test_every_local_file_the_page_loads_is_in_the_offline_cache(self):
        """Both directions: nothing index.html loads is missing from APP_SHELL, and nothing cached is missing on disk."""
        shell = set(re.findall(r"'\./([^']*)'", SW[SW.index("const APP_SHELL"):SW.index("];", SW.index("const APP_SHELL"))]))
        loaded = set(re.findall(r'(?:src|href)="(?!https?:|#|data:|mailto:)([^"]+)"', HTML))
        loaded = {x[2:] if x.startswith("./") else x for x in loaded}  # drop only a leading "./"
        for name in loaded:
            self.assertIn(name, shell, f"{name} is loaded by index.html but not in APP_SHELL")
        for name in shell:
            if name:
                self.assertTrue((ROOT / name).exists(), f"{name} is in APP_SHELL but missing on disk")

    def test_code_the_first_screen_draws_is_defined_before_the_init_section(self):
        """Init draws the saved screen straight away, so each screen's own code must come before it in the file
        (a `let` or `const` below it is not set up yet: this once broke the app when it reopened on Passwords)."""
        init = APP.index("// ---- Init ----")
        for marker in ["// ---- Password vault ----", "// ---- Journal (dreams + therapy sessions) ----"]:
            self.assertLess(APP.index(marker), init, marker + " must come before the Init section")

    def test_lists_that_moved_out_are_still_kept_exported_and_known_to_the_server(self):
        """The to-do, shopping, medication, diagnosis and weight lists left the screens but never the data: the app
        still holds and exports them, and the server must keep their names (a list the server does not name is
        dropped on its next save, which would delete the server's copy)."""
        import json
        synced = set(re.findall(r"\{ name: '(\w+)', label:", APP))
        retired = set(re.findall(r"\{ name: '(\w+)', key: 'secondMemory\.", APP))
        self.assertEqual(retired, {"todos", "shoppingList", "medications", "diagnoses", "weights"})
        self.assertEqual(synced, {"books", "recipes", "notes", "links"})
        server = (ROOT / "sync_server.py").read_text(encoding="utf-8")
        names = set(re.findall(r'"(\w+)"', re.search(r"COLLECTION_NAMES = \[(.*?)\]", server, re.S).group(1)))
        self.assertTrue((synced | retired) <= names, "the server must keep naming every list, moved or not")
        # A real export saved from version 82 only uses lists this version still knows how to read or keep.
        fixture = json.loads((ROOT / "tests" / "fixtures" / "second-memory-export-v82.sample.json").read_text(encoding="utf-8"))
        self.assertEqual(set(fixture["collections"]) - synced - retired, set())


if __name__ == "__main__":
    unittest.main()
