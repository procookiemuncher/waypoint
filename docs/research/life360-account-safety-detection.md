---
title: Life360 server-side detection & account risk — don't get the owner's real account flagged or banned
status: research                # research | device-verified | superseded
last_verified: 2026-07-09
device_verified: none           # risk landscape is sourced; nothing tested against our own account
open_gates: [account-flagging-risk, api-poll-cadence-safe]
depends_on: [life360-detection-and-realism, life360-notification-triggers, coremotion-injection-feasibility]
source_tier: mixed              # PRIMARY (Life360 ToS/blog, integration maintainer + source, breach disclosures) + THIRD-PARTY (forums/vendor, some access-walled)
recheck_if: [Life360 app/API update, a reported account ban for spoofing/API use, the Observer starts getting 403/429, Life360 ToS revision]
---

# Life360 server-side detection & account risk — don't get the owner's real account flagged or banned

> Research brief. Two NEW risk sources the existing briefs don't cover: (1) teleport-heavy flight/gap work,
> and (2) the read-only "Observer" hitting the API directly with a captured bearer token from a non-app
> client. `life360-detection-and-realism.md` covers **client-side** spoof tells; this brief covers
> **server-side account consequences** and **API-client** risk. Confidence + source-class per claim; sources
> at end.
>
> **How to read confidence:** `[HIGH/MEDIUM/LOW]` = source/reasoning strength; **[PRIMARY]** (Life360
> ToS/blog, integration maintainer/source read directly, breach disclosures) vs **[THIRD-PARTY]** (forum/
> vendor/anecdote). Separately, `device_verified: none` — none of this is tested against our own account.
>
> **Access caveat (caps several claims):** Life360's own domains (`support`/`legal.corp`/`life360.com`) and
> Reddit were variously 403/401-blocked to automated fetchers this run, so some Life360-official and
> community-consensus claims rest on **search snippets / secondary characterization**, not raw reads. Flagged
> where load-bearing. Adversarial framing throughout: where nothing was found, it's **"no evidence found,"
> not "proven safe."**

## Bottom line (read this first)

**The realistic risk on both fronts is REQUEST-LAYER blocking and SOCIAL tip-off — not account loss. No
account has been observed banned or flagged for either GPS spoofing or unofficial-API use, across years and
thousands of users. But that is absence of evidence (the ToS permits a ban; it's just never been seen
applied), so operate conservatively rather than assuming immunity.**

- **Spoof side (teleport work):** Life360's documented server-side response to implausible location is a
  generic *accuracy/staleness* indicator, at worst "Location Not Available" — **no** documented soft-ban or
  suspension. `[MEDIUM · PRIMARY-snippet + THIRD-PARTY]` The dominant real risk is **social**: a sloppy
  teleport (Miami→CDG is the textbook case) blows its own cover to a *watching human* via teleport
  rendering, out-of-place geofence-alert pushes, and persisted 2–30-day history. `[HIGH · PRIMARY + THIRD]`
- **API side (Observer):** detection is real but **request-layer (Cloudflare TLS-fingerprint 403/429), not
  account-layer.** The universal failure signature across the Home Assistant user base is *"the app still
  works, only my client is blocked"* — a block, not a ban. `[HIGH · PRIMARY]` The block keys on **TLS
  fingerprint + user-agent + rate, not the token or automation per se** — a stdlib-`urllib` (OpenSSL) client
  with the exact Android UA, polling gently, is what stays working. `[HIGH · PRIMARY]`
- **Account ban likelihood: LOW but non-zero and genuinely unverifiable.** Treat as "no enforcement
  observed," keep experiments low-volume, and don't assume the ToS termination right will never be used.

---

## §1 — Server-side response to spoofing / impossible travel *(MEDIUM · PRIMARY-snippet + THIRD-PARTY)*

- **The only documented server-side response is a generic location-ACCURACY / staleness indicator** (the
  accuracy circle, "updated X ago", greyed/badged icon) — **not** a spoofing-specific flag; the same UI shows
  for weak GPS. `[MEDIUM · PRIMARY-snippet + THIRD-PARTY]`
- On badly conflicting signals the app may show **"Location Not Available"** (stops presenting a trusted
  fix) — a weak "soft-ignore," not confirmed to be spoof-triggered vs. ordinary signal loss. `[LOW-MEDIUM ·
  THIRD-PARTY]`
