from __future__ import annotations

import logging
import os
import subprocess
from pathlib import Path

import pytest

from l1 import auth_resolver
from l1.auth_resolver import AuthMethod, clone_with_auth, resolve


# ── helpers ──────────────────────────────────────────────────────────────────


SECRET = "ghp_DO_NOT_LEAK_THIS_TOKEN_84729"


def _completed(args, returncode: int = 0) -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(args=args, returncode=returncode, stdout=b"", stderr=b"")


def _probe_map(ssh: int | None, gh: int | None, glab: int | None):
    """Build a fake subprocess.run that maps probe commands to exit codes.
    `None` means the binary is "missing" (FileNotFoundError)."""

    def fake_run(args, **kwargs):
        head = args[0] if args else ""
        if head == "ssh-add":
            if ssh is None:
                raise FileNotFoundError("ssh-add")
            return _completed(args, ssh)
        if head == "gh":
            if gh is None:
                raise FileNotFoundError("gh")
            return _completed(args, gh)
        if head == "glab":
            if glab is None:
                raise FileNotFoundError("glab")
            return _completed(args, glab)
        return _completed(args, 0)

    return fake_run


# ── cascade resolution ───────────────────────────────────────────────────────


def test_resolve_returns_ssh_when_agent_available(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SSH_AUTH_SOCK", "/tmp/ssh-agent.fake")
    monkeypatch.setattr(auth_resolver.subprocess, "run", _probe_map(ssh=0, gh=0, glab=0))
    result = resolve("git@github.com:foo/bar.git")
    assert result.method == "ssh"
    assert result.env.get("SSH_AUTH_SOCK") == "/tmp/ssh-agent.fake"
    assert result.needs_pat is False


def test_resolve_returns_gh_when_ssh_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SSH_AUTH_SOCK", raising=False)
    monkeypatch.setattr(auth_resolver.subprocess, "run", _probe_map(ssh=1, gh=0, glab=0))
    result = resolve("https://github.com/foo/bar.git")
    assert result.method == "gh"
    assert result.needs_pat is False


def test_resolve_returns_glab_when_only_glab(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SSH_AUTH_SOCK", raising=False)
    monkeypatch.setattr(auth_resolver.subprocess, "run", _probe_map(ssh=1, gh=1, glab=0))
    result = resolve("https://gitlab.com/foo/bar.git")
    assert result.method == "glab"
    assert result.needs_pat is False


def test_resolve_returns_needs_pat_when_nothing_available(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SSH_AUTH_SOCK", raising=False)
    monkeypatch.setattr(auth_resolver.subprocess, "run", _probe_map(ssh=None, gh=None, glab=None))
    result = resolve("https://example.com/foo/bar.git")
    assert result.method == "pat"
    assert result.needs_pat is True
    assert result.pat is None


def test_resolve_uses_provided_pat_directly(monkeypatch: pytest.MonkeyPatch) -> None:
    """If a PAT is provided up front, the probes must not be consulted at all."""
    called = []

    def fake_run(args, **kw):
        called.append(args)
        return _completed(args, 0)

    monkeypatch.setattr(auth_resolver.subprocess, "run", fake_run)
    result = resolve("https://github.com/foo/bar.git", pat=SECRET)
    assert result.method == "pat"
    assert result.needs_pat is False
    assert result.pat == SECRET
    assert called == [], "probes must not run when a PAT is provided"


def test_resolve_ignores_ssh_agent_without_socket_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Even if ssh-add would return 0, an unset SSH_AUTH_SOCK rules SSH out."""
    monkeypatch.delenv("SSH_AUTH_SOCK", raising=False)
    monkeypatch.setattr(auth_resolver.subprocess, "run", _probe_map(ssh=0, gh=1, glab=1))
    result = resolve("https://github.com/foo/bar.git")
    assert result.method != "ssh"
    assert result.needs_pat is True


# ── clone_with_auth: PAT safety ──────────────────────────────────────────────


def test_pat_never_appears_in_argv(monkeypatch: pytest.MonkeyPatch) -> None:
    """The token must never appear in argv (it would be visible in `ps aux`)."""
    captured_args: list[list[str]] = []

    def fake_run(args, **kw):
        captured_args.append(list(args))
        return _completed(args, 0)

    monkeypatch.setattr(auth_resolver.subprocess, "run", fake_run)

    auth = AuthMethod(method="pat", pat=SECRET)
    clone_with_auth("git@github.com:foo/bar.git", "/tmp/target", auth)

    assert captured_args, "subprocess.run was not called"
    for args in captured_args:
        for arg in args:
            assert SECRET not in str(arg), f"token leaked into argv: {arg!r}"


def test_pat_askpass_script_removed_after_clone(monkeypatch: pytest.MonkeyPatch) -> None:
    """After a successful clone, the askpass script and token file are gone."""
    captured_askpass: list[str] = []

    def fake_run(args, **kw):
        env = kw.get("env") or {}
        if "GIT_ASKPASS" in env:
            askpass = env["GIT_ASKPASS"]
            captured_askpass.append(askpass)
            # While git is running, the askpass MUST exist and be executable.
            assert os.path.exists(askpass)
            assert os.access(askpass, os.X_OK)
        return _completed(args, 0)

    monkeypatch.setattr(auth_resolver.subprocess, "run", fake_run)

    auth = AuthMethod(method="pat", pat=SECRET)
    clone_with_auth("https://github.com/foo/bar.git", "/tmp/target", auth)

    assert captured_askpass, "askpass path was never captured"
    for path in captured_askpass:
        assert not os.path.exists(path), f"askpass leaked: {path}"
        parent = os.path.dirname(path)
        assert not os.path.exists(parent), f"askpass tmpdir leaked: {parent}"


def test_pat_askpass_script_removed_on_clone_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """Even when git clone fails, the askpass and tmpdir must be cleaned up."""
    captured_askpass: list[str] = []

    def fake_run(args, **kw):
        env = kw.get("env") or {}
        if "GIT_ASKPASS" in env:
            captured_askpass.append(env["GIT_ASKPASS"])
        raise subprocess.CalledProcessError(returncode=128, cmd=args)

    monkeypatch.setattr(auth_resolver.subprocess, "run", fake_run)

    auth = AuthMethod(method="pat", pat=SECRET)
    with pytest.raises(subprocess.CalledProcessError):
        clone_with_auth("https://github.com/foo/bar.git", "/tmp/target", auth)

    assert captured_askpass, "askpass path was never captured"
    for path in captured_askpass:
        assert not os.path.exists(path), f"askpass leaked on error: {path}"
        parent = os.path.dirname(path)
        assert not os.path.exists(parent), f"askpass tmpdir leaked on error: {parent}"


def test_pat_not_logged(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    """No log record at any level may contain the token (not even partially)."""

    def fake_run(args, **kw):
        return _completed(args, 0)

    monkeypatch.setattr(auth_resolver.subprocess, "run", fake_run)

    with caplog.at_level(logging.DEBUG, logger=auth_resolver.logger.name):
        auth = AuthMethod(method="pat", pat=SECRET)
        clone_with_auth("https://github.com/foo/bar.git", "/tmp/target", auth)

    for record in caplog.records:
        assert SECRET not in record.getMessage()
        # Also guard against the token sneaking in via args/kwargs that the
        # formatter could render.
        for arg in record.args or ():
            assert SECRET not in str(arg)


def test_pat_repr_does_not_leak_token() -> None:
    """`repr(AuthMethod)` must not include the PAT — guards against accidental
    log statements that interpolate the whole object."""
    auth = AuthMethod(method="pat", pat=SECRET)
    assert SECRET not in repr(auth)


# ── clone_with_auth: dispatch correctness ────────────────────────────────────


def test_clone_ssh_passes_socket_env(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = {}

    def fake_run(args, **kw):
        captured["args"] = list(args)
        captured["env"] = dict(kw.get("env") or {})
        return _completed(args, 0)

    monkeypatch.setattr(auth_resolver.subprocess, "run", fake_run)
    auth = AuthMethod(method="ssh", env={"SSH_AUTH_SOCK": "/sock"})
    clone_with_auth("git@github.com:foo/bar.git", "/tmp/x", auth)

    assert captured["args"][:5] == ["git", "clone", "--bare", "--filter=blob:none", "git@github.com:foo/bar.git"]
    assert captured["env"]["SSH_AUTH_SOCK"] == "/sock"


def test_clone_gh_delegates_to_gh(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = []

    def fake_run(args, **kw):
        captured.append(list(args))
        return _completed(args, 0)

    monkeypatch.setattr(auth_resolver.subprocess, "run", fake_run)
    clone_with_auth("https://github.com/foo/bar.git", "/tmp/x", AuthMethod(method="gh"))

    assert captured[0][:3] == ["gh", "repo", "clone"]
    assert "--bare" in captured[0]
    assert "--filter=blob:none" in captured[0]


def test_clone_glab_delegates_to_glab(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = []

    def fake_run(args, **kw):
        captured.append(list(args))
        return _completed(args, 0)

    monkeypatch.setattr(auth_resolver.subprocess, "run", fake_run)
    clone_with_auth("https://gitlab.com/foo/bar.git", "/tmp/x", AuthMethod(method="glab"))

    assert captured[0][:3] == ["glab", "repo", "clone"]
    assert "--bare" in captured[0]
    assert "--filter=blob:none" in captured[0]


def test_clone_raises_if_needs_pat_unfilled() -> None:
    auth = AuthMethod(method="pat", needs_pat=True)
    with pytest.raises(RuntimeError, match="needs_pat"):
        clone_with_auth("https://github.com/foo/bar.git", "/tmp/x", auth)


def test_pat_converts_ssh_url_to_https(monkeypatch: pytest.MonkeyPatch) -> None:
    """PAT auth only works over HTTPS — SSH-style URLs must be rewritten."""
    captured = []

    def fake_run(args, **kw):
        captured.append(list(args))
        return _completed(args, 0)

    monkeypatch.setattr(auth_resolver.subprocess, "run", fake_run)
    clone_with_auth("git@github.com:foo/bar.git", "/tmp/x", AuthMethod(method="pat", pat=SECRET))

    # The URL passed to git is now an https URL with NO embedded token.
    git_url = captured[0][4]
    assert git_url == "https://github.com/foo/bar.git"
    assert SECRET not in git_url
