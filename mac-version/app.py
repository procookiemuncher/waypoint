"""Waypoint — the Mac app. Runs the shared server (core/backend/server.py) on a free localhost
port in a background thread and shows the page in a native frameless window (pywebview, i.e.
the Mac's own WebKit). Closing the window stops whatever is running and clears the phone.

    ./mac-version/app.command          # or the Dock app made by make-app.command
    VIDA_DRY_RUN=1 ./mac-version/app.command   # UI work without touching the phone
"""
import atexit
import os
import signal
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
CORE = os.path.join(os.path.dirname(HERE), "core")
sys.path.insert(0, CORE)
sys.path.insert(0, HERE)

import uvicorn
import webview

from backend.server import create_app, free_port
from backend.device import DRY_RUN
from backend.session import Session
from drive_engine import DriveEngine
from phone_check import DevicectlReadiness

APP_NAME = "Waypoint"
ICON = os.path.join(HERE, "app", "Waypoint.icns")


def look_like_an_app():
    """When launched from the .app the process is really the venv's python, so tell AppKit our
    name + icon or the menu bar says 'Python'."""
    try:
        from AppKit import NSApplication, NSImage
        from Foundation import NSBundle
        info = NSBundle.mainBundle().infoDictionary()
        info["CFBundleName"] = APP_NAME
        info["CFBundleDisplayName"] = APP_NAME
        if os.path.exists(ICON):
            NSApplication.sharedApplication().setApplicationIconImage_(NSImage.alloc().initWithContentsOfFile_(ICON))
    except Exception:
        pass   # cosmetic only


class WindowApi:
    """Exposed to the page as window.pywebview.api (the custom titlebar buttons)."""

    def __init__(self):
        self._window = None   # underscore: pywebview doesn't expose private attrs to JS

    def minimize(self):
        self._window.minimize()

    def close(self):
        self._window.destroy()


def on_sigterm(cleanup):
    """atexit skips SIGTERM, and a Python signal handler never runs while the main thread sits
    in Cocoa's run loop — so block SIGTERM everywhere (main() does that first) and wait for it here."""
    signal.sigwait([signal.SIGTERM])
    cleanup()
    os._exit(0)


def main():
    signal.pthread_sigmask(signal.SIG_BLOCK, [signal.SIGTERM])   # before any thread exists
    look_like_an_app()
    session = Session()
    drive = DriveEngine()
    session.register(drive)
    session.use_placer(drive)   # places + pins through devicectl too
    if not DRY_RUN:   # dry runs keep the fake phone so the connect screen can be worked on
        session.use_readiness(DevicectlReadiness())

    port = free_port()
    server = uvicorn.Server(uvicorn.Config(create_app(session), host="127.0.0.1", port=port,
                                           log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)

    done = threading.Event()

    def cleanup():
        if done.is_set():
            return
        done.set()
        try:
            window.hide()           # clearing takes a few seconds; don't look frozen meanwhile
        except Exception:
            pass
        session.shutdown()          # stop the job + clear every sim we touched
        server.should_exit = True

    atexit.register(cleanup)
    threading.Thread(target=on_sigterm, args=(cleanup,), daemon=True).start()
    api = WindowApi()
    window = webview.create_window(
        APP_NAME, f"http://127.0.0.1:{port}/", js_api=api,
        width=1320, height=840, min_size=(920, 620),
        frameless=True, easy_drag=False, background_color="#050609")
    api._window = window
    window.events.closing += cleanup
    webview.start()
    cleanup()


if __name__ == "__main__":
    main()
