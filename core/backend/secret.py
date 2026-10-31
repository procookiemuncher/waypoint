"""Load JSON that may be obfuscated, and the routine the release build uses to obfuscate it.

This is obfuscation, not encryption: the key lives right here and gets compiled into the native
binary, so a determined person can recover it. The point is only to stop the casual copy — someone
who right-clicks Waypoint.app, picks Show Package Contents, and reads destinations.json straight
out of the bundle. In the repo (and the dev app) the files stay plain JSON; `load_json` reads both,
so nothing else has to know which kind it got.
"""
import json
import zlib

_MAGIC = b"WPX1"
# Not a secret in any real sense (see the module docstring); just not the file bytes.
_KEY = b"waypoint/\x9c\x11keep-your-spots\x3f\xa7-to-yourself"


def _xor(data: bytes) -> bytes:
    k = _KEY
    return bytes(b ^ k[i % len(k)] for i, b in enumerate(data))


def obfuscate(raw: bytes) -> bytes:
    """Plain file bytes -> an obfuscated blob `load_json` can read back. Used by the release build."""
    return _MAGIC + _xor(zlib.compress(raw, 9))


def loads(blob: bytes):
    """Parse bytes that are either plain JSON or an obfuscated blob."""
    if blob[:len(_MAGIC)] == _MAGIC:
        blob = zlib.decompress(_xor(blob[len(_MAGIC):]))
    return json.loads(blob)


def load_json(path):
    """Open `path` and parse it, transparently de-obfuscating a release blob."""
    with open(path, "rb") as f:
        return loads(f.read())