- **No evidence Life360 auto-soft-bans, locks, or suspends accounts for detected spoofing/impossible travel,
  and no published numeric thresholds** (speed/jump size). The "50 mi in 5 min = flagged" figures are
  third-party illustrations. `[MEDIUM for the absence · aggregate THIRD-PARTY null]`
- **iOS asymmetry (why detection reports are scarce):** iOS `CLLocationManager` has **no
  `isFromMockProvider()` equivalent**, so Life360 can't directly ask iOS "is this faked" the way it can on
  Android. `[HIGH · THIRD-PARTY security]` The residual iOS tell is **behavioral** — GPS moving while the
  motion coprocessor reports "stationary" (our exact still-phone situation; see
  `coremotion-injection-feasibility.md`). The signal exists; that Life360 *acts* on it server-side is
  unproven. `[HIGH signal exists / MEDIUM that Life360 uses it]`
- **Vendor "100% safe / 0% ban / undetectable" claims are advertising**, self-interested and uncited — but
  note one vendor sells a *"cooldown timer,"* whose existence is itself an admission that rapid re-teleporting
  is at least *renderable* as suspicious. `[truth LOW · THIRD-PARTY]`

**Adversarial note:** "no reported bans" is weakened by reporting bias (a silently-degraded account leaves no
complaint trail; people "caught" usually mean a *human* noticed, not a ban). Absence of evidence ≠
un-bannable.

## §2 — The real exposure is SOCIAL: incidental tip-off to a watching human *(HIGH · PRIMARY + THIRD-PARTY)*

Life360 is **not** documented to deliberately flag "this user is spoofing" to the circle `[MEDIUM-HIGH ·
absence]`. But its *ordinary* features surface a sloppy spoof to an attentive member — and the planned
teleport work triggers exactly these:

- **Teleport rendering** — the icon snaps A→B instead of tracing a path; cited as the single biggest
  human-observable giveaway. **Miami→CDG is the textbook example.** `[HIGH · THIRD-PARTY]`
- **Place / Smart Alert pushes** — a teleport that crosses a geofence fires normal "arrived/left <Place>"
  pushes to members, possibly at an implausible time. `[MEDIUM-HIGH · PRIMARY-snippet + THIRD-PARTY]`
- **Persisted Location/Driving History** — members can scroll a member's history (free ~2 days / paid ~30
  days) and review a teleport or impossible-speed trip **after the fact**. A jump isn't only a live-moment
  risk. `[HIGH · PRIMARY-snippet]`
- **Straight-line paths over water/buildings, a drift-free static pin for hours** — classic human tells.
  `[HIGH · THIRD-PARTY]`

**Consequence:** cover is blown by observation, not by a ban. This is *the* dominant risk for the flight/gap
work and it's mitigable with realistic motion + careful timing (below).

## §3 — API-client detection: request-layer, not account-layer *(HIGH · PRIMARY)*

- Life360 (via **Cloudflare**) actively blocks unofficial API clients. Maintainer pnbruckner, verbatim:
  *"Life360 (via Cloudflare) has started to actively lock out unauthorized uses of their API"* — and
  decisively, the HA integration makes *"the exact same requests (URLs, headers, auth tokens) as their app,
  yet they are getting rejected from HA, where they work when issued from their official app."* Identical
  request + valid token, rejected for the client but fine from the app ⟹ **client fingerprinting, and the
  account keeps working.** `[HIGH · PRIMARY]`
