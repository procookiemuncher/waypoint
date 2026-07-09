"""Life360 Observer CLI — read what Life360's servers currently report about your circle.

Increment 1: one-shot read. Logs into YOUR Life360 account (creds from .env), lists your circles,
and prints each member's current server-side state (location, speed, isDriving, battery, wifi).
Read-only — it never writes anything to Life360. Watch/log modes land in Increment 2.

    .venv\\Scripts\\python.exe tools\\observe.py                 # all members, all circles
    .venv\\Scripts\\python.exe tools\\observe.py --member Juan    # just one member

Credentials: copy .env.example to .env and fill in LIFE360_USER / LIFE360_PASS. .env is
gitignored — never commit real credentials. See docs/LIFE360_OBSERVER.md.
"""
import argparse
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)                       # make `backend` importable

from backend.life360 import Life360Client, Life360Error  # noqa: E402


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


def main():
    ap = argparse.ArgumentParser(description="Read current Life360 state for your circle (read-only).")
    ap.add_argument("--member", help="only show members whose name contains this (case-insensitive)")
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

    client = Life360Client()
    try:
        if token:
            print("> Using LIFE360_TOKEN from .env...")
            client.use_token(token)
        else:
            print("> Authenticating with Life360 (username/password)...")
            client.authenticate(user, password)
        circles = client.circles()
        if not circles:
            print("  authenticated, but this account is in no circles.")
            return

        needle = args.member.lower() if args.member else None
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
                shown += 1

        if shown == 0:
            who = f" matching '{args.member}'" if args.member else ""
            print(f"\n  No members{who} found.")
    except Life360Error as e:
        print(f"! {e}")
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print("\n> Cancelled.")
