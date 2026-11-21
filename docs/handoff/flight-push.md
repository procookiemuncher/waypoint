# Handoff: get Life360's "landed" flight push (2026-11-21)

Paste into a fresh session: **"Read docs/handoff/flight-push.md and do what it says."**

## Read first

CLAUDE.md says: **AGENTS.md**, then **PROGRESS.md**. Then, for this job:

- `docs/research/life360-flight-detection.md`: §1 (the trigger list), §3, §5 + **§5b** (the test recipe and how to make a "no push" mean something).
- `docs/research/life360-account-safety-detection.md` → "Safe operating rules".
- `docs/research/no-xcode-speed-sim.md` (CoreDevice shapes, "Opening a URL").
- `docs/superpowers/specs/2026-07-10-flight-arrival-spoofer-design.md` (Step 0 status).
- `docs/LIFE360_OBSERVER.md` + `docs/OBSERVER_SETUP_AT_HOME.md` (the read-only API client).

## The goal (owner's pick, 2026-11-21)

Life360 **Flight Detection's "landed" push** to the circle. Not the geofence "arrived at <Place>"
(that's the fallback, below). Life360's own trigger list: a ping **within 100 m of an airport**,
speed **over 100 mph**, **airplane mode on** during the flight and **off** after, a **second airport
within 24 h**. It also uses altitude, which we can't inject. Whether altitude is a hard gate is the
open question (`flight-altitude-hard-gate`). Nobody has publicly spoofed this push.

## What's true now (all of it from 2026-11-21 unless dated)

- **Airplane mode toggles over pmd3, Mac + Windows.** `CoreDevice.airplane(on)` in `core/backend/device.py`
  runs the phone's `vida-airplane-on/off` Shortcuts. It uses CoreDevice `launchapplication` with
  `options.payloadURL`, and success means "sent", not "toggled". `fly airplane on|off` does it from a
  terminal. Checked 3 on/off runs on the owner's phone (iOS 27.2.1).
- **Over the cable the phone stays reachable in airplane mode** (new tunnels ~0.23 s). Not tested:
  whether a hold that's already running keeps the spoof through the toggle.
- **`fly nyc` can't trigger the flight push.** Its drives and holds are pmd3's DVT sim, which reports
  speed −1, so the >100 mph gate can never pass. The flight test has to use the **CoreDevice** sim
  (`CoreDevice.set_cmd/route_cmd/clear_cmd`, `backend/drive.py`). It carries a real speed, and its
  `setsimulatedlocation` holds phone-side with no process, so there are no gaps. On the Mac
  (2026-10-24, devicectl, same service) a location set while offline held.
- **pmd3 can screenshot the phone** (`developer core-device screen-capture screenshot`,
  `developer dvt screenshot`; the phone advertises `capturescreenshot`). Not tried on iOS 27.2.1 yet.
  It could let the agent check airplane mode, Maps or the Life360 app itself.
- **The Observer can't see pushes.** It reads the server's view of a member (position, speed,
  isDriving, Place, last update). It has no altitude, no flight field, no notifications endpoint. This
  Windows PC has **no `.env`**. The token is either in the Mac's `.env` or comes fresh from Method A
  in OBSERVER_SETUP_AT_HOME.md. **The owner puts the token in `.env` themselves, never in chat. Never
  print it.** Always read with `--member <the owner>` so the rest of the circle isn't printed. Poll no
  faster than 4 s.
- Tests: **91 run, 10 skipped** (`.venv/Scripts/python.exe -m unittest discover -s core/tests`, or
  `.venv/bin/python` on the Mac).
- Windows: usbmuxd only runs once the Apple Devices app has started it, and a phone plugged in before
  that needs a replug.

## Devices

- **Owner's phone** (iPhone19,3, iOS 27.2.1): anything on it moves their pin or toggles airplane mode
  **in front of their real circle**. **Ask before every on-device action**, screenshots included. When
  the owner is away, don't touch it at all.
- **Spare iPhone** (owner has one, Lightning cable, which is fine). It's not set up yet. To be the
  "traveler" it needs:
  - **iOS 17+** (iPhone XS/XR or newer). iOS 16 and older has no CoreDevice, so there's no speed path.
  - Developer Mode on, this computer trusted.
  - The two Shortcuts made on it: `vida-airplane-on` (Airplane Mode on + Wi-Fi off) and
    `vida-airplane-off` (the reverse).
  - A **test Life360 account**, which needs its own phone number for the SMS sign-up.
  - A **separate test circle** with the owner's real account as the observer, Flight Detection on.
    The owner's phone gets the push, and the owner's real circle never sees the test account.
  - Ask the owner what may run on it unattended.
- An observer the agent can read itself (an Android phone, or an emulator via `adb shell dumpsys
  notification`) was offered. The owner hasn't set one up. Life360 may refuse emulators.

## Work, in order (offline while the owner is away)

1. **Static analysis of Life360's Android app.** Owner OK'd it 2026-11-21, knowing Life360's terms
   likely forbid reverse engineering.
   - Get the APK from a reputable mirror (APKMirror) into its own empty directory and note its
     version + sha256. **Never install or run it.** Decompile statically (jadx) and keep any scripts
     outside that directory.
   - Answer:
     - Is flight detection on the phone or on the server?
     - Which signals does it use: altitude (GPS `getAltitude`/vertical accuracy or barometer), speed
       source, an airport dataset (and which), how airplane mode / reconnect is detected?
     - Thresholds and timings.
     - What the location upload carries: does it even send altitude?
   - The iOS app is encrypted and may differ. Say what carries over and what's inference.
   - Write it up as a dated update block in `life360-flight-detection.md` (prose kept, frontmatter
     bumped).
   - This is research only. Don't build anything that writes to Life360's servers. Path B (API
     injection) is out unless the owner decides it.
1b. **Can the CoreDevice sim take altitude?** If yes, the altitude gate stops being a wall. The DDI
   pmd3 mounts is cached at `~/.pymobiledevice3/Xcode_iOS_DDI_Personalized/Image.dmg` (also
   `Xcode_iOS_DDI_Cryptex/`). Both hold `usr/libexec/dtlocationd` (~333 KB) and
   `Library/LaunchDaemons/com.apple.coredevice.dtlocationd.plist`, the phone-side service behind
   `com.apple.coredevice.locationservice` (listed 2026-11-21).
   - Extract it: **7-Zip on Windows reads these APFS images** (`7z x Image.dmg usr/libexec/dtlocationd`
     into a new empty directory, confirmed with `7z l`); `hdiutil attach` on the Mac. `strings.exe` is
     at `C:\msys64\ucrt64\bin`. The binary is arm64, so Ghidra for anything past strings.
   - Read its strings, symbols and Swift types (Ghidra or `strings`/`nm`) for every key the
     set/start/scenario actions decode: altitude, verticalAccuracy, course, timestamp, a scenario
     file or plist payload.
   - The 2026-10-24 note found "altitude" nowhere in devicectl/CoreDevice on the Mac. That was the
     host side. The phone-side daemon hasn't been checked. Same for `setlocationscenario`: can it
     take a scenario's contents, not just a name or path? (Apple's scenario plists are full keyed
     CLLocations with Altitude.)
   - If a key turns up, testing it needs a phone. Write it down with the exact input shape.
