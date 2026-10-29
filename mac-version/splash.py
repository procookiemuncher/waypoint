"""The launch splash: plain dark from the window's first frame until the page has loaded, then
it fades and the page's glass intro (warp.js) is the first thing seen. No logo here on purpose,
the intro brings it in. A slow cold start gets a small "starting…" so it doesn't look stuck.

pywebview only puts the page in the window when it finishes loading, so until then the window was
just its black background (seconds, on a cold start). Here the webview goes in at once, inside a
plain container with the splash on top; pywebview sees it already has a window and leaves it be.
The view is removed as soon as the page is up.
"""
import os
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
NOTE_AFTER = 2.5  # seconds before a slow start shows "starting…"
GIVE_UP = 30      # seconds; if the page never says loaded, drop the splash anyway
FADE = 0.3


def attach(window):
    """Call before webview.start()."""
    state = {}

    def build():   # before_show runs on the main thread, window + webview made, page not loading yet
        try:
            state["view"] = _install(window, state)
        except Exception as e:   # no splash is fine, the app still opens
            print(f"splash skipped: {type(e).__name__}: {e}", flush=True)

    def done():
        from PyObjCTools import AppHelper
        AppHelper.callAfter(_fade, state)

    window.events.before_show += build
    window.events.loaded += done
    give_up = threading.Timer(GIVE_UP, done)
    give_up.daemon = True
    give_up.start()


def _rgb(hex_, alpha=1.0):
    from AppKit import NSColor
    r, g, b = (int(hex_[i:i + 2], 16) / 255 for i in (1, 3, 5))
    return NSColor.colorWithSRGBRed_green_blue_alpha_(r, g, b, alpha)


def _install(window, state):
    import AppKit
    from AppKit import NSTextField, NSFont, NSView
    from webview.platforms.cocoa import BrowserView

    ns = window.native
    webview = BrowserView.instances[window.uid].webview
    bounds = ns.contentView().bounds()
    fill = AppKit.NSViewWidthSizable | AppKit.NSViewHeightSizable

    box = NSView.alloc().initWithFrame_(bounds)
    webview.setFrame_(bounds)
    webview.setAutoresizingMask_(fill)
    box.addSubview_(webview)

    splash = NSView.alloc().initWithFrame_(bounds)
    splash.setAutoresizingMask_(fill)
    splash.setWantsLayer_(True)
    splash.layer().setBackgroundColor_(_rgb("#050609").CGColor())

    note = NSTextField.labelWithString_("starting…")
    note.setFont_(NSFont.systemFontOfSize_weight_(11, AppKit.NSFontWeightRegular))
    note.setTextColor_(_rgb("#4b5563"))
    note.setAlignment_(AppKit.NSTextAlignmentCenter)
    note.setFrame_(((0, (bounds.size.height - 18) / 2), (bounds.size.width, 18)))
    note.setAutoresizingMask_(AppKit.NSViewWidthSizable | AppKit.NSViewMinYMargin | AppKit.NSViewMaxYMargin)
    note.setHidden_(True)
    splash.addSubview_(note)

    def show_note():
        from PyObjCTools import AppHelper
        AppHelper.callAfter(note.setHidden_, False)
    t = threading.Timer(NOTE_AFTER, show_note)
    t.daemon = True
    t.start()

    box.addSubview_(splash)
    ns.setContentView_(box)
    ns.makeFirstResponder_(webview)
    return splash


def _fade(state):
    """Main thread. Once only; a later reload's loaded event finds nothing to do."""
    view = state.pop("view", None)
    if view is None:
        return
    from AppKit import NSAnimationContext

    def go(ctx):
        ctx.setDuration_(FADE)
        view.animator().setAlphaValue_(0)
    NSAnimationContext.runAnimationGroup_completionHandler_(go, view.removeFromSuperview)
