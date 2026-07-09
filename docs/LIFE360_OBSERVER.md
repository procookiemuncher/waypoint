# Life360 Observer — design & build plan

> **Status:** design (nothing built yet). Companion to the movement engine: that engine is the
> **write** path (push a location onto the phone); this is the **read** path (see what Life360's
> servers report back about our own member). Together they close the loop — build a route, play it,
> and *measure* what Life360 actually saw instead of squinting at the app.
>
> Origin: `docs/research/coremotion-injection-feasibility.md` §7 + its sources surfaced that
> Life360's own server data model exposes each member's **speed** and an **`isDriving`** flag via the
> same unofficial API the Home Assistant integration uses. This doc turns that into a tool.

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
3. **Confirm the CDG arrival fired — server-side.** Watch the member cross the geofence and the
   arrival reflect, instead of hoping a push lands on someone else's phone.
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

Unofficial, reverse-engineered — the same endpoints the Home Assistant `life360` integration and the
`pylife360`-class libraries use. Base host historically `https://api-cloudfront.life360.com`.

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

## 4. Data model

One clean dataclass, populated from a member's `location` block. **Field names/units must be confirmed
on first real connect** (see build Increment 1) — the API is undocumented and speed units in
particular are reported inconsistently by third parties:

```python
@dataclass
class MemberState:
    name: str
    lat: float
    lon: float
    speed_raw: float | None      # as Life360 returns it — UNIT UNCONFIRMED (convert after verifying)
    is_driving: bool | None      # the isDriving flag — the key emoji signal to watch
    battery: float | None
    wifi_state: bool | None
    gps_accuracy: float | None
    address: str | None
    since_ts: int | None         # Life360's "last location update" epoch
    fetched_ts: int              # when WE polled (for cadence measurement)
```

`speed_raw` stays raw until a device test pins the unit; a `speed_mps` conversion is added once
confirmed (compare against a known-speed emoji-test run — we know exactly what mph we emitted).

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
- **Credentials never in the repo.** Read from `LIFE360_USER` / `LIFE360_PASS` env vars, or a
  **gitignored** `data/life360.creds.json`. Add both patterns to `.gitignore` before writing any code.
- **Read-only, always.** The client exposes no write methods. This is a design constraint, not a
  convention.
- Unofficial API ⟹ it can break or rate-limit; poll gently and treat it as best-effort telemetry.

## 9. Dependencies

**None new.** Use stdlib `urllib.request` + `json` — exactly like `backend/movement/snapper.py`
already does for Valhalla. No `requests`, no added wheels. Keeps the read path as light and
portable as the offline core.

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

### Increment 1 — auth + one-shot read  🎯 first proof
- [ ] `.gitignore` the creds file patterns.
- [ ] `client.py`: `authenticate()` → bearer token; `circles()`; `members(circle_id)`.
- [ ] `model.py`: `MemberState`; map the members JSON into it.
- [ ] `tools/observe.py` one-shot: print the target member's current state.
- [ ] **Verify on-device:** run it, confirm it prints your real location — and **pin down the
      `speed` unit and the exact field names** here (the one thing only a live call can settle).
- **Exit criteria:** one command prints a correct, current `MemberState` for you.

### Increment 2 — watch loop + logging
- [ ] `--watch --interval` poll loop with backoff + token refresh.
- [ ] `--log run.jsonl` append-per-sample.
- [ ] `--member` selection.
- **Exit criteria:** a live tail runs for minutes without dying and writes a clean JSONL.

### Increment 3 — the emoji A/B, instrumented
- [ ] Run `spoof.cmd emoji-test` while `observe.py --watch --log` records, **twice** (Motion &
      Fitness ON, then OFF). Two JSONL logs.
- [ ] Record: did `is_driving` flip? at what `speed_raw`? did OFF differ from ON?
- **Exit criteria:** the driving-emoji gate is decided by data — flip
      `activity-emoji-coremotion.md` accordingly.

### Increment 4 — correlation analysis (offline)
- [ ] `tools/correlate.py`: load a JSONL + the played GPX, print emitted-vs-observed speed, the
      `is_driving` timeline, and the server update interval.
- **Exit criteria:** one report quantifies the speed gap and the stutter from a single run.

## 12. Risks & open questions

- **Auth breakage / captcha** (most likely) — isolated in `authenticate()`; document the client-token
  refresh if it rotates. If captcha appears on the account, this path may need a one-time manual token.
- **Speed unit unknown** — resolved empirically in Increment 1 against a known emoji-test speed.
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
```