2. **The flight-test tool.** Design it from §5/§5b, adjusted by step 1's findings. CoreDevice only:
   - hold within 100 m of the airport A terminal, 20–40 min of dwell, online;
   - taxi, then a takeoff roll along a **real runway** (coordinates from OSM/Overpass, not memory) to
     ~75 m/s, staying >100 mph while still online;
   - airplane ON (`CoreDevice.airplane`, owner confirms, by hand if not);
   - offline: hold within 100 m of airport B;
   - airplane OFF when the owner says land;
   - hold 10+ min, then clear.
   
   Default flight **MIA → MCO** (≈1 h gap, what §5b suggests). Same rules as `fly`: ENTER-gated
   toggles, confirm prompt, manual fallback, Ctrl+C clears. All transport goes through `device.py`, no
   pmd3 types above it. A dry run must touch nothing (`VIDA_DRY_RUN=1`, check it end to end with
   piped answers). Write tests.
   - Optional, needs the owner on the phone: a Shortcut that reports the phone's own altitude/speed
     (§5b.4), run through `CoreDevice.open_url`.
3. **Fallback prep:** an "arrived at <airport>" geofence trip. Drive (CoreDevice, real speed) into a
   saved airport Place and dwell. Dry runs + tests only.
4. When the owner is back:
   - set up the spare iPhone (above) and the Observer token;
   - do a positive control (§5b.1);
   - run the flight on the **spare**, with the owner's OK, at most a couple of fake flights a week per
     account.

## Rules

- Small, human-sounding, signed commits as `juanmendoza` (AGENTS.md → Git), pushed as you go.
  **On the Mac that git identity isn't set up yet: tell the owner before committing there.**
- **No release** until the owner says so.
- Don't upgrade pmd3 (11.59.0) unless it's the only way. If you do, re-pin exactly and note that the
  Mac Nuitka build check (`release/build.command`) needs rerunning.
- UI checks with `VIDA_DRY_RUN=1`.
- Keep docs true as you go: PROGRESS.md entry + "Current state", AGENTS.md as current fact,
  ROADMAP.md path 4, research frontmatter (`status`, `device_verified`, `last_verified`).
- Untrusted downloads go in their own new directory. Run Python that reads them with `-I`.
