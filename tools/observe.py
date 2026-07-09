"""Life360 Observer CLI — read what Life360's servers currently report about your circle.

Read-only — it never writes anything to Life360. Modes:
  - one-shot (default): print each member's current state once and exit.
  - --watch:            poll on an interval and print a timestamped line per sample.
  - --log FILE:         also append every sample to FILE as JSONL (for offline correlation
                        against a played route GPX — see tools/correlate.py, docs §7).

    .venv\\Scripts\\python.exe tools\\observe.py                        # one-shot, all members
    .venv\\Scripts\\python.exe tools\\observe.py --member Juan           # one-shot, just Juan
    .venv\\Scripts\\python.exe tools\\observe.py --watch --member Juan   # live tail
    .venv\\Scripts\\python.exe tools\\observe.py --watch --log run.jsonl # tail + record

Credentials come from .env (gitignored): LIFE360_TOKEN (preferred; required for passwordless
phone+SMS accounts) or LIFE360_USER / LIFE360_PASS. See docs/LIFE360_OBSERVER.md +
docs/OBSERVER_SETUP_AT_HOME.md.
"""
import argparse
import dataclasses
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)                       # make `backend` importable

from backend.life360 import Life360Client, Life360Error  # noqa: E402

_MAX_BACKOFF_S = 60.0


def load_env(path):
    """Minimal .env reader (no dependency). KEY=value per line; # comments and blanks ignored;
    surrounding quotes stripped. Does NOT overwrite vars already set in the real environment."""
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key, val = key.strip(), val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val


def setup_client(token, user, password):
    """Return an authenticated Life360Client (token preferred, else username/password)."""
    client = Life360Client()
    if token:
        print("> Using LIFE360_TOKEN from .env...")
        client.use_token(token)
    else:
        print("> Authenticating with Life360 (username/password)...")
        client.authenticate(user, password)
    return client


def collect(client, circles, needle):
    """One tick: return [(circle_name, MemberState)] across all circles, filtered by `needle`."""
    rows = []
    for cid, cname in circles:
        for m in client.members(cid):
            if needle and needle not in m.name.lower():
                continue
            rows.append((cname, m))
    return rows


def log_record(logf, circle, m):
    """Append one MemberState to the JSONL log (+ an ISO timestamp and its circle)."""
    rec = {"iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(m.fetched_ts)),
           "circle": circle}
    rec.update(dataclasses.asdict(m))
    logf.write(json.dumps(rec) + "\n")
    logf.flush()


def run_once(client, circles, needle, logf):
    """Print each matching member's current state, grouped by circle. Returns count shown."""
    shown = 0
    for cid, cname in circles:
        members = client.members(cid)
        if needle:
            members = [m for m in members if needle in m.name.lower()]
        if not members:
            continue
        print(f"\n  Circle: {cname}")
        for m in members:
            print(f"   - {m.oneline()}")
            if logf:
                log_record(logf, cname, m)
            shown += 1
    return shown


def watch(client, circles, needle, interval, logf):
    """Poll every `interval` seconds, printing a timestamped line per sample. Survives transient
    errors with exponential backoff (cap 60s). Ctrl+C to stop."""
    dest = " (logging to file)" if logf else ""
    print(f"\n> Watching every {interval:g}s{dest}. Press Ctrl+C to stop.\n")
    backoff = interval
    while True:
        try:
            rows = collect(client, circles, needle)
            ts = time.strftime("%H:%M:%S")
            if not rows:
                print(f"{ts}  (no matching members)")
            for cname, m in rows:
                print(f"{ts}  {m.oneline()}")
                if logf:
                    log_record(logf, cname, m)
            backoff = interval
        except Life360Error as e:
            print(f"!  {e}  (retrying in {backoff:g}s)")
            time.sleep(backoff)
            backoff = min(backoff * 2, _MAX_BACKOFF_S)
            continue
        time.sleep(interval)


def main():
    ap = argparse.ArgumentParser(description="Read current Life360 state for your circle (read-only).")
    ap.add_argument("--member", help="only show members whose name contains this (case-insensitive)")
    ap.add_argument("--watch", action="store_true", help="poll continuously instead of once")
    ap.add_argument("--interval", type=float, default=4.0,
                    help="seconds between polls in --watch mode (default 4; be gentle, Life360 "
                         "updates coarsely and may rate-limit)")
    ap.add_argument("--log", help="append every sample to this file as JSONL")
    ap.add_argument("--env", default=os.path.join(ROOT, ".env"), help="path to the .env file")
    ap.add_argument("--check", action="store_true",
                    help="show which credentials were loaded (password masked) and exit")
    args = ap.parse_args()

    load_env(args.env)
    token = os.environ.get("LIFE360_TOKEN")
    user = os.environ.get("LIFE360_USER")
    password = os.environ.get("LIFE360_PASS")

    if args.check:
        exists = "exists" if os.path.exists(args.env) else "MISSING"
        print(f"env file:     {args.env} ({exists})")
        if token:
            print(f"LIFE360_TOKEN: <{len(token)} chars> (present - used first; user/pass ignored)")
        else:
            print("LIFE360_TOKEN: <not set>")
        print(f"LIFE360_USER: {user!r}")
        if password:
            flags = []
            if password != password.strip():
                flags.append("surrounding whitespace")
            if password[0] in "\"'" or password[-1] in "\"'":
                flags.append("surrounding quotes")
            warn = f"  [WARNING: {', '.join(flags)}]" if flags else ""
            print(f"LIFE360_PASS: <{len(password)} chars>{warn}")
        else:
            print("LIFE360_PASS: <not set>")
        print("\n(username shown in full so you can spot typos; password only as a length.)")
        return

    if not token and not (user and password):
        print("! No Life360 credentials found.")
        print("  Passwordless (phone + SMS) account? Obtain an access token and set LIFE360_TOKEN")
        print("  in .env (see docs/LIFE360_OBSERVER.md 3). Otherwise set LIFE360_USER/LIFE360_PASS.")
        print("  (.env is gitignored - nothing sensitive touches the repo.)")
        sys.exit(2)

    needle = args.member.lower() if args.member else None
    logf = open(args.log, "a", encoding="utf-8") if args.log else None
    try:
        client = setup_client(token, user, password)
        circles = client.circles()
        if not circles:
            print("  authenticated, but this account is in no circles.")
            return

        if args.watch:
            watch(client, circles, needle, args.interval, logf)
        else:
            shown = run_once(client, circles, needle, logf)
            if shown == 0:
                who = f" matching '{args.member}'" if args.member else ""
                print(f"\n  No members{who} found.")
    except Life360Error as e:
        print(f"! {e}")
        sys.exit(1)
    finally:
        if logf:
            logf.close()


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print("\n> Cancelled.")