- Mechanism = **TLS/JA3-JA4 handshake fingerprinting** (a prod instance was blocked while a test instance on
  a different port still worked; the fix forced an older `SSLContext` so the handshake "look[s] like it did
  before"). `[HIGH symptom / MEDIUM exact mechanism · PRIMARY]`
- **The critical nuance for a captured-token client:** issue #45 (2025-01-12) shows the *same* requests
  **succeed from direct Python/Podman but fail from inside Home Assistant** with identical headers — so the
  block keys on **TLS/environment fingerprint, not the token and not "automation" per se.** An **OpenSSL-backed
  stack (stdlib `urllib`/`requests`) + the exact Android UA passes**; curl/node-fetch fingerprints get 403.
  `[HIGH · PRIMARY + THIRD-PARTY logs]` **→ The Observer, as built (`urllib` + `com.life360.android...` UA),
  is on the right side of this.**
- "You have been blocked" / "unauthorized" strings are the **Cloudflare interstitial / HTTP-403 labels**, not
  account-ban notices — in every traced case the official app kept working. `[HIGH · PRIMARY]`
- The one real Life360 forced-password-reset was **credential-stuffing remediation** (passwords stolen from
  *other* breaches), unrelated to API/automation use — don't conflate. `[HIGH · PRIMARY]`

## §4 — Token lifetime, revocation, anti-bot *(HIGH · PRIMARY)*

- **Opaque bearer (not a JWT), no readable `exp`, no refresh-token flow.** Often long-lived (maintainer runs
  one for months) but dies unpredictably for some (~30 min to days), and early deaths are attributed to
  Cloudflare 403/429, not clean expiry. `[HIGH · PRIMARY]`
- **Confirmed revocation trigger: explicit web LOGOUT.** Maintainer: *"do NOT log out. Just close the browser
  … use a 'private' browser session."* Merely re-logging-in (web or app) does **not** revoke prior tokens.
  `[HIGH · PRIMARY]` **→ Operating rule: never log out of the session the Observer's token came from.**
- **Reusing a token does NOT bypass Cloudflare** — the anti-bot layer sits on the read endpoints too (403
  Cloudflare page with `CF-RAY`/`__cf_bm` on `/v4/circles` and `/v3/circles/{id}/members` even with a valid
  bearer). It is **not** an interactive captcha (nothing to "solve") — only avoidable by looking like the app.
  `[HIGH · PRIMARY + THIRD-PARTY logs]`
- **SMS/OTP:** requesting too many codes **disables verification for 24 h** (Life360 support). The OTP login
  flow isn't reliably reverse-engineered — which is exactly why the passwordless account must use a
  **manually captured token** rather than automating login. `[HIGH · PRIMARY]`
- **Revocation-on-suspicious-use:** no direct evidence, but it would be **indistinguishable from a Cloudflare
  403** to us — genuinely inconclusive. `[MEDIUM · negative]`

## §5 — Rate limits & the safe poll cadence *(HIGH · PRIMARY)*

- The maintained `pnbruckner/ha-life360` ships **`UPDATE_INTERVAL = 5 s`** (fixed, not user-configurable),
  and thousands ran it for years without account consequences — so **5 s is empirically survivable**, and
  slower is safer. `[HIGH · PRIMARY source]`
- **The Circles endpoint is the rate-limit hotspot** (429/403, "retry after as much as ten minutes") — the
  members endpoint is gentler, **but recently tightening**: an open issue (2026-06-04) shows a members-path
  `429` with `retry_after ≈ 22.7 h`. `[HIGH · PRIMARY]`
- 429 is **not auto-retried**; the client honors the server's `Retry-After` (waits `retry_after + 10 s`); a
  403 login-error clears cookies and waits 300 s. **No numeric req/min threshold is published** — it's
  server-side, opaque, and dynamic. `[HIGH · PRIMARY source]`
- **Recommended cadence:** poll **`/v3/circles/{id}/members` no faster than every 15–30 s** in steady state;
  treat the **Circles list as near-static** (resolve the circle id once at startup, refresh at most hourly —
  do **not** poll `/v4/circles` in the loop); **honor `Retry-After` verbatim** and *widen* the interval after
  any 429 (don't resume hammering). Life360's own server cadence is only every few seconds, so faster polling
  just returns duplicates for extra risk. `[HIGH · PRIMARY-derived]`

## §6 — Did the 2024 breach change the posture for a read client? *(HIGH · PRIMARY)*

**No.** The breach (442,519 users; detected Mar 2024, data sold Jul 2024) was an **unauthenticated
login/lookup endpoint** over-returning name + phone (OWASP API#3) — **no location/password/circle data**.
Life360's fix was scoped to *that* endpoint ("removed the ability to access user data with email addresses …
implemented limits on how frequently **this endpoint** can be called") — a **different code path** from the
authenticated `/v3/circles`/`members` reads. `[HIGH · PRIMARY]` Decisively, the read-path lockdown
**predates** the breach (HA breakage reported 2024-02-03, before the March detection; token-only third
parties like DAKboard cut off as early as Feb 2023) — so it's a **separate, pre-existing anti-abuse trend**,
not a breach consequence. `[HIGH · PRIMARY]`

## §7 — ToS & enforcement *(MEDIUM · PRIMARY-indirect)*

- The **false-info clause is scoped to identity** ("false … information regarding your age or country and
  state … of residence"; impersonation/fraud) — **no clause names GPS/location spoofing.** `[PRIMARY,
  indirect · MEDIUM]`
- Clauses that *could* be stretched to a spoofing tool or the Observer: **anti-automation** ("robots,
  spiders … more request messages than a human can reasonably produce"), **anti-reverse-engineering**, and
  **anti-circumvention** of "security-related features." `[MEDIUM-HIGH · PRIMARY-indirect]`
- **Broad discretionary termination:** Life360 "reserves the right, but is not obligated, to … suspend[] or
  terminat[e] your account … if you violate any provision." `[HIGH — quoted near-identically across sources]`
- **Enforcement record: none found** against spoofing or API use — third-party language is always the hedged
  *right* ("may violate ToS"), never a *record*. Life360's actual legal/enforcement actions run the **opposite
  direction** (FTC Jan-2025 order forcing them to stop *selling* location data; Texas AG suit re: the Arity
  SDK) — do not conflate with user policing. `[MEDIUM-HIGH null · PRIMARY]`
- ⚠ **Verify verbatim before relying on exact wording** — Life360 legal pages were access-walled; text is
  reconstructed from snippets.

## Risk assessment (likelihood × severity)

| Outcome | Likelihood | Severity | Net |
|---|---|---|---|
| Generic "inaccurate/stale" badge (server distrusts the fix) | **HIGH** (documented default) | Low | Most likely, low harm |
| **Social tip-off** — teleport render / out-of-place alert / weird history spotted by a member | **MED-HIGH for a sloppy teleport**; Low if motion is smooth | Medium (cover blown, not account) | **Dominant real risk for spoof work** |
| API **request block** (Cloudflare 403/429) | **MED** if UA/TLS/cadence are wrong; **Low** for a urllib+app-UA+gentle client | Low-Med (Observer stalls, backs off) | Manage with UA/TLS/cadence + Retry-After |
| SMS 24 h verification lockout | Low (only if we re-request OTP) | Low (speed bump) | Avoid by not automating login |
| **Account soft-ban / lock / suspend** | **LOW** (never observed) | High (loss of the owner's real account) | Unlikely, non-zero, unverifiable |

## Safe operating rules (the checklist)

**For the Observer (API client):**
1. **Reuse the captured token; never automate login** (the SMS/OTP path 24 h-locks on over-request). `[PRIMARY]`
2. **Never log out** of the web session the token came from — the one confirmed revocation trigger. `[PRIMARY]`
3. Keep the **exact current Android UA** (`com.life360.android.safetymapd/KOKO/23.50.0 android/13`) and an
   **OpenSSL TLS stack** (the repo's stdlib `urllib` already qualifies) — the block keys on these. `[PRIMARY]`
4. **Poll gently: ≥ 15–30 s on the members endpoint; don't poll `/v4/circles` in the loop** (resolve the id
   once). The repo's current 4 s default is *faster* than even the 5 s reference — **widen it.** `[PRIMARY]`
5. **Honor `Retry-After` verbatim** and widen the interval after any 429 (don't resume the fast cadence).
   `client.py` already raises a clean error on 401/403/429 — add `Retry-After` parsing. `[PRIMARY-derived]`
6. Stay **read-only, own account, own circle**.

**For the teleport / flight-gap experiments:**
7. **Prefer realistic motion over teleports** — a smooth, plausible-speed approach is the difference between
   "invisible" and "a member sees the pin snap across the Atlantic." `[THIRD-PARTY, but the strongest tell]`
8. **Teleport only while no circle member is likely watching**, and be aware it stays in **2–30-day history**.
9. **Avoid crossing geofenced Places during a jump** (it fires alert pushes at implausible times) — except
   the *intended* CDG arrival, which should be a real drive-in, not a teleport (see
   `life360-geofence-arrival-mechanics.md`).
10. Keep experiments **low-volume** — repeated impossible-speed events are the pattern most likely to matter
    if any server-side heuristic exists.
11. The still-phone **motion contradiction** (moving GPS + "stationary" accelerometer) is the top *potential*
    iOS server-side tell — another reason to keep speeds believable and volume low.

## Implications for vida-360

1. **Bump the Observer's poll interval** (`LIFE360_OBSERVER.md` §6 / the tool default) from 4 s to **≥ 5 s,
   ideally 15–30 s**, and only poll the members endpoint in-loop — cheapest risk reduction available.
   *(Recommendation; code not touched here.)*
2. **Add `Retry-After` parsing** to `backend/life360/client.py`'s 429 path so backoff matches the server's
   actual number. *(Recommendation.)*
3. **Never log out** of the token's web session — bake this into the setup runbook.
4. **The account-ban risk is low but unproven — don't treat it as zero.** Keep teleport experiments
   low-volume and realistic; the *social* tip-off is the likelier failure than any ban.
5. This brief is the **server-side/account companion** to `life360-detection-and-realism.md` (client-side
   tells) — cross-read them; neither supersedes the other.

## Sources

**Primary — API client (integration maintainer + source + trackers):**
- Cloudflare blocking unofficial clients (identical requests rejected from HA, fine from app): https://community.home-assistant.io/t/life360-stop-working/597189/64 · TLS fingerprint / SSLContext fix: https://community.home-assistant.io/t/life360-device-tracker-platform/52406/2258 · https://github.com/pnbruckner/ha-life360/issues/82
- Token reuse still hits Cloudflare on read endpoints; urllib/Podman passes where HA fails: https://github.com/pnbruckner/ha-life360/issues/45
- Poll interval 5 s (source): https://raw.githubusercontent.com/pnbruckner/ha-life360/master/custom_components/life360/const.py · 429/Retry-After handling: https://raw.githubusercontent.com/pnbruckner/life360/master/life360/api.py · Circles is the hotspot: https://github.com/pnbruckner/ha-life360/blob/master/README.md · recent ~22.7 h members retry_after: https://github.com/pnbruckner/ha-life360/issues/93
- Don't log out (revocation trigger): https://github.com/pnbruckner/ha-life360/issues/41 · read-path breakage predates the breach (2024-02-03): https://github.com/home-assistant/core/issues/109506
- Token is opaque/not-JWT: https://github.com/kaylathedev/life360-node-api/blob/master/DISECTION.md

**Primary — breach / official:**
- 2024 breach (unauthenticated endpoint, name+phone only, scoped fix): https://www.bleepingcomputer.com/news/security/over-400-000-life360-user-phone-numbers-leaked-via-unsecured-android-api/ · https://haveibeenpwned.com/Breach/Life360 · https://salt.security/blog/another-api-security-breach-life360
- Life360 forced-reset = credential stuffing (not API enforcement): https://www.life360.com/blog/protecting-your-life360-account
- ToS (termination right; identity-scoped false-info clause): https://legal.corp.life360.com/hc/en-us/articles/36960351281431-Life360-Terms-of-Service-2025-2
- FTC Jan-2025 order (Life360 acted *against*, opposite direction): https://www.ftc.gov/news-events/news/press-releases/2025/01/
- SMS over-request → 24 h lockout: https://support.life360.com/hc/en-us/articles/23053429066647-Sign-In-Troubleshooting-Phone-Number

**Third-party — spoof detection / social tells / risk:**
- iOS has no mock-provider flag; behavioral detection only: https://deepidsdk.com/blog/gps-spoofing-detection
- Human-observable tells / teleport rendering: https://www.ifonetool.com/blog/change-location/how-to-tell-if-someone-is-faking-their-location-on-life360/ · https://www.imobie.com/location-change/how-to-fake-location-on-life360.htm
- No ban complaints found (BBB / ComplaintsBoard): https://www.bbb.org/us/ca/san-francisco/profile/internet-service/life360-life-360-1116-372634/complaints · https://www.complaintsboard.com/life360-b121652
- Vendor "cooldown timer" (implicit admission rapid teleport is renderable): https://www.tenorshare.com/change-location/is-ianygo-safe-review.html

**Cross-references (local):** `life360-detection-and-realism.md` (client-side tells — the companion),
`life360-notification-triggers.md`, `coremotion-injection-feasibility.md` (still-phone motion contradiction),
`life360-geofence-arrival-mechanics.md` (drive the CDG arrival in, don't teleport into it),
`LIFE360_OBSERVER.md` §6 (poll cadence to raise).
