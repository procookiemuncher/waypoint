"""Life360 HTTP client — the ONLY place that speaks Life360's (unofficial) API.

Read-only. Auth + three JSON endpoints, over stdlib urllib (no new deps — same choice as
backend/movement/snapper.py). Everything above this layer sees clean MemberState objects and a
single Life360Error; raw JSON, HTTP codes, and the bearer token never leak upward
(AGENTS.md ground rule #5, by analogy). See docs/LIFE360_OBSERVER.md §3/§9.

Host, client token, endpoints, and field names are cribbed verbatim from pnbruckner/life360
(docs/LIFE360_OBSERVER.md §14) rather than reverse-engineered. Auth is the fragile part: if the
client token or flow changes, this file is the one-file fix.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request

from .model import MemberState

_HOST = "https://api-cloudfront.life360.com"
_USER_AGENT = "com.life360.android.safetymapd/KOKO/23.50.0 android/13"
# Public, hardcoded client credential every OSS Life360 client uses (pnbruckner/life360 const.py).
_CLIENT_TOKEN = "Y2F0aGFwYWNyQVBoZUtVc3RlOGV2ZXZldnVjSGFmZVRydVl1ZnJhYzpkOEM5ZVlVdkE2dUZ1YnJ1SmVnZXRyZVZ1dFJlQ1JVWQ=="
_TIMEOUT_S = 20


class Life360Error(Exception):
    """Any failure talking to Life360 (auth, network, or unexpected response).

    The single exception type consumers catch — keeps urllib/HTTP/JSON details quarantined here.
    """


# -- value coercion (the API returns numbers as strings, bools as "0"/"1", -1 for unknown) ----

def _f(v) -> float | None:
    try:
        if v is None or v == "":
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def _i(v) -> int | None:
    f = _f(v)
    return int(f) if f is not None else None


def _b(v) -> bool | None:
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return v
    try:
        return bool(int(v))
    except (TypeError, ValueError):
        return None


class Life360Client:
    """Authenticate once, then read circles + members. Read-only by design — no write methods."""

    def __init__(self):
        self._token_type: str | None = None
        self._access_token: str | None = None

    @property
    def authenticated(self) -> bool:
        return self._access_token is not None

    # -- auth -----------------------------------------------------------------

    def use_token(self, access_token: str, token_type: str = "Bearer") -> None:
        """Skip login and use a pre-obtained bearer token directly. This is the path for
        passwordless (phone + SMS) accounts, where username/password login can't work — obtain a
        token out-of-band and hand it here. See docs/LIFE360_OBSERVER.md §3."""
        self._access_token = access_token
        self._token_type = token_type or "Bearer"

    def authenticate(self, username: str, password: str) -> None:
        """Exchange username/password for a bearer token. Raises Life360Error on failure."""
        body = urllib.parse.urlencode({
            "grant_type": "password",
            "username": username,
            "password": password,
        }).encode()
        headers = {
            "Authorization": f"Basic {_CLIENT_TOKEN}",
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
            "User-Agent": _USER_AGENT,
            "cache-control": "no-cache",
        }
        data = self._request("POST", "/v3/oauth2/token", headers=headers, body=body, auth=False)
        self._token_type = data.get("token_type") or "Bearer"
        self._access_token = data.get("access_token")
        if not self._access_token:
            raise Life360Error("authentication returned no access_token")

    # -- reads ----------------------------------------------------------------

    def circles(self) -> list[tuple[str, str]]:
        """Return [(circle_id, circle_name)] for the authenticated account."""
        data = self._request("GET", "/v4/circles")
        return [(c.get("id"), c.get("name") or "(unnamed)") for c in (data.get("circles") or [])]

    def members(self, circle_id: str) -> list[MemberState]:
        """Return the current MemberState of everyone in a circle."""
        data = self._request("GET", f"/v3/circles/{circle_id}/members")
        return [self._member(m) for m in (data.get("members") or [])]

    # -- JSON -> dataclass (mapping stays here, not above the client) ----------

    @staticmethod
    def _member(m: dict) -> MemberState:
        loc = m.get("location") or {}
        name = " ".join(x for x in (m.get("firstName"), m.get("lastName")) if x) or "(unknown)"
        address = loc.get("shortAddress") or loc.get("address1") or loc.get("name") or None
        return MemberState(
            name=name,
            lat=_f(loc.get("latitude")),
            lon=_f(loc.get("longitude")),
            speed_raw=_f(loc.get("speed")),
            is_driving=_b(loc.get("isDriving")),
            battery=_f(loc.get("battery")),
            wifi_state=_b(loc.get("wifiState")),
            gps_accuracy=_f(loc.get("accuracy")),
            address=address,
            since_ts=_i(loc.get("since")),
            fetched_ts=int(time.time()),
        )

    # -- transport (the quarantined layer) ------------------------------------

    def _request(self, method: str, path: str, headers: dict | None = None,
                 body: bytes | None = None, auth: bool = True) -> dict:
        if headers is None:
            headers = {
                "Accept": "application/json",
                "User-Agent": _USER_AGENT,
                "cache-control": "no-cache",
            }
        if auth:
            if not self._access_token:
                raise Life360Error("not authenticated — call authenticate() first")
            headers["Authorization"] = f"{self._token_type} {self._access_token}"

        req = urllib.request.Request(_HOST + path, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=_TIMEOUT_S) as r:
                raw = r.read()
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:300]
            if e.code in (401, 403):
                raise Life360Error(
                    f"Life360 rejected the request ({e.code}). Likely bad credentials, OR the "
                    f"client token / endpoint changed (see docs/LIFE360_OBSERVER.md §3). "
                    f"Detail: {detail}") from e
            if e.code == 429:
                raise Life360Error(f"Life360 rate-limited us (429). Poll less often. Detail: {detail}") from e
            raise Life360Error(f"HTTP {e.code} from Life360: {detail}") from e
        except urllib.error.URLError as e:
            raise Life360Error(f"could not reach Life360: {e.reason}") from e

        try:
            return json.loads(raw)
        except json.JSONDecodeError as e:
            raise Life360Error(f"Life360 returned non-JSON: {raw[:200]!r}") from e
