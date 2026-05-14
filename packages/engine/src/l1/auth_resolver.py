"""L1 auth resolver — picks a clone strategy without persisting credentials.

Cascade (best → fallback):
  1. SSH agent  → reuse $SSH_AUTH_SOCK, never handle private keys directly
  2. gh CLI     → delegate clone to `gh repo clone`
  3. glab CLI   → delegate clone to `glab repo clone`
  4. PAT        → caller-supplied token, surfaced via GIT_ASKPASS only

The PAT never enters argv (would leak via `ps aux`). It lives only inside an
askpass script in a 0700 tempdir, removed in `finally` regardless of outcome.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from typing import Literal, Optional

logger = logging.getLogger(__name__)

Method = Literal["ssh", "gh", "glab", "pat"]


@dataclass
class AuthMethod:
    method: Method
    env: dict = field(default_factory=dict)
    needs_pat: bool = False
    pat: Optional[str] = field(default=None, repr=False)  # repr=False so logs/asdict don't surface it

    def __post_init__(self) -> None:
        if self.method == "pat" and self.pat is None and not self.needs_pat:
            # Allow explicit construction with pat=None when needs_pat=True (caller will fill).
            pass


# ── availability probes ──────────────────────────────────────────────────────


_PROBE_TIMEOUT_SECONDS = 5


def _silent_run(args: list[str]) -> Optional[int]:
    """Run a probe command silently. Returns the exit code, or None if the
    binary is missing or the call timed out."""
    try:
        cp = subprocess.run(
            args,
            capture_output=True,
            timeout=_PROBE_TIMEOUT_SECONDS,
        )
        return cp.returncode
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None


def _ssh_agent_available() -> bool:
    if not os.environ.get("SSH_AUTH_SOCK"):
        return False
    return _silent_run(["ssh-add", "-l"]) == 0


def _gh_authenticated() -> bool:
    return _silent_run(["gh", "auth", "status"]) == 0


def _glab_authenticated() -> bool:
    return _silent_run(["glab", "auth", "status"]) == 0


# ── resolution ───────────────────────────────────────────────────────────────


def resolve(repo_url: str, pat: Optional[str] = None) -> AuthMethod:
    """Pick an auth method for `repo_url`. If `pat` is provided, use it
    directly. Otherwise probe the cascade; if nothing is available, return
    `needs_pat=True` so the CLI can prompt the user."""
    if pat:
        return AuthMethod(method="pat", pat=pat)

    if _ssh_agent_available():
        env = {"SSH_AUTH_SOCK": os.environ["SSH_AUTH_SOCK"]}
        return AuthMethod(method="ssh", env=env)

    if _gh_authenticated():
        return AuthMethod(method="gh")

    if _glab_authenticated():
        return AuthMethod(method="glab")

    return AuthMethod(method="pat", needs_pat=True)


# ── URL normalization ────────────────────────────────────────────────────────


_SSH_URL_RE = re.compile(r"^(?:ssh://)?(?:[^@/]+@)?([^:/]+)[:/](.+?)(?:\.git)?/?$")


def _to_https(url: str) -> str:
    """Convert SSH-style URLs to HTTPS. HTTPS URLs pass through unchanged."""
    if url.startswith("http://") or url.startswith("https://"):
        return url
    m = _SSH_URL_RE.match(url)
    if not m:
        return url
    return f"https://{m.group(1)}/{m.group(2)}.git"


# ── clone with auth ──────────────────────────────────────────────────────────


def clone_with_auth(repo_url: str, target_dir: str, auth: AuthMethod) -> None:
    """Run the bare partial clone using the resolved auth method.

    Raises `RuntimeError` if `auth.needs_pat` is True (caller should have
    prompted) or `auth.method` is unknown. Any subprocess failure surfaces as
    the underlying `subprocess.CalledProcessError`."""
    if auth.needs_pat:
        raise RuntimeError("AuthMethod.needs_pat is True — prompt the user for a PAT first")

    if auth.method == "ssh":
        env = {**os.environ, **auth.env}
        subprocess.run(
            ["git", "clone", "--bare", "--filter=blob:none", repo_url, target_dir],
            check=True,
            env=env,
        )
        return

    if auth.method == "gh":
        subprocess.run(
            ["gh", "repo", "clone", repo_url, target_dir, "--",
             "--bare", "--filter=blob:none"],
            check=True,
        )
        return

    if auth.method == "glab":
        subprocess.run(
            ["glab", "repo", "clone", repo_url, target_dir, "--",
             "--bare", "--filter=blob:none"],
            check=True,
        )
        return

    if auth.method == "pat":
        if not auth.pat:
            raise RuntimeError("AuthMethod.method='pat' but pat is empty")
        _clone_with_pat(repo_url, target_dir, auth.pat)
        return

    raise RuntimeError(f"unknown auth method: {auth.method!r}")


def _clone_with_pat(repo_url: str, target_dir: str, pat: str) -> None:
    """Clone via HTTPS, feeding the PAT through a one-shot GIT_ASKPASS script.

    The token is written to a sibling file (mode 0o600) inside a 0700 tmpdir;
    the askpass script reads it with `cat`. Both files are wiped in `finally`,
    so a crash mid-clone cannot leak the token to disk."""
    https_url = _to_https(repo_url)
    askpass_dir = tempfile.mkdtemp(prefix="dp-askpass-")
    try:
        os.chmod(askpass_dir, 0o700)
        token_path = os.path.join(askpass_dir, "token")
        askpass_path = os.path.join(askpass_dir, "askpass.sh")

        with open(token_path, "w") as fh:
            fh.write(pat + "\n")
        os.chmod(token_path, 0o600)

        # Username is non-sensitive ("oauth2" works for both GitHub and GitLab
        # PATs). Password is read from the token file — keeps the literal
        # token out of the script source.
        script = (
            "#!/bin/sh\n"
            'case "$1" in\n'
            '  Username*) printf "oauth2\\n" ;;\n'
            f'  *) cat "{token_path}" ;;\n'
            "esac\n"
        )
        with open(askpass_path, "w") as fh:
            fh.write(script)
        os.chmod(askpass_path, 0o700)

        env = {
            **os.environ,
            "GIT_ASKPASS": askpass_path,
            # Belt-and-suspenders: prevent git from falling back to a TTY
            # prompt if the askpass somehow returns nothing.
            "GIT_TERMINAL_PROMPT": "0",
        }
        subprocess.run(
            ["git", "clone", "--bare", "--filter=blob:none", https_url, target_dir],
            check=True,
            env=env,
        )
    finally:
        shutil.rmtree(askpass_dir, ignore_errors=True)
