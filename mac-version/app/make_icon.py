"""Render icon.svg into Waypoint.icns with AppKit (ships with pywebview's pyobjc) + iconutil."""
import os
import shutil
import subprocess
import sys
import tempfile

from AppKit import NSBitmapImageRep, NSGraphicsContext, NSImage, NSPNGFileType
from Foundation import NSMakeRect

HERE = os.path.dirname(os.path.abspath(__file__))


def render(svg: str, px: int, out: str):
    img = NSImage.alloc().initWithContentsOfFile_(svg)
    rep = NSBitmapImageRep.alloc().initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel_(
        None, px, px, 8, 4, True, False, "NSDeviceRGBColorSpace", 0, 0)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.setCurrentContext_(NSGraphicsContext.graphicsContextWithBitmapImageRep_(rep))
    img.drawInRect_(NSMakeRect(0, 0, px, px))
    NSGraphicsContext.restoreGraphicsState()
    rep.representationUsingType_properties_(NSPNGFileType, {}).writeToFile_atomically_(out, True)


def main(out=os.path.join(HERE, "Waypoint.icns")):
    svg = os.path.join(HERE, "icon.svg")
    tmp = tempfile.mkdtemp()
    iconset = os.path.join(tmp, "Waypoint.iconset")
    os.makedirs(iconset)
    for size in (16, 32, 128, 256, 512):
        render(svg, size, os.path.join(iconset, f"icon_{size}x{size}.png"))
        render(svg, size * 2, os.path.join(iconset, f"icon_{size}x{size}@2x.png"))
    subprocess.run(["iconutil", "-c", "icns", iconset, "-o", out], check=True)
    shutil.rmtree(tmp)
    return out


if __name__ == "__main__":
    print(main(*sys.argv[1:]))
