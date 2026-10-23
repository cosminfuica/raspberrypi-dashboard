"""Frontend code that mirrors a backend rule, pinned to it. Same idea as test_system.Sudoers: two copies, one test."""

import re
import unittest
from pathlib import Path

from pidash.system import SERVICE_NAME

MAIN_JS = Path(__file__).resolve().parents[2] / "frontend" / "src" / "main.js"


class RestartRule(unittest.TestCase):
    def test_the_page_offers_restart_for_exactly_the_names_the_app_accepts(self):
        """main.js RESTARTABLE decides which service rows get a Restart button; system.SERVICE_NAME decides what the
        app and sudoers accept. A drift shows a button that 4xx's, or hides one that would work."""
        rule = re.search(r"^const RESTARTABLE = /(.+)/$", MAIN_JS.read_text(), re.M)
        self.assertIsNotNone(rule, "no `const RESTARTABLE = /.../` in frontend/src/main.js")
        self.assertEqual(rule[1], "^" + SERVICE_NAME.pattern + "$")


if __name__ == "__main__":
    unittest.main()
