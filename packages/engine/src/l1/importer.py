"""L1 ingestion orchestrator.

Glues `auth_resolver` → `git_extractor` → `storage.sqlite.save_l1_*`. Exposes
a single-slot in-process status so the CLI can poll progress and decide when
to ask for a PAT or surface an error.

Pre-clone idempotency uses a small URL→root-hash cache stored in the existing
`profile` key-value table (no schema change, no URL column on l1_repositories,
no plaintext URL on disk — only SHA-256 fingerprints)."""

from __future__ import annotations

import hashlib
import threading
from datetime import datetime, timezone
from typing import Optional

from l1 import auth_resolver, git_extractor
from l1.git_extractor import AuthorNotFoundError, CloneError
from storage.sqlite import DevProfileDB


_CACHE_KEY_PREFIX = "l1_url:"


def _url_fingerprint(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()


class L1Importer:
    """Single-slot importer. The current ingestion state is tracked in memory;
    a successful import additionally records the URL→root-hash mapping in the
    `profile` table for cross-process / cross-restart idempotency."""

    def __init__(self, db: DevProfileDB) -> None:
        self._db = db
        self._lock = threading.Lock()
        self._status: dict = {
            "status": "idle",
            "repo_url": None,
            "progress_pct": 0,
            "result": None,
        }

    # ── status (thread-safe) ──────────────────────────────────────────────

    def get_import_status(self) -> dict:
        with self._lock:
            return dict(self._status)

    def _set_status(self, **fields) -> None:
        with self._lock:
            self._status.update(fields)

    def _reset_progress(self, repo_url: str) -> None:
        with self._lock:
            self._status = {
                "status": "processing",
                "repo_url": repo_url,
                "progress_pct": 5,
                "result": None,
            }

    def _finish(self, result: dict) -> None:
        terminal = "done" if result.get("status") in {"imported", "already_imported"} else "error"
        with self._lock:
            self._status = {
                "status": terminal,
                "repo_url": self._status.get("repo_url"),
                "progress_pct": 100,
                "result": result,
            }

    # ── cache (URL fingerprint → root commit hash) ────────────────────────

    def _cache_key(self, repo_url: str) -> str:
        return _CACHE_KEY_PREFIX + _url_fingerprint(repo_url)

    def _cache_lookup(self, repo_url: str) -> Optional[str]:
        return self._db.get_profile(self._cache_key(repo_url))

    def _cache_store(self, repo_url: str, root_hash: str) -> None:
        self._db.set_profile(self._cache_key(repo_url), root_hash)

    # ── main entry point ──────────────────────────────────────────────────

    def import_repository(
        self,
        repo_url: str,
        author_email: str,
        pat: Optional[str] = None,
    ) -> dict:
        self._reset_progress(repo_url)
        try:
            # 1. Pre-clone idempotency check — bail out before paying clone cost.
            cached = self._cache_lookup(repo_url)
            if cached:
                result = {"status": "already_imported", "root_commit_hash": cached}
                self._finish(result)
                return result

            # 2. Auth — may signal that a PAT prompt is needed.
            auth = auth_resolver.resolve(repo_url, pat)
            if auth.needs_pat:
                result = {"status": "needs_pat"}
                self._finish(result)
                return result
            self._set_status(progress_pct=20)

            # 3. Extract — never touches file content; clone wiped in `finally`.
            try:
                signals = git_extractor.extract(repo_url, author_email, auth.env or None)
            except AuthorNotFoundError:
                result = {"status": "author_not_found"}
                self._finish(result)
                return result
            except CloneError as exc:
                result = {"status": "clone_error", "detail": str(exc)}
                self._finish(result)
                return result
            self._set_status(progress_pct=70)

            # 4. Save repo — `save_l1_repository` is idempotent on the real hash.
            inserted = self._db.save_l1_repository(
                root_commit_hash=signals.root_commit_hash,
                imported_at=datetime.now(timezone.utc).isoformat(),
                commit_count=signals.commit_count,
                author_email_hash=signals.author_email_hash,
            )
            if not inserted:
                # The real root hash already existed (e.g. mirror URL of a repo
                # we imported under a different URL). Backfill the URL cache so
                # the next call short-circuits.
                self._cache_store(repo_url, signals.root_commit_hash)
                result = {
                    "status": "already_imported",
                    "root_commit_hash": signals.root_commit_hash,
                }
                self._finish(result)
                return result

            # 5. Save signals.
            self._db.save_l1_signals(
                root_commit_hash=signals.root_commit_hash,
                file_extensions=signals.file_extensions,
                ecosystems=signals.ecosystems,
                platforms=signals.platforms,
                test_ratio=signals.test_ratio,
                timing=signals.timing,
                first_commit_at=signals.first_commit_at,
                last_commit_at=signals.last_commit_at,
            )

            # 6. Persist the URL→root-hash mapping for future pre-clone bypass.
            self._cache_store(repo_url, signals.root_commit_hash)
            self._set_status(progress_pct=100)

            result = {
                "status": "imported",
                "root_commit_hash": signals.root_commit_hash,
                "commit_count": signals.commit_count,
            }
            self._finish(result)
            return result
        except Exception as exc:
            # Any unexpected failure: surface as error state so the CLI can
            # render something useful and the next import can proceed.
            result = {"status": "error", "detail": str(exc)}
            self._finish(result)
            raise
