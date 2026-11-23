"""The DEV BUILD badge: on when running from the repo, off in the compiled release app."""
import os
import sys
import types
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["VIDA_DRY_RUN"] = "1"   # before backend imports: never touch a real phone

from backend.server import create_app
from backend.session import Session


def status():
    app = create_app(Session())
    return next(r.endpoint for r in app.routes if getattr(r, "path", "") == "/api/status")()


class DevBadge(unittest.TestCase):
    def test_on_from_the_repo(self):
        self.assertIs(status()["dev_build"], True)

    def test_hidden_by_env_on_the_dev_app(self):
        os.environ["VIDA_HIDE_DEV_BADGE"] = "1"
        self.addCleanup(os.environ.pop, "VIDA_HIDE_DEV_BADGE", None)
        self.assertIs(status()["dev_build"], False)

    def test_off_in_the_release_app(self):
        sys.modules["waypoint_build"] = types.ModuleType("waypoint_build")
        self.addCleanup(sys.modules.pop, "waypoint_build")
        self.assertIs(status()["dev_build"], False)


if __name__ == "__main__":
    unittest.main()
