"""The launch splash: the app icon with a soft lavender pulse, drawn by AppKit in the window from
its first frame and faded out once the page has loaded.

pywebview only puts the page in the window when it finishes loading, so until then the window was
just its black background (seconds, on a cold start). Here the webview goes in at once, inside a
plain container with the splash on top; pywebview sees it already has a window and leaves it be.
The pulse is a Core Animation loop, so it costs no Python per frame, and the view is removed as
soon as the page is up.
"""
import os
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
ICON = os.path.join(HERE, "app", "Waypoint.icns")
TILE = 150        # points; the visible tile, the icns has ~10% clear margin around it
NOTE_AFTER = 2.5  # seconds before "starting…" shows under the name
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


def _pulse(layer, key, a, b, duration=1.2):
    from Quartz import CABasicAnimation, CAMediaTimingFunction, kCAMediaTimingFunctionEaseInEaseOut
    anim = CABasicAnimation.animationWithKeyPath_(key)
    anim.setFromValue_(a)
    anim.setToValue_(b)
    anim.setDuration_(duration)
    anim.setAutoreverses_(True)
    anim.setRepeatCount_(float("inf"))
    anim.setTimingFunction_(CAMediaTimingFunction.functionWithName_(kCAMediaTimingFunctionEaseInEaseOut))
    layer.addAnimation_forKey_(anim, key)


def _install(window, state):
    import AppKit
    from AppKit import NSImage, NSImageView, NSTextField, NSFont, NSView, NSWorkspace
    from Quartz import CAGradientLayer
    from webview.platforms.cocoa import BrowserView

    ns = window.native
    webview = BrowserView.instances[window.uid].webview
    bounds = ns.contentView().bounds()
    fill = AppKit.NSViewWidthSizable | AppKit.NSViewHeightSizable
    centered = (AppKit.NSViewMinXMargin | AppKit.NSViewMaxXMargin
                | AppKit.NSViewMinYMargin | AppKit.NSViewMaxYMargin)

    box = NSView.alloc().initWithFrame_(bounds)
    webview.setFrame_(bounds)
    webview.setAutoresizingMask_(fill)
    box.addSubview_(webview)

    splash = NSView.alloc().initWithFrame_(bounds)
    splash.setAutoresizingMask_(fill)
    splash.setWantsLayer_(True)
    splash.layer().setBackgroundColor_(_rgb("#050609").CGColor())

    side = 400
    group = NSView.alloc().initWithFrame_((((bounds.size.width - side) / 2, (bounds.size.height - side) / 2 + 20),
                                           (side, side)))
    group.setAutoresizingMask_(centered)
    group.setWantsLayer_(True)
    cx, cy = side / 2, side / 2 + 30   # icon center; the name sits under it

    glow = CAGradientLayer.layer()
    glow.setType_("radial")
    glow.setColors_([_rgb("#b49aff", .30).CGColor(), _rgb("#b49aff", 0).CGColor()])
    glow.setStartPoint_((.5, .5))
    glow.setEndPoint_((1, 1))
    g = TILE * 2.2
    glow.setFrame_(((cx - g / 2, cy - g / 2), (g, g)))
    group.layer().addSublayer_(glow)

    art = TILE / 0.8
    icon = NSImageView.alloc().initWithFrame_(((cx - art / 2, cy - art / 2), (art, art)))
    icon.setImage_(NSImage.alloc().initWithContentsOfFile_(ICON))
    icon.setImageScaling_(AppKit.NSImageScaleProportionallyUpOrDown)
    icon.setWantsLayer_(True)
    lay = icon.layer()
    lay.setShadowColor_(_rgb("#b49aff").CGColor())
    lay.setShadowOffset_((0, 0))
    lay.setShadowRadius_(18)
    lay.setShadowOpacity_(.35)
    group.addSubview_(icon)

    def label(text, size, weight, color, y):
        f = NSTextField.labelWithString_(text)
        f.setFont_(NSFont.systemFontOfSize_weight_(size, weight))
        f.setTextColor_(color)
        f.setAlignment_(AppKit.NSTextAlignmentCenter)
        f.setFrame_(((0, y), (side, size * 1.6)))
        group.addSubview_(f)
        return f
    label("Waypoint", 22, AppKit.NSFontWeightSemibold, _rgb("#e9e4ff", .9), cy - TILE / 2 - 52)
    note = label("starting…", 11, AppKit.NSFontWeightRegular, _rgb("#4b5563"), cy - TILE / 2 - 80)
    note.setHidden_(True)

    if not NSWorkspace.sharedWorkspace().accessibilityDisplayShouldReduceMotion():
        _pulse(glow, "opacity", .5, 1.0)
        _pulse(lay, "shadowOpacity", .1, .55)

    def show_note():
        from PyObjCTools import AppHelper
        AppHelper.callAfter(note.setHidden_, False)
    t = threading.Timer(NOTE_AFTER, show_note)
    t.daemon = True
    t.start()

    splash.addSubview_(group)
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
