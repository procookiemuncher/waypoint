"""Entry point for the packaged Waypoint.app (build.command compiles this with Nuitka). The dev app
(make-app.command) doesn't use it: that one runs mac-version/app.py straight from the repo.

Three jobs app.py doesn't need in the repo:
- the bundle is read-only, so generated GPX / snap cache go to ~/Library/Application Support/Waypoint
- there's no python next to us: the backend runs pmd3 as `sys.executable -m pymobiledevice3 ...`
  (and dry runs as `sys.executable -c ...`), and sys.executable is now this binary, so handle those here
- testers shouldn't be able to flip on the dev switches, unless this is a test build
"""
import os
import shutil
import sys

import waypoint_build   # written by build.command: VERSION, TEST

HOME = os.path.expanduser("~")
SUPPORT = os.path.join(HOME, "Library", "Application Support", "Waypoint")
LOG = os.path.join(HOME, "Library", "Logs", "Waypoint.log")
BUNDLED_CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "snap-cache")


def child():
    """We got started as a stand-in for python. True if this process was one of those."""
    args = sys.argv[1:]
    if args[:2] == ["-m", "pymobiledevice3"]:
        sys.argv = ["pymobiledevice3", *args[2:]]
        # pmd3's utils.py imports IPython up top, only its interactive shell commands use it, and
        # it's left out of the build (it's big, and dragged in jedi). An empty stand-in does.
        import types
        sys.modules.setdefault("IPython", types.ModuleType("IPython"))
        from pymobiledevice3.__main__ import main
        main()
        return True
    if args[:1] == ["-c"]:
        sys.argv = ["-c", *args[2:]]
        exec(args[1], {"__name__": "__main__"})
        return True
    return False


def setup():
    build = os.path.join(SUPPORT, "build")
    os.makedirs(build, exist_ok=True)
    os.environ["VIDA_BUILD_DIR"] = build
    # ship the road-snapped route lines so the first launch doesn't hit Valhalla for every route
    cache = os.path.join(build, "snap-cache")
    if os.path.isdir(BUNDLED_CACHE):
        os.makedirs(cache, exist_ok=True)
        for name in os.listdir(BUNDLED_CACHE):
            if not os.path.exists(os.path.join(cache, name)):
                shutil.copy2(os.path.join(BUNDLED_CACHE, name), cache)
    if not waypoint_build.TEST:
        for k in ("VIDA_DRY_RUN", "VIDA_DRY_PHONE", "VIDA_PORT"):
            os.environ.pop(k, None)
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    fd = os.open(LOG, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    os.dup2(fd, 1)
    os.dup2(fd, 2)
    os.close(fd)
    os.chdir(SUPPORT)
    print(f"Waypoint {waypoint_build.VERSION}{' (test build)' if waypoint_build.TEST else ''}", flush=True)


if __name__ == "__main__":
    if not child():
        setup()
        import app
        app.main()
