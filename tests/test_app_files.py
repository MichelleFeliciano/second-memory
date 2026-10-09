"""Checks that need no browser: facts about the app's own files that must stay true."""
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = (ROOT / "app.js").read_text(encoding="utf-8")
HTML = (ROOT / "index.html").read_text(encoding="utf-8")
SW = (ROOT / "sw.js").read_text(encoding="utf-8")

# Elements the app creates itself while running (so they are not in index.html).
CREATED_BY_APP = {"storage-warning", "therapy-summary-title", "health-summary-title"}


class AppFiles(unittest.TestCase):
    def test_version_label_matches_the_service_worker_cache(self):
        """APP_VERSION (shown in the Menu) must equal the number in CACHE_NAME in sw.js."""
        shown = re.search(r"const APP_VERSION = (\d+);", APP)
        cache = re.search(r"const CACHE_NAME = 'second-memory-v(\d+)';", SW)
        self.assertIsNotNone(shown)
        self.assertIsNotNone(cache)
        self.assertEqual(shown.group(1), cache.group(1))

    def test_no_duplicate_element_ids(self):
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

    def test_the_only_network_call_is_the_sync_server(self):
        """The app has exactly one fetch(), and it goes to the sync server."""
        calls = re.findall(r"fetch\(([^,)]*)", APP)
        self.assertEqual(len(calls), 1)
        self.assertIn("SYNC_SERVER_URL", calls[0])

    def test_every_local_file_the_page_loads_is_in_the_offline_cache(self):
        shell = set(re.findall(r"'\./([^']*)'", SW[SW.index("const APP_SHELL"):SW.index("];", SW.index("const APP_SHELL"))]))
        loaded = set(re.findall(r'(?:src|href)="(?!https?:|#|data:|mailto:)([^"]+)"', HTML))
        loaded = {x.lstrip("./") for x in loaded}
        for name in loaded:
            self.assertIn(name, shell, f"{name} is loaded by index.html but not in APP_SHELL")
        for name in shell:
            if name:
                self.assertTrue((ROOT / name).exists(), f"{name} is in APP_SHELL but missing on disk")


if __name__ == "__main__":
    unittest.main()
