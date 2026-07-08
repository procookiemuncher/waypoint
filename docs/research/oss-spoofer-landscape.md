# OSS spoofer landscape — what others built, and did anyone do Find My + Life360?

> Research brief (heavy open-source emphasis). Question: has anyone built an OSS spoofer that
> demonstrably works on **Find My AND Life360**, what have people actually triggered, and how
> does the anti-spoof arms race look? Confidence marked; anecdote vs. verified labeled; sources
> at end. Companion to spoof-methods-survey.md.

## Bottom line

The entire serious no-jailbreak iOS-17+ OSS ecosystem rides the **exact rails vida-360 already
uses** — Apple's `DVTSimulateLocation` over the RemoteXPC tunnel, with **pymobiledevice3 as the
near-universal backend**. Because the injection is at CoreLocation, **every** app sees the fake
fix — which is *why* Find My and Life360 both move (it's the mechanism, not app-specific
cleverness). One OSS project (**iphonespoofer**) names Find My *and* Life360 explicitly,
corroborating our dual-app result. But **nobody has published a believable-*movement* Life360
result with triggered notifications** — the field tops out at "teleport the pin, add a joystick,
maybe follow an OSRM road at constant speed." vida-360's realism engine (jerk-limited S-curves,
per-mode speed, acceleration-gated validation, flight-gap) is **ahead of the published OSS state
of the art**; the arrival-notification objective has **no prior art to copy**.

## OSS projects

| Repo | OS | iOS 17+/26? | Find My / Life360 named? | Backend | Notes | Maintained |
|---|---|---|---|---|---|---|
| **pymobiledevice3** (doronz88) | Win/mac/Linux | **Yes, 26 confirmed** | system-wide (implied) | — (is the reference impl) | `simulate-location set/play`; maintainer "still works" on iOS 26. **Our transport.** | Very active |
| **locwarp** (keezxc1223) | **Windows** | Yes (26.4/18.7/17.6) | not named | pmd3 + OSRM | **Closest analog to us:** 6 move modes incl. joystick, route-loop w/ random pauses, random-walk, dual-device. Same stack + OS. | Active |
| **iphonespoofer** (gabrielvuksani) | mac/Win | Yes (17+/18+) | **Find My + Life360 explicit** | pmd3 + Flask + OSRM | Joystick, wander, GPX, scheduled teleport, **anti-detection guide** (jitter 1–5 m, IP/GPS + timezone warnings). | Active |
| **Location-Simulator** (lvalen91) | macOS | Yes (17+) | not named | Swift UI + **persistent DVT daemon** | Route nav, transport modes at set speed. The `location_daemon.py` is a working **long-lived session** (our Phase C pattern). | Active |
| **GeoPort** (davesc63) | Win/Mac | 17 & 18 | not named | pmd3 + Flask | Teleport-class; heavily forked. Good Python/Flask+pmd3 scaffolding. | Active-ish |
| **SimVirtualLocation** (nexron171) | macOS | 17+ | not named | pmd3 + sim tool | Two-point route at desired speed; iOS + Android. | Semi-active |
| **go-ios** (danielpaulus) | Win/mac/Linux | Yes | not named | native Go RemoteXPC | Only non-pmd3 peer; `setlocationgpx`. Windows needs sudo + wintun (lacks our `--userspace` edge). | Very active |
| **LocationSimulator** (Schlaubischlump) | macOS | Partial (17 needs pre-mounted DDI) | not named | idevice/MobileDevice | Most-cited mac spoofer historically; iOS 17 stalled. | Stale |
| **iFakeLocation** (master131) | Win/mac/Linux | **No** (pre-17) | not named | legacy DDI | Died to the iOS 17 personalized-DDI change. | Abandoned |
| **pyioslocationsimulator** (FButros) | Win/mac | 17 (static) | not named | pmd3 + Tkinter | Static set only. | Inactive |
| Relocate Reborn / LocationFaker (JB tweaks) | on-device (JB) | **No** (≤iOS 15) | Find My (system-wide) | CoreLocation hook | JB comparison only; no JB for iOS 26.6. | JB-era |
| GPS JoyStick (Android) | Android | N/A | Life360 (widely used) | Android mock provider | Different platform + detection model (`isFromMockProvider`). | Active |

