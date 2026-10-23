# Life360 Observer — setup runbook (do this at home)

> **Goal:** get the Observer (`core/tools/observe.py`) to print your live Life360 data. Your account is
> **passwordless** (phone + SMS, no password), so we can't log in with a password — instead we grab a
> **bearer token** once from a session you control and paste it into `.env`. No new SMS codes are
> requested, so there's **no 24-hour lockout risk.**
>
> Follow the steps top to bottom. Total time ~15 minutes. You only do this once — the token is
> long-lived. Background/why: `docs/LIFE360_OBSERVER.md` §3.

---

## Before you start
- PC and iPhone on the **same Wi-Fi** (needed for the proxy method).
- The repo's `.venv` set up (it already is).
- ~15 minutes.

---

## Step 0 — (optional, 30 seconds) quick "maybe I do have a password" test
You mentioned you have an email + password. A password login sends **no SMS**, so trying costs
nothing. If it works, you can skip the whole token dance.

1. Open `.env` in the repo root. Set:
   ```
   LIFE360_USER=your-life360-email
   LIFE360_PASS=your-password
   ```
   (Leave `LIFE360_TOKEN` blank.)
2. Run:
   ```
   .venv\Scripts\python.exe core\tools\observe.py
   ```
3. **If it prints your location → you're done.** Skip to "Confirm it works" at the bottom.
   **If it says `403 Invalid login and password` → your account is passwordless.** Continue to Step 1.

---

## Get a token — pick ONE of the two methods below

### Method A — Web login + DevTools (try this first; no installs)

1. On your PC, open a browser and go to **https://life360.com** and log in.
   (You'll get **one** SMS code — that's fine, one code is not a problem.)
2. Press **F12** to open Developer Tools → click the **Network** tab.
3. Refresh the page (F5) so requests appear.
4. In the Network list, click any request going to `life360.com` or `api-cloudfront.life360.com`.
5. Look in **Headers → Request Headers** for a line like:
   ```
   Authorization: Bearer eyJhbGciOi..............
   ```
6. Copy **everything after `Bearer `** (the long `eyJ...` string).
7. Open `.env` and paste it:
   ```
   LIFE360_TOKEN=eyJhbGciOi..............
   ```
   Leave `LIFE360_USER` / `LIFE360_PASS` blank.
8. Skip to "Confirm it works."

> If you don't see any `Authorization: Bearer` header on the website, the web app doesn't expose it —
> use **Method B**.

### Method B — mitmproxy capture from the app (reliable, always works)

**B1. Install + run mitmproxy on the PC**
- Download the standalone binary from **https://mitmproxy.org** (or `pip install mitmproxy`).
- Run:
  ```
  mitmweb
  ```
  This starts the proxy on port **8080** and opens a web UI in your browser.
- Find your PC's Wi-Fi IP address: open a terminal, run `ipconfig`, note the **IPv4 Address**
  (looks like `192.168.x.x`).

**B2. Point the iPhone at the proxy**
- iPhone → **Settings → Wi-Fi → tap the (i)** next to your network.
- Scroll to **Configure Proxy → Manual**.
  - **Server:** your PC's IPv4 address (from B1)
  - **Port:** `8080`
- Save.

**B3. Trust the mitmproxy certificate (so it can read HTTPS)**
- On the iPhone, open **Safari** and go to **http://mitm.it**
- Tap to download the **iOS / Apple** certificate → **Allow**.
- **Settings → General → VPN & Device Management** → tap the **mitmproxy** profile → **Install**
  (enter your passcode).
- **Settings → General → About → Certificate Trust Settings** → turn **ON** full trust for
  **mitmproxy**.

**B4. Capture the token**
- Open the **Life360 app** on the iPhone. Pull down to refresh / tap around the map so it makes
  network calls.
- In the **mitmweb** browser UI on your PC, type this in the filter box to narrow results:
  ```
  api-cloudfront.life360.com
  ```
- Click one of those requests → look at the **Request** headers for:
  ```
  authorization: Bearer eyJhbGciOi..............
  ```
- Copy **everything after `Bearer `**.

**B5. Paste it into `.env`**
```
LIFE360_TOKEN=eyJhbGciOi..............
```
Leave `LIFE360_USER` / `LIFE360_PASS` blank.

**B6. Undo the proxy (important)**
- iPhone → **Settings → Wi-Fi → (i) → Configure Proxy → Off.**
- Optional: remove the cert at **Settings → General → VPN & Device Management → mitmproxy → Remove**.
- Your phone is back to normal. (Leaving the proxy on would route all your phone traffic through the
  PC — don't forget this step.)

---

## Confirm it works

1. Sanity-check what `.env` loaded (nothing secret is printed — password/token show only as a length):
   ```
   .venv\Scripts\python.exe core\tools\observe.py --check
   ```
   You want to see `LIFE360_TOKEN: <NNN chars> (present ...)`.
2. Run the real thing:
   ```
   .venv\Scripts\python.exe core\tools\observe.py
   ```
   You should see something like:
   ```
   > Using LIFE360_TOKEN from .env...

     Circle: Family
      - Juan | 25.79031,-80.25010 | speed 0.0 | driving=no | batt 82% | wifi on | acc 10m
   ```
3. To watch just yourself: `.venv\Scripts\python.exe core\tools\observe.py --member Juan`

---

## Two things to report back to me
1. **Does it print your real location?** (confirms the token + reads work)
2. **What does `speed` read while you're actually moving?** (confirms whether it's mph — the one
   unknown). Easiest: run it while driving, or during an `emoji-test` spoof where we know the speed.

Then I'll build **Increment 2** (the watch loop + JSONL logging) so we can run the driving-emoji A/B
with real numbers instead of eyeballing the app.

---

## Troubleshooting
- **`403` again with the token** → the token was copied incompletely (grab the *entire* `eyJ...`
  string) or it expired (repeat the capture). Make sure you didn't include the word `Bearer` itself.
- **`No Life360 credentials found`** → `.env` has no `LIFE360_TOKEN` and no user/pass; check for typos
  in the key name.
- **mitm.it shows "traffic not passing through mitmproxy"** → the iPhone Wi-Fi proxy (B2) isn't set
  or points at the wrong IP/port.
- **Rate-limited (`429`)** → you're polling too often; for the one-shot read this shouldn't happen.
- **Life360 app acts weird after** → you left the Wi-Fi proxy on (B6) — turn it Off.
