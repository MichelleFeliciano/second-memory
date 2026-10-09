"""Checks that need no browser: facts about the app's own files that must stay true."""
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent


class AppFiles(unittest.TestCase):
    def test_version_label_matches_the_service_worker_cache(self):
        """APP_VERSION (shown in the Menu) must equal the number in CACHE_NAME in sw.js."""
        app = (ROOT / "app.js").read_text(encoding="utf-8")
        sw = (ROOT / "sw.js").read_text(encoding="utf-8")
        shown = re.search(r"const APP_VERSION = (\d+);", app)
        cache = re.search(r"const CACHE_NAME = 'second-memory-v(\d+)';", sw)
        self.assertIsNotNone(shown)
        self.assertIsNotNone(cache)
        self.assertEqual(shown.group(1), cache.group(1))


if __name__ == "__main__":
    unittest.main()