**Cross-cutting facts (HIGH):**
- **pymobiledevice3 is the monoculture backend** — locwarp, GeoPort, iphonespoofer,
  SimVirtualLocation, pyioslocationsimulator, kinesis, (indirectly) lvalen91 all wrap it; go-ios
  is the only independent reimplementation. This validates AGENTS.md's transport choice.
- **The spoof is system-wide by construction** — all inject at CoreLocation, so every app moves.
- **Windows + no-admin is rare** — only locwarp/GeoPort/iphonespoofer target Windows; go-ios needs
  elevation + wintun. vida-360's `--userspace` (no admin) is an edge even locwarp doesn't
  advertise.

## Find My + Life360 — does anything confirm both?

**Yes.** `iphonespoofer`'s README states verbatim it "Works with all apps — Find My, Life360,
Pokemon Go, Maps, Uber…" because "Every app reads from the same CoreLocation framework." That's a
pmd3-backed iOS-17+ project on our stack naming **both** targets — direct corroboration of our own
confirmed dual-app result. Consumer guides likewise warn to avoid running Find My/Life360 while
spoofing (i.e. they treat both as affected at once). *(HIGH the mechanism guarantees it; MEDIUM
the guide sources.)*

## What have people actually triggered?

Honest finding: **the OSS community documents moving-the-pin, not notification-triggering.** No
repo/issue/thread found claims "I fired Life360's *arrived at X* / driving emoji / airport push
via a spoof." What exists:
- **Place arrival/leave alerts** *do* fire on a spoofed pin crossing a saved Place (anecdotal,
  from anti-spoof guides noting "members get unexpected arrival/departure alerts"). Matches our
  plan. *(MEDIUM, anecdotal.)*
- **Driving/walking emoji** — no OSS reproduction found; the drive *reports* are Arity/CoreMotion
  and unspoofable, consistent with our scoping. The lighter *movement emoji* being speed-derived
  is our own open hypothesis — **nobody has published a confirm/deny**, so it stays a Phase A
  test, not solved prior art.
- **Airport "landed"** — no reproduction found; consistent with our "not reachable via lat/lon"
  conclusion.

⟹ On triggered *notifications*, vida-360's goal is **more ambitious than any published OSS
result** — we're at the frontier, not behind it.

## Anti-spoof arms race (the risk model)

- **`isSimulatedBySoftware` (HIGH, decisive):** iOS 15+ exposes `CLLocation.sourceInformation`
  with this flag. A community iOS-virtual-location-detection writeup (darkjoin) shows **Xcode's
  DVT location sim sets it `true`** and treats Xcode-sim / consumer tools as an indistinguishable
  fingerprint. Since pmd3 drives the **same DVT service**, the prior is that **our path likely
  reads `true`** — but no source empirically tested the pmd3 path, so it's still an untested gate.
  **Upside:** detection requires the app to *read* the flag, and our confirmed result (the spoof
  shows on Life360) proves Life360 does **not** hard-block on it today. The risk is **latent**
  (one app-update away), not active. → Phase A gate #0.
- **Android ≠ iOS (HIGH):** the widely-repeated "Life360 detects the mock-location setting" claim
  is the **Android** mechanism (`isFromMockProvider` + "select mock location app"). It does **not**
  apply to our iOS DVT path — the only iOS tell is `isSimulatedBySoftware`. Don't let Android FUD
  into the iOS risk model.
- **Behavioral tells people report (MEDIUM)** — and how our engine already answers each:
  impossible-speed/teleport → our >53.6 m/s hard-fail; straight lines through buildings → Valhalla
  road-snapping (Inc 2); no GPS jitter / frozen pin → perpendicular-biased jitter; **cross-app
  disagreement → N/A for us (CoreLocation keeps all apps consistent — a strength)**; battery pegged
  / "arrived with no drive" → a real behavioral tell we can't fully close (drive detection is
  CoreMotion), mitigated by scoping to geofence arrival not "I drove here."
