# Spoof-methods survey — the adoptable menu (and where we sit)

> Research brief. Every realistic way to set/simulate an iPhone's location, judged against
> vida-360's fixed constraints: **owned device, iOS 26.6, no jailbreak, driven from Windows,
> Python-friendly.** Baseline = what we run today (pmd3 `--userspace` tunnel + DDI + DVT
> `simulate-location set/play`). Confidence marked; sources at end.

## Bottom line

1. **Our transport is already best-in-class for our constraints, and it's the same mechanism
   every serious tool uses.** On non-jailbroken iOS 17+, there is exactly **one** host-driven
   channel: Developer Mode + a personalized (TSS-signed) Developer Disk Image + the DVT
   `LocationSimulation` service over the iOS 17 RemoteXPC tunnel. pymobiledevice3, go-ios, every
   commercial desktop tool (AnyGo, iAnyGo, Dr.Fone, AnyTo, 3uTools, …), and even Appium all
   funnel through this. **Nobody has a secret better transport.** *(HIGH)*
2. **The one genuine peer is `go-ios`** — also speaks the iOS 17+ tunnel on Windows, has
   `setlocationgpx`. Not clearly better, and adopting it costs our Python-native adapter →
   **WATCH, not adopt.** *(HIGH it exists; MEDIUM its GPX route-*animation* is proven on a real
   iOS 17+ device.)*
3. **What commercial tools add is UX, not a better engine** — joystick, multi-stop routes, speed
   presets, cooldown timers, GPX export, pause/resume. All sit atop the same `set`/`play`
   primitives → **our build backlog, not reasons to switch.** *(HIGH)*
4. **Nothing no-jailbreak solves our two real gaps:** untethered/background/persistent spoofing
   (jailbreak-only; the commercial "stays after disconnect" is a frozen stale dot), and
   CoreMotion/activity spoofing (jailbreak-only — and there's no jailbreak for iOS 26.6). *(HIGH)*

## Comparison table

| Method | Mechanism | Windows | No-JB | iOS 17/26 | GPX/route | Adds over pmd3 | Adoptable? |
|---|---|---|---|---|---|---|---|
| **pymobiledevice3** *(us)* | DDI + DVT `LocationSimulation` over RemoteXPC tunnel; `set` (lat/lon) + `play <gpx>` + `clear`; userspace tunnel = **no admin** | ✅ | ✅ | ✅ (ref impl; confirmed iOS 26) | ✅ `play` (+ ±ms noise) | — baseline | **Keep** |
| **libimobiledevice / idevicesetlocation** | Legacy lockdownd `com.apple.dt.simulatelocation`; **no RemoteXPC in source** | ⚠ old build | ✅ | ❌ self-reports "not supported iOS 17+" | ❌ static only | nothing (regression) | **NO** |
| **go-ios** | Same DDI/tunnel; `setlocation`/`setlocationgpx`/`resetlocation`; `tunnel start` needs `sudo` + `wintun` | ✅ (wintun→elevation) | ✅ | ✅ | ✅ `setlocationgpx` (animation unverified) | single Go binary, HTTP tunnel API | **WATCH** |
| **idevice** (Rust) | RSD/RemoteXPC + DDI + `location_simulation`; research-stage | ❓ Unix-focused | ✅ | ✅ | ❓ | Rust; powers StikDebug | **WATCH (low)** |
| **Appium XCUITest** | Wraps the same DVT service; leans on pmd3/go-ios for the tunnel | heavy | ✅ | buggy on real iOS 17 | ❌ lat/lon only | nothing relevant | **NO** |
| **Commercial desktop** (AnyGo, iAnyGo, Dr.Fone, AnyTo, 3uTools, UltFone, LocaChange) | **Same** DDI + DVT + RemoteXPC (tells: Developer Mode, USB Trust, iOS 17 driver, revert-on-disconnect) | ✅ | ✅ | claimed (marketing; 3uTools broken 18+, Dr.Fone discontinued ~Aug 2024) | varies | joystick, multi-stop, speed presets, cooldown, GPX export, pause/resume | **NO as transport** (features = our backlog) |
| **Commercial on-device apps** (iAnyGo/iGo/AnyGo iOS) | On-device **VPN profile** MITMing Wi-Fi positioning; drops Dev Mode on 17.2+ | setup via PC | ✅ | claimed to 26 | some | no cable after setup | **REJECT** (spoofs Wi-Fi loc not GPS; not automatable) |
| **Jailbreak tweaks** (Relocate Reborn, LocationFaker) | On-device CoreLocation hook | host-irrelevant | ❌ | **no JB for 26.6** | scriptable | per-app; untethered; can hook CoreMotion | **NO (no JB exists)** |
| **SDR GPS broadcast** (HackRF + gps-sdr-sim) | Transmits real RF GPS L1; any receiver affected | agnostic | ✅ | ✅ | trajectories | fully external | **REJECT (illegal RF; receiver-agnostic; aviation risk)** |
| **Android mock location** *(note only)* | OS feature; ADB-drivable | ✅ | ✅ no root | (Android) | ✅ | far lower friction | **N/A (iPhone tool)** |

## Key details

- **libimobiledevice** can't reach DVT services on iOS 17+ (no RemoteXPC/RSD in its `src/`
  tree; its own maintainers point users to pymobiledevice3). v1.4.0 added DDI *mounting* but no
  tunnel. Windows builds wrap the old failing version. Adopting it = strict regression. *(HIGH)*
