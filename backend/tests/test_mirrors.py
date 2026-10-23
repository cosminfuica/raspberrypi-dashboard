"""Frontend code that mirrors a backend rule, pinned to it. Same idea as test_system.Sudoers: two copies, one test."""

import re
import unittest
from pathlib import Path

from pidash.system import SERVICE_NAME

SRC = Path(__file__).resolve().parents[2] / "frontend" / "src"


class RestartRule(unittest.TestCase):
    def test_the_page_offers_restart_for_exactly_the_names_the_app_accepts(self):
        """The page's Services code holds RESTARTABLE, which decides which service rows get a Restart button;
        system.SERVICE_NAME decides what the app and sudoers accept. A drift shows a button that 4xx's, or hides one that would work."""
        hits = [m for f in sorted(SRC.rglob("*.js")) for m in re.finditer(r"^const RESTARTABLE = /(.+)/$", f.read_text(), re.M)]
        self.assertEqual(len(hits), 1, "want exactly one `const RESTARTABLE = /.../` line under frontend/src")
        self.assertEqual(hits[0][1], "^" + SERVICE_NAME.pattern + "$")


if __name__ == "__main__":
    unittest.main()