- **No "spoofing detected" banner (MEDIUM→likely no):** sources agree Life360 shows no in-app
  "member may be faking" alert; symptoms are silent flagging or a "location paused/GPS off" status.
- **Platform hardening (HIGH, standing risk):** iOS 18/26 keeps tightening the DDI/DVT class
  (killed LocationSimulator + iFakeLocation at iOS 17). Threatens every tool, us included.

## State of the art vs. vida-360

**Where we lead:** movement realism (no OSS ships an acceleration-gated, jerk-limited renderer +
two-tier validator — the field is "OSRM polyline at constant speed + joystick"); the
arrival-notification objective (no prior art); the no-admin `--userspace` Windows path; honest
scoping of the unspoofable CoreMotion set.

**Where others are ahead — worth borrowing:**
1. **Shipped route/joystick UX — `locwarp`** (Windows + pmd3 + OSRM + 6 move modes). Borrow the
   **route-loop-with-random-pauses** and **random-walk-within-radius** modes (cheap realism) and
   the **joystick** for live control.
2. **Persistent-session pattern, already solved — `lvalen91/location_daemon.py`** and
   **iphonespoofer's** long-running backend are working examples of the **long-lived DVT session**
   we flagged for Phase C. Read them before building ours.
3. **Anti-detection UX — `iphonespoofer`** ships IP-vs-GPS and timezone-mismatch warnings; mirror
   those in our status panel (IP is our one silent server-side tell).

**Method note / limitation:** Reddit (r/Life360, r/jailbreak) was un-fetchable for the research
crawler, so community claims are paraphrased through third-party pages and rated LOW/MEDIUM.
GitHub repos/issues and Apple/Life360/Arity docs are HIGH; SEO/vendor blogs MEDIUM at best.

## Sources

pymobiledevice3 https://github.com/doronz88/pymobiledevice3 · disc #1463 (iOS 26 works) https://github.com/doronz88/pymobiledevice3/discussions/1463
locwarp https://github.com/keezxc1223/locwarp · iphonespoofer https://github.com/gabrielvuksani/iphonespoofer · Location-Simulator (lvalen91) https://github.com/lvalen91/Location-Simulator · GeoPort https://github.com/davesc63/GeoPort · SimVirtualLocation https://github.com/nexron171/SimVirtualLocation · go-ios https://github.com/danielpaulus/go-ios · LocationSimulator https://github.com/Schlaubischlump/LocationSimulator (iOS17 #171 https://github.com/Schlaubischlump/LocationSimulator/issues/171) · iFakeLocation https://github.com/master131/iFakeLocation · pyioslocationsimulator https://github.com/FButros/pyioslocationsimulator
Relocate Reborn https://onejailbreak.com/blog/relocate-reborn/ · GPS JoyStick https://play.google.com/store/apps/details?id=com.theappninjas.fakegpsjoystick
isSimulatedBySoftware https://developer.apple.com/forums/thread/120491 · darkjoin detection writeup https://github.com/darkjoin/Learning/blob/master/sources/iOS%E8%99%9A%E6%8B%9F%E5%AE%9A%E4%BD%8D%E6%A3%80%E6%B5%8B.md · dev.to mocking-GPS guide https://dev.to/arshtechpro/mocking-gps-location-in-ios-a-simple-guide-51e
Life360 Drive Detection (Arity/CoreMotion) https://support.life360.com/hc/en-us/articles/23053499870487-Drive-Detection-Analysis · Arity https://support.life360.com/hc/en-us/articles/23053397958551-Arity
Behavioral tells (anecdotal) https://www.ifonetool.com/blog/change-location/how-to-tell-if-someone-is-faking-their-location-on-life360/ · https://www.imobie.com/location-change/how-to-fake-location-on-life360.htm
