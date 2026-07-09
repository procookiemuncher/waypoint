# Life360 Observer — design & build plan

> **Status:** design (nothing built yet). Companion to the movement engine: that engine is the
> **write** path (push a location onto the phone); this is the **read** path (see what Life360's
> servers report back about our own member). Together they close the loop — build a route, play it,
> and *measure* what Life360 actually saw instead of squinting at the app.
>
> Origin: `docs/research/coremotion-injection-feasibility.md` §7 + its sources surfaced that
> Life360's own server data model exposes each member's **speed** and an **`isDriving`** flag via the
> same unofficial API the community integrations use. This doc turns that into a tool.
>
> **Durable reference (corrected per SWE-2 review, 2026-07-09):** Home Assistant's *built-in* `life360`
> integration is now a **removal stub** — do not cite it. The living references are **`pnbruckner/ha-life360`**
> (the custom integration) and its standalone **`pnbruckner/life360`** Python package, whose `api.py` /
> `const.py` document the exact endpoints, the client token, and the fields we need. We crib the flow from
> there (see §3, §9) rather than reverse-engineer it. Full URLs in §14.

## 1. Why this exists (the payoff)

Today every on-device experiment ends with "owner picks up the phone and eyeballs the map." That's
slow, subjective, and limited to what the app chooses to draw. The observer reads the **raw
server-side numbers** Life360 holds about our member, giving us a real feedback loop:

1. **Settle the driving-emoji question with a fact.** The CoreMotion research found the emoji may key
   off a hidden `isDriving` flag rather than raw speed. Watching the flag during a spoof answers it
   outright: `speed` rises **and `isDriving`→true** ⟹ speed-derived (Motion & Fitness OFF should
   work); `speed` rises but `isDriving` stays false ⟹ the hard wall, no toggle helps.
2. **Measure the "stutter."** See exactly how often Life360's server receives a new position — if it's
   every ~3 s, that confirms the earlier "Life360's refresh cadence, not our engine" diagnosis with
   data, not a guess.
3. **Confirm the CDG arrival's *cause* — server-side.** Watch the member cross the geofence and dwell,
   with the Place/location fields Life360 holds — instead of only hoping. ⚠ **Scoped (SWE-2 review):**
   this proves *"we entered and dwelled in the Place"* (the trigger condition), **not** that a push was
   actually *delivered* — unless we find a notification-history endpoint that exposes deliveries, which
   is unconfirmed. Treat it as strong evidence the arrival *should* fire, not proof it did.
4. **Turn route tuning into a measurable loop.** If the engine emits 18 mph but Life360 reports 9 mph
   (sparse sampling), we can finally *see* the gap and tune duration/spacing to close it.

## 2. Where it fits (architecture)

