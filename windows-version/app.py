"""Waypoint — the Windows app. Runs the shared server (core/backend/server.py) on a free localhost
port in a background thread and shows the page in a native frameless window (pywebview on Edge
WebView2). Closing the window stops whatever is running and clears the phone.

    windows-version\\waypoint.cmd                       # no console, log in %LOCALAPPDATA%\\Waypoint
    .venv\\Scripts\\python.exe windows-version\\app.py    # same, log in the console
    set VIDA_DRY_RUN=1 & windows-version\\waypoint.cmd  # UI work without touching the phone
"""
import atexit
import ctypes
import os
import sys
import threading
import time

APP_NAME = "Waypoint"
HERE = os.path.dirname(os.path.abspath(__file__))
CORE = os.path.join(os.path.dirname(HERE), "core")
QUIT_LIMIT = 45   # seconds; if clearing the phone takes longer than this, quit anyway
T0 = time.time()

# pythonw (waypoint.cmd) has no console, so print() would go nowhere: send it to a log file
if sys.stdout is None:
    LOG_DIR = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), APP_NAME)
    os.makedirs(LOG_DIR, exist_ok=True)
    sys.stdout = sys.stderr = open(os.path.join(LOG_DIR, "Waypoint.log"), "a", encoding="utf-8", buffering=1)

sys.path.insert(0, CORE)

import uvicorn
import webview

from backend.server import create_app, free_port, warm_route_legs
from backend.license import License
from backend.session import Session

user32 = ctypes.windll.user32
WM_NCLBUTTONDOWN, HTCAPTION, VK_LBUTTON = 0xA1, 2, 0x01


def mark(what):
    print(f"[{time.strftime('%H:%M:%S')}] startup +{time.time() - T0:.2f}s {what}", flush=True)


class WindowApi:
    """Exposed to the page as window.pywebview.api (the custom titlebar buttons)."""

    def __init__(self):
        self._window = None   # underscore: pywebview doesn't expose private attrs to JS
        self._quit = None

    def minimize(self):
        self._window.minimize()

    def drag(self):
        """Titlebar mousedown -> hand the press to Windows' own window move (the same message a
        real titlebar sends), so the window tracks the cursor natively and Aero Snap works."""
        from System import Action
        form = self._window.native

        def go():
            # by now the press might be over; starting a move then would glue the window to the cursor
            if user32.GetAsyncKeyState(VK_LBUTTON) & 0x8000:
                user32.ReleaseCapture()
                user32.SendMessageW(form.Handle.ToInt32(), WM_NCLBUTTONDOWN, HTCAPTION, 0)
        form.BeginInvoke(Action(go))

    def close(self):
        self._quit()

    def open_url(self, url):
        """Outside links (the map's Leaflet / OSM credits) go to the default browser, not the window."""
        if url.startswith(('http://', 'https://')):
            import webbrowser
            webbrowser.open(url)


def main():
    mark("imports done")
    session = Session()
    session.use_placer(session.engines["drive"])   # places + pins through the CoreDevice sim too

    lic = License.from_config()   # None unless VIDA_LICENSE_URL names a key dashboard
    if lic:
        lic.start()

    port = free_port()
    server = uvicorn.Server(uvicorn.Config(create_app(session, lic), host="127.0.0.1", port=port,
                                           log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    mark("server up")
    threading.Thread(target=session.phone, daemon=True).start()   # look for the phone during the boot log
    warm_route_legs(session)

    started, finished, quitting = threading.Event(), threading.Event(), threading.Event()

    def cleanup():
        """Stop the job + clear every sim we touched, then let the server go. Blocks for seconds,
        so never on the window's thread. A second caller waits for the first instead of skipping."""
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

    def quit_soon():
        """Hide now, clear in the background, then close the window for real (ends webview.start)."""
        if quitting.is_set():
            return
        quitting.set()
        window.hide()
        deadline = threading.Timer(QUIT_LIMIT, give_up)
        deadline.daemon = True
        deadline.start()

        def clear_then_close():
            cleanup()
            window.destroy()
        threading.Thread(target=clear_then_close, daemon=True).start()

    def on_closing():
        # the page's x, Alt+F4 and the taskbar's Close window all land here
        if finished.is_set():
            return True
        quit_soon()
        return False   # cancel for now; clear_then_close closes it once the phone is clear

    atexit.register(cleanup)
    api = WindowApi()
    window = webview.create_window(
        APP_NAME, f"http://127.0.0.1:{port}/", js_api=api,
        width=1320, height=840, min_size=(920, 620),
        frameless=True, easy_drag=False, background_color="#050609")
    api._window, api._quit = window, quit_soon
    window.events.closing += on_closing
    webview.start(gui="edgechromium")
    cleanup()
    # Exit hard, like the Mac app: a pywebview bridge thread can still be waiting on the closed page
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(0)


if __name__ == "__main__":
    main()