- **go-ios** is the real competitor and arguably ships releases as actively as pmd3 (v1.2.0,
  2026-06). Caveats: its Windows tunnel uses `wintun` (so **not** admin-free like our
  `--userspace` path), and there are reports of tunnel flakiness where pmd3 succeeded on the
  same device. Its `setlocationgpx` route *animation* on a real iOS 17+ device isn't
  independently confirmed. → **note it as the sanctioned fallback if pmd3 ever breaks.** *(MED)*
- **Commercial tools** all show the same DDI/DVT fingerprint (Dev Mode, USB Trust, iOS 17
  driver, revert-on-disconnect). "No jailbreak" and "iOS 26 support" are vendor marketing; the
  mechanism identity is inference from documented setup + the reference implementation. Their
  *features* (joystick, multi-stop, cooldown, pause/resume, export) are all buildable on
  `set`/`play`. *(HIGH mechanism class; MED-HIGH per-vendor.)*
- **No true untethered spoof:** the tunnel is a host-held session; kill it and simulation ends.
  "Stays after disconnect" = a frozen **stale dot** (a `cantfix` API artifact) that doesn't
  follow a route and clears on reboot; iOS 18+ resets it within minutes. *(HIGH)*
- **SDR** transmits in the GPS L1 restricted band — illegal open-air in the US (47 CFR §15.205;
  FCC jamming rules; the Newark Airport case shows a small GPS-band transmitter reaching
  safety-of-life systems). Receiver-agnostic, coarse, can't target one app/phone. **Reject.**
- **Android** mock location is a first-class OS feature (no root, ADB-drivable) — relevant only
  if we ever go cross-platform, and it doesn't solve the CoreMotion/activity problem either.

## Implications for vida-360

1. **Do not switch transports.** pmd3 is the reference impl of the only no-JB iOS 17+ mechanism,
   most actively maintained, confirmed on iOS 26, and its `--userspace` tunnel uniquely needs
   **no admin**. The AGENTS.md "pmd3 as transport" decision is externally corroborated.
2. **Our gaps are engine/UX gaps we own** — the market proves every missing feature is buildable
   on `set`/`play`. Confirms the MOVEMENT_ENGINE.md direction.
3. **Two hard limits are mechanism-inherent** — plan around them: tether/persistence (Phase C
   long-lived session is the right model; don't promise untethered) and CoreMotion/activity
   (the "driving/walking" emoji is motion-derived and not spoofable on a still phone — the key
   input to the Phase A gate).

## Recommendation

- **ADOPT now:** nothing new — stay on pmd3 `--userspace` + DDI + `set`/`play`.
- **WATCH:** **go-ios** (fallback if pmd3 breaks on a future iOS, or if a single Go binary
  becomes attractive — but it needs `wintun`/elevation and its route animation is unverified);
  lower priority `idevice` (Rust; Windows unproven). Track **iOS 18/26 detection hardening** —
  it threatens the whole DDI class, us included.
- **REJECT firmly:** libimobiledevice, Appium, SDR, jailbreak, on-device VPN apps, PGSharp
  (Android). Android mock location N/A unless cross-platform.

## Sources

- pmd3: https://github.com/doronz88/pymobiledevice3 · iOS17 tunnels: https://github.com/doronz88/pymobiledevice3/blob/master/docs/guides/ios17-tunnels.md · LocationSimulation source: https://github.com/doronz88/pymobiledevice3/blob/master/pymobiledevice3/services/dvt/instruments/location_simulation.py · tunneling: https://deepwiki.com/doronz88/pymobiledevice3/3-remote-access-and-tunneling-(ios-17+) · iOS 26 works: https://github.com/doronz88/pymobiledevice3/discussions/1463
- libimobiledevice idevicesetlocation.c (not supported 17+): https://github.com/libimobiledevice/libimobiledevice/blob/master/tools/idevicesetlocation.c · issue #1490: https://github.com/libimobiledevice/libimobiledevice/issues/1490
- go-ios README / releases / tunnel flakiness: https://github.com/danielpaulus/go-ios/blob/main/README.md · https://github.com/danielpaulus/go-ios/releases · https://github.com/danielpaulus/go-ios/issues/413
- idevice (Rust): https://github.com/jkcoxson/idevice · GeoPort (pmd3 GUI): https://github.com/davesc63/GeoPort · Appium #20403: https://github.com/appium/appium/issues/20403
- Frozen-point `cantfix` artifact: https://github.com/Schlaubischlump/LocationSimulator/issues/127 · iOS 17 not supported: https://github.com/Schlaubischlump/LocationSimulator/issues/171
- Commercial (vendor, labeled): https://itoolab.com/support/technical-faqs/anygo/ · https://www.tenorshare.com/ianygo-ios-app-users-guide.html · https://www.locachange.com/guide/ · Dr.Fone discontinued (independent): https://itoolab.com/tips/wondershare-dr-fone-virtual-location-review/ · 3uTools dead 18+ / iOS18 Error 12: https://www.imobie.com/location-change/3utools-location-changer.htm · https://cybernews.com/how-to-use-vpn/change-your-location-on-pokemon-go/
- Jailbreak scope: https://github.com/JonathanSeals/locationfaker · https://onejailbreak.com/blog/checkm8/ · https://github.com/palera1n/palera1n
- SDR + legality: https://github.com/osqzss/gps-sdr-sim · https://www.fcc.gov/general/jammer-enforcement · https://www.law.cornell.edu/cfr/text/47/15.205 · https://transition.fcc.gov/eb/Orders/2013/FCC-13-106A1.html
- Android mock location: https://www.ninjaone.com/blog/what-android-mock-location-is/ · https://github.com/amotzte/android-mock-location-for-development
