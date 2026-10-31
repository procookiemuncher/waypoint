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

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
CORE = os.path.join(os.path.dirname(HERE), "core")
sys.path.insert(0, CORE)
sys.path.insert(0, HERE)

import uvicorn
import webview

from backend.server import create_app, free_port
from backend.device import DRY_RUN
from backend.license import License
from backend.session import Session
from drive_engine import DriveEngine
from phone_check import DevicectlReadiness
import splash

APP_NAME = "Waypoint"
ICON = os.path.join(HERE, "app", "Waypoint.icns")
QUIT_LIMIT = 45   # seconds; if clearing the phone takes longer than this, quit anyway


def mark(what):
    """Startup timing, to ~/Library/Logs/Waypoint.log (not the in-app console)."""
    print(f"[{time.strftime('%H:%M:%S')}] startup +{time.time() - T0:.2f}s {what}", flush=True)


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
        self._quit = None

    def minimize(self):
        self._window.minimize()

    def drag(self):
        """Titlebar mousedown -> hand the press to AppKit's own window drag, so the window tracks
        the cursor natively instead of one bridge round trip per mousemove."""
        from AppKit import NSEvent
        from PyObjCTools import AppHelper

        def go():
            down = _last_press[0]
            # by now the press might be over; starting a drag then would glue the window to the cursor
            if down is not None and NSEvent.pressedMouseButtons() & 1:
                self._window.native.performWindowDragWithEvent_(down)
        AppHelper.callAfter(go)

    def close(self):
        self._quit()

    def open_url(self, url):
        """Outside links (the map's Leaflet / OSM credits) go to the default browser. Followed in
        the window they replaced the app, and there's no back button to get to the map again."""
        if url.startswith(('http://', 'https://')):
            import webbrowser
            webbrowser.open(url)


_last_press = [None]   # the latest left mouse-down; performWindowDragWithEvent_ needs the real event


def watch_presses():
    """Main thread only. Remembers each left mouse-down (and passes it on untouched)."""
    from AppKit import NSEvent, NSEventMaskLeftMouseDown

    def seen(event):
        _last_press[0] = event
        return event
    watch_presses.monitor = NSEvent.addLocalMonitorForEventsMatchingMask_handler_(NSEventMaskLeftMouseDown, seen)


def handle_reopen(fn):
    """pywebview's app delegate has no applicationShouldHandleReopen:hasVisibleWindows:, so add
    one that calls fn(app, has_visible) -> bool (False = handled, skip AppKit's default)."""
    import objc
    from webview.platforms.cocoa import BrowserView

    def applicationShouldHandleReopen_hasVisibleWindows_(self, app, has_visible):
        return fn(app, has_visible)
    objc.classAddMethods(BrowserView.AppDelegate, [
        objc.selector(applicationShouldHandleReopen_hasVisibleWindows_,
                      selector=b"applicationShouldHandleReopen:hasVisibleWindows:", signature=b"Z@:@Z")])


def on_sigterm(cleanup):
    """atexit skips SIGTERM, and a Python signal handler never runs while the main thread sits
    in Cocoa's run loop — so block SIGTERM everywhere (main() does that first) and wait for it here."""
    signal.sigwait([signal.SIGTERM])
    cleanup()
    os._exit(0)


def main():
    mark("imports done")
    signal.pthread_sigmask(signal.SIG_BLOCK, [signal.SIGTERM])   # before any thread exists
    look_like_an_app()
    session = Session()
    drive = DriveEngine()
    session.register(drive)
    session.use_placer(drive)   # places + pins through devicectl too
    if not DRY_RUN:   # dry runs keep the fake phone so the connect screen can be worked on
        session.use_readiness(DevicectlReadiness())

    lic = License.from_config()   # None unless this build (or VIDA_LICENSE_URL) names a key dashboard
    if lic:
        lic.start()   # checks the saved key while the intro plays

    port = free_port()
    server = uvicorn.Server(uvicorn.Config(create_app(session, lic), host="127.0.0.1", port=port,
                                           log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    mark("server up")
    # look for the phone now, not once the page's boot log gets to it: the usbmux + devicectl checks
    # take seconds on a cold start and this way they run while the boot log is typing
    threading.Thread(target=session.phone, daemon=True).start()

    started, finished, quitting = threading.Event(), threading.Event(), threading.Event()

    def cleanup():
        """Stop the job + clear every sim we touched, then let the server go. Blocks for seconds,
        so never on Cocoa's main thread. A second caller waits for the first instead of skipping."""
        if started.is_set():
            finished.wait(QUIT_LIMIT)
            return
        started.set()
        try:
            session.shutdown()
        finally:
            server.should_exit = True
            finished.set()

    def give_up():
        print(f"still clearing after {QUIT_LIMIT}s, quitting anyway", flush=True)
        os._exit(1)

    reopened = threading.Event()
    deadline = [None]

    def quit_soon():
        """Hide now, clear in the background, then close the window for real (which ends
        webview.start). Clearing used to run inside the close handler on the main thread and
        macOS flagged the app as hung on every quit."""
        if quitting.is_set():
            return
        quitting.set()
        reopened.clear()
        window.hide()
        deadline[0] = threading.Timer(QUIT_LIMIT, give_up)
        deadline[0].daemon = True
        deadline[0].start()

        def clear_then_close():
            session.shutdown()
            if reopened.is_set():   # Dock icon clicked while clearing: stay open instead
                session.closing = False
                quitting.clear()
                return
            cleanup()
            window.destroy()
        threading.Thread(target=clear_then_close, daemon=True).start()

    def on_reopen(app, has_visible):
        """Dock icon click / launching it again. While a quit is still clearing the phone the
        process is alive with its window hidden, so macOS hands the click to us instead of
        starting a fresh app — and without this nothing came back."""
        if not quitting.is_set() or finished.is_set():
            return True
        reopened.set()
        deadline[0].cancel()
        window.show()
        return False

    def on_closing():
        # red button, Cmd+W, Cmd+Q and Dock > Quit all land here, on the main thread
        if finished.is_set():
            return True
        quit_soon()
        return False   # cancel for now; clear_then_close closes it once the phone is clear

    atexit.register(cleanup)
    threading.Thread(target=on_sigterm, args=(cleanup,), daemon=True).start()
    api = WindowApi()
    window = webview.create_window(
        APP_NAME, f"http://127.0.0.1:{port}/", js_api=api,
        width=1320, height=840, min_size=(920, 620),
        frameless=True, easy_drag=False, background_color="#050609")
    api._window, api._quit = window, quit_soon
    window.events.closing += on_closing
    splash.attach(window)
    handle_reopen(on_reopen)
    from PyObjCTools import AppHelper
    webview.start(lambda: AppHelper.callAfter(watch_presses))
    cleanup()
    # Exit hard. The titlebar x reaches us through a pywebview bridge thread (not a daemon) that,
    # once close() returns, waits forever to hand the result back to a page that's already gone,
    # so a normal exit hung until give_up — and a Dock click meanwhile went to the stuck process.
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(0)


if __name__ == "__main__":
    main()