It's a **new, independent read-only capability** — the mirror image of the spoof path, and it must
stay just as cleanly quarantined (AGENTS.md ground rule #5, applied by analogy):

```
┌─────────────────────────────────────────────┐
│  tools/observe.py     thin CLI runner         │  one-shot | watch | log-to-file
├─────────────────────────────────────────────┤
│  backend/life360/     Life360Client + models  │  login() / circles() / members()
│  (the ONLY place that                         │  → clean Member dataclasses
│   speaks the Life360 HTTP API)                │
└─────────────────────────────────────────────┘
```

- **Nothing above the client sees raw Life360 JSON, HTTP status codes, or auth tokens** — the client
  returns clean dataclasses and raises our own `Life360Error`, exactly like the movement engine hides
  pymobiledevice3. When Life360 changes its API (it will), it's a one-file fix.
- **Strictly read-only.** The observer never writes to Life360 — no location posts, no circle edits.
- It does **not** import from `backend/movement/` and vice-versa; correlation (§7) happens in the
  tool/analysis layer, not by coupling the two cores.

## 3. The Life360 API (and its fragility)

Unofficial, reverse-engineered — the same endpoints the **`pnbruckner/life360`** package (and its
`ha-life360` custom integration) use; crib the exact host, paths, client token, and field names from
that package's `api.py` / `const.py` (§14) rather than guess. Base host historically
`https://api-cloudfront.life360.com`.

**Auth flow (the fragile part — design for it to change):**
1. `POST /v3/oauth2/token.json` with a **hardcoded Basic client credential** (the well-known public
   Life360 client token) + `grant_type=password`, `username`, `password` → returns a bearer
   `access_token`.
2. `GET /v3/circles.json` (Bearer) → list of circles → pick the circle id.
3. `GET /v3/circles/{id}/members.json` (Bearer) → members + their `location` blocks. **This is the
   call the watch loop repeats.**

> ⚠ **Auth is the #1 thing that will break.** Life360 has periodically rotated the client token and
> added anti-bot/captcha challenges on some accounts. So the client isolates auth behind a single
> `authenticate()` method with a swappable strategy, and treats a 4xx on token as "auth broke — here's
> how to refresh the client token," not a crash. Everything downstream is stable-ish once a bearer
> token is in hand.

**Passwordless (phone + SMS) accounts — CONFIRMED on the owner's account (2026-07-09).** The
`grant_type=password` flow returns **403 "Invalid login and password"** because the account has no
password to check. And the SMS-code login flow is **not reliably reverse-engineered** in any public
client — the main library's maintainer couldn't get it working, and over-requesting codes **locks
verification for 24 h** (don't guess endpoints against it). So for these accounts we **skip login and
use a pre-obtained bearer token**: `Life360Client.use_token(token)`, fed from `LIFE360_TOKEN` in
`.env`. Get the token from an existing session you control (no new SMS beyond one login you make):
- **Proxy capture (reliable):** run mitmproxy on the PC, trust its cert on the iPhone, set the phone's
  Wi-Fi proxy to the PC, open Life360, copy the `Authorization: Bearer …` header for
  `api-cloudfront.life360.com`.
- **Web DevTools (if the web login works):** log in at life360.com (one OTP), then Network tab → copy
  the Bearer token from an API request.
Tokens are long-lived, so this is a one-time step.

## 4. Data model

One clean dataclass, populated from a member's `location` block. The field set below is **confirmed
present** by the `pnbruckner/life360` source (lat, lon, GPS accuracy, speed, driving, battery, Wi-Fi
state — SWE-2 review); the one thing still to confirm live is the **speed unit** (see Increment 1):

```python
@dataclass
class MemberState:
    name: str
    lat: float
    lon: float
    speed_raw: float | None      # life360 pkg documents this as MPH — VERIFY live in Inc 1 before trusting
    is_driving: bool | None      # the isDriving flag — the key emoji signal to watch
    battery: float | None
    wifi_state: bool | None
    gps_accuracy: float | None
    address: str | None
    since_ts: int | None         # Life360's "last location update" epoch
    fetched_ts: int              # when WE polled (for cadence measurement)
```

`speed_raw` is documented as **MPH** by the `life360` package, but we still confirm it on first run
against a known-speed emoji-test leg (we know exactly what mph we emitted); a `speed_mps` conversion is
added once confirmed.

## 5. Modes of operation

`tools/observe.py`:
- **one-shot** (default): print the current `MemberState` for the target member and exit.
- **watch** (`--watch`): poll every `--interval` seconds, print one timestamped line per sample —
  a live tail you run in a second terminal while `spoof.cmd` plays.
- **log** (`--log run.jsonl`): additionally append each sample as JSON to a file for later analysis.
- `--member "Juan"` selects which circle member (defaults to the authed user).

Example line (watch):
```
12:04:07  Juan | 25.79030,-80.25010 | speed_raw 15.4 | driving=false | batt 82% | wifi off | srv +3s
```

## 6. Cadence, rate-limiting, error handling

- **Poll gently: default `--interval 4 s`.** Life360's own server cadence is coarse (the stutter
  finding suggests few-second updates), so faster polling returns duplicates and only risks
  rate-limiting. Never hammer it.
- **Backoff on error:** on a transient HTTP error, exponential backoff (cap ~60 s) and keep going;
  the watch loop should survive a blip, not die.
- **Token refresh:** if a members call 401s, re-`authenticate()` once, then continue.
- Dedup hint: log every poll, but mark whether `since_ts` advanced — that's how we measure real
  server update frequency vs. our poll frequency.

## 7. The correlation payoff (why the JSONL log matters)

Because the played GPX has known timestamps and per-point speed, and each observer sample is stamped
with `fetched_ts`, we can **align "what we emitted" against "what Life360 saw"** offline:

- emitted speed vs `speed_raw` → is Life360 under-reading our speed? by how much?
- did `is_driving` ever flip, and at what emitted speed / after how long?
- server update interval (`since_ts` deltas) → the stutter, quantified.

This analysis is a **separate, offline script** (Increment 4) that reads the JSONL + the GPX — it does
not belong in the client. Keeps the read path clean.

## 8. Credentials & safety

- **Own account, own circle only.** This reads *your* data about *your* member — legitimate personal
  use, consistent with the whole project.
- **Credentials never in the repo.** Read from `.env` (gitignored): `LIFE360_TOKEN` (preferred, and
  required for passwordless accounts) **or** `LIFE360_USER` / `LIFE360_PASS`. `.env.example` is the
  committed template.
- **Read-only, always.** The client exposes no write methods. This is a design constraint, not a
  convention.
- Unofficial API ⟹ it can break or rate-limit; poll gently and treat it as best-effort telemetry.

## 9. Dependencies

**None new.** Use stdlib `urllib.request` + `json` — exactly like `backend/movement/snapper.py`
already does for Valhalla. No `requests`, no added wheels. Keeps the read path as light and
portable as the offline core.

> **Why not just use the `life360` package? (SWE-2 review)** It's **async / `aiohttp`-based**, which
> would drag a new runtime dependency and an event loop into an otherwise stdlib, synchronous tool —
> conflicting with the repo's no-new-deps rule. Since we only hit **three simple JSON endpoints**, we
> reimplement them over `urllib`, but **crib the auth flow, client token, endpoint paths, and field
> names verbatim from that package's source** (§14) so we inherit its hard-won API knowledge without
> the dependency. If Life360's auth ever gets too hairy to maintain by hand (e.g. captcha), revisit
> vendoring the package as the fallback.

## 10. Module layout

```
backend/life360/
  __init__.py         # exports Life360Client, MemberState, Life360Error
  client.py           # auth + HTTP + JSON→dataclass (the quarantined layer)
  model.py            # MemberState dataclass
tools/
  observe.py          # CLI: one-shot | watch | log
  correlate.py        # (Increment 4) align a JSONL log against a played GPX
```

## 11. Build plan (incremental, each step verifiable)

### Increment 1 — auth + one-shot read  🎯 first proof  🟡 CODE DONE (2026-07-09), live-verify pending
- [x] `.gitignore` the creds file patterns (`.env` already ignored; added `data/life360.creds.json`).
- [x] `client.py`: `authenticate()` → bearer token; `circles()`; `members(circle_id)`. Host/token/
      endpoints cribbed from pnbruckner/life360; all HTTP/JSON quarantined; own `Life360Error`.
- [x] `model.py`: `MemberState` + `oneline()`; JSON→dataclass mapping lives in the client.
- [x] `tools/observe.py` one-shot: `.env` loader (stdlib), auth, list circles, print each member;
      `--member` filter. Verified offline: imports, `--help`, and the no-creds path all work.
- [ ] **Verify on-device (owner):** create `.env` from `.env.example`, run `tools/observe.py`,
      confirm it prints your real location — and **confirm the speed unit is MPH** (as the `life360`
      package documents) against a known-speed leg.
- **Exit criteria:** one command prints a correct, current `MemberState` for you. *(Code ready;
  awaits a live run with real credentials.)*

### Increment 2 — watch loop + logging  🟡 CODE DONE (2026-07-09), live-verify pending
- [x] `--watch --interval` poll loop with exponential backoff (cap 60s) on transient errors.
      (Static-token auth can't be "refreshed" — on a token expiry the loop surfaces the error and
      backs off; re-capture the token per the runbook.)
- [x] `--log run.jsonl` append-per-sample (one JSON object per line: all `MemberState` fields +
      an ISO timestamp + circle name; flushed each write).
- [x] `--member` selection (already in Inc 1; reused).
- [x] Verified offline with a fake client: `collect`/filter, `run_once`, and JSONL shape all pass;
      `--help` shows the new flags.
- [ ] **Verify live (owner):** once the token works, `observe.py --watch --member <you>` tails for
      minutes without dying and writes a clean JSONL.
- **Exit criteria:** a live tail runs for minutes and writes a clean JSONL. *(Code ready; awaits a
  working token.)*

### Increment 3 — the emoji A/B, instrumented
- [ ] Run `spoof.cmd emoji-test` while `observe.py --watch --log` records, **twice** (Motion &
      Fitness ON, then OFF). Two JSONL logs.
- [ ] Record: did `is_driving` flip? at what `speed_raw`? did OFF differ from ON?
- **Exit criteria:** the driving-emoji gate is decided by data — flip
      `activity-emoji-coremotion.md` accordingly.

### Increment 4 — correlation analysis (offline)  ✅ DONE (2026-07-09)
- [x] `tools/correlate.py`: load a JSONL + the played GPX, print emitted-vs-observed speed (+ a
      **unit guess** and under-read %), the `is_driving` timeline (did it flip, and how far in), and
      the server update interval (the stutter). Read-only, stdlib.
- [x] **Aligns by position, not timestamp** — the GPX uses a synthetic 2020 epoch while the observer
      stamps real wall-clock, so each observed sample is matched to the nearest emitted GPX point
      (the pin's location is the common reference).
- [x] Verified offline against a synthesized JSONL + a built GPX: correctly reported mph + an ~18%
      under-read + an `isDriving` flip + 5s cadence, and degraded gracefully on a no-speed/no-driving
      run.
- **Exit criteria met** (code): one report quantifies the speed gap, the emoji flag, and the stutter.
  Real value lands once a live run's JSONL exists to feed it.

## 12. Risks & open questions

- **Auth breakage / captcha** (most likely) — isolated in `authenticate()`; document the client-token
  refresh if it rotates. If captcha appears on the account, this path may need a one-time manual token.
- **Speed unit** — documented as MPH by the `life360` package; still confirmed empirically in
  Increment 1 against a known emoji-test speed before we trust it.
- **`isDriving` semantics** — whether it's the Arity/CoreMotion signal or something else is exactly
  what Increment 3 measures; don't assume.
- **Rate limiting** — mitigated by the 4 s default + backoff; if it bites, widen the interval.
- **TOS/personal-use** — own account and data; keep it read-only and low-frequency.

## 13. Out of scope

- Any **write** to Life360 (posting locations, editing circles/places) — never.
- Multi-account / other people's circles.
- A UI — this is CLI telemetry; a UI could consume the JSONL later if ever wanted.
- Replacing the on-device check entirely — the observer is server-side truth; Find My / the app UI
  remain useful cross-checks (§ the research's Find-My isolation idea).

## 14. References (crib the API from these — verified by SWE-2, 2026-07-09)

- **`pnbruckner/life360` — endpoints:** https://raw.githubusercontent.com/pnbruckner/life360/master/life360/api.py
- **`pnbruckner/life360` — constants (host, client token, field keys):** https://raw.githubusercontent.com/pnbruckner/life360/master/life360/const.py
- **`ha-life360` — device-tracker field mapping (speed=MPH, driving, battery, wifi, gps accuracy):** https://raw.githubusercontent.com/pnbruckner/ha-life360/master/custom_components/life360/device_tracker.py
- **`ha-life360` — manifest (the maintained custom integration):** https://raw.githubusercontent.com/pnbruckner/ha-life360/master/custom_components/life360/manifest.json
- **HA core `life360` = removal stub (do NOT cite as a live reference):** https://raw.githubusercontent.com/home-assistant/core/dev/homeassistant/components/life360/__init__.py
