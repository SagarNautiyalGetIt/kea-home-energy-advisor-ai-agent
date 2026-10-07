"""Keep a session's temporary AWS credentials fresh from the Cloud Owner's Mac.

The team account cannot create IAM roles or users, so the API runs on the
operator's temporary SSO credentials (four hours). A per-session macOS
LaunchAgent runs `make keep-credentials` every 30 minutes; that refreshes only
when the uploaded credentials have less than MARGIN left, so the API restarts
about once per credential lifetime, not on every check.

    credentials_timer.py install   <session-id> <session-dir>
    credentials_timer.py uninstall <session-id>
    credentials_timer.py due       <session-dir>      # exit 0 when due, NOT_DUE when not
    credentials_timer.py notify    <message>

`due` answers "not due" with its own exit status, NOT_DUE, rather than 1:
Python exits 1 on any uncaught error, so a crashed check must never read as
fresh credentials.
"""
from __future__ import annotations

import os
import plistlib
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
AGENTS = Path.home() / "Library/LaunchAgents"
INTERVAL_SECONDS = 30 * 60
MARGIN = timedelta(minutes=45)
EXPIRES_FILE = "runtime.env.expires"
NOT_DUE = 3


def label(session_id: str) -> str:
    return f"nz.kea-energy.credentials.{session_id}"


def agent_path(session_id: str) -> Path:
    return AGENTS / f"{label(session_id)}.plist"


def agent(session_id: str, session_dir: Path, path_env: str) -> bytes:
    """The LaunchAgent: check every 30 minutes, and once when it loads or the Mac wakes."""
    log = str(session_dir / "keep-credentials.log")
    return plistlib.dumps({
        "Label": label(session_id),
        "ProgramArguments": ["/usr/bin/make", "-C", str(ROOT / "infra/aws"),
                             "keep-credentials", f"SESSION_ID={session_id}"],
        "StartInterval": INTERVAL_SECONDS,
        "RunAtLoad": True,
        "EnvironmentVariables": {"PATH": path_env, "HOME": str(Path.home())},
        "StandardOutPath": log,
        "StandardErrorPath": log,
    })


def due(session_dir: Path, now: datetime | None = None) -> bool:
    """True when the uploaded credentials are missing, unreadable or close to expiry.

    An expiry without a timezone is unreadable too: it names no instant.
    """
    try:
        text = (session_dir / EXPIRES_FILE).read_text().strip()
        expires = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except (OSError, ValueError):
        return True
    if expires.tzinfo is None:
        return True
    return expires - (now or datetime.now(timezone.utc)) < MARGIN


def launchctl(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["launchctl", *args], capture_output=True, text=True)


def install(session_id: str, session_dir: Path) -> None:
    if sys.platform != "darwin":
        print("Automatic credential refresh uses a macOS LaunchAgent; on this machine run "
              f"`make -C infra/aws refresh-credentials SESSION_ID={session_id}` before each "
              "four-hour window instead.")
        return
    AGENTS.mkdir(parents=True, exist_ok=True)
    target = agent_path(session_id)
    domain = f"gui/{os.getuid()}"
    launchctl("bootout", f"{domain}/{label(session_id)}")  # replace a previous install
    target.write_bytes(agent(session_id, session_dir, os.environ.get("PATH", "/usr/bin:/bin")))
    result = launchctl("bootstrap", domain, str(target))
    if result.returncode:
        raise SystemExit(f"launchctl bootstrap failed: {result.stderr.strip()}")
    print(f"Credential refresh scheduled every {INTERVAL_SECONDS // 60} minutes "
          f"({label(session_id)}); it refreshes when under {MARGIN.seconds // 60} minutes "
          f"remain. Log: {session_dir / 'keep-credentials.log'}")


def uninstall(session_id: str) -> None:
    if sys.platform != "darwin":
        return
    launchctl("bootout", f"gui/{os.getuid()}/{label(session_id)}")
    agent_path(session_id).unlink(missing_ok=True)
    print(f"Credential refresh for session {session_id} removed.")


def notify(message: str) -> None:
    if sys.platform == "darwin":
        script = f'display notification "{message}" with title "Kea Energy AWS"'
        subprocess.run(["osascript", "-e", script], capture_output=True)
    print(message, file=sys.stderr)


def main(argv: list[str]) -> int:
    command, *args = argv
    if command == "install":
        install(args[0], Path(args[1]))
    elif command == "uninstall":
        uninstall(args[0])
    elif command == "due":
        return 0 if due(Path(args[0])) else NOT_DUE
    elif command == "notify":
        notify(" ".join(args))
    else:
        raise SystemExit(f"unknown command {command!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
