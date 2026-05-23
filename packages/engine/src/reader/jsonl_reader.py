from __future__ import annotations

import json
import logging
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import os

from models import BeheldEvent, Session

logger = logging.getLogger(__name__)

_DATA_HOME = Path(os.environ.get("BEHELD_DATA_DIR", Path.home()))
SESSIONS_DIR = _DATA_HOME / ".beheld" / "sessions"
CURSOR_FILE = _DATA_HOME / ".beheld" / ".cursor"


def _parse_ts(ts: str) -> datetime:
    ts = ts.rstrip("Z")
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(ts, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    try:
        dt = datetime.fromisoformat(ts)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return datetime.now(timezone.utc)


def _build_sessions(events: list[BeheldEvent]) -> list[Session]:
    buckets: dict[str, list[BeheldEvent]] = {}
    for event in events:
        buckets.setdefault(event.session_id, []).append(event)

    sessions: list[Session] = []
    for session_id, evts in buckets.items():
        evts.sort(key=lambda e: e.timestamp)

        started_at = _parse_ts(evts[0].timestamp)
        ended_at = _parse_ts(evts[-1].timestamp) if len(evts) > 1 else None
        duration = (ended_at - started_at).total_seconds() / 60.0 if ended_at and ended_at != started_at else 0.0

        tools_used = list({e.tool_name for e in evts if e.tool_name})
        file_extensions = Counter(e.file_extension for e in evts if e.file_extension)
        commands = [e.command_sanitized for e in evts if e.command_sanitized]
        cwd_hashes = [e.cwd_hash for e in evts if e.cwd_hash]
        cwd_hash = cwd_hashes[0] if cwd_hashes else ""

        total_turns = 0
        for e in evts:
            if e.event_type == "stop" and "total_turns" in e.metadata:
                try:
                    total_turns = int(e.metadata["total_turns"])
                    break
                except (ValueError, TypeError):
                    pass

        has_test_context = any(e.has_test_context is True for e in evts)

        # Pre-compute aggregates for scoring
        prompt_events = [e for e in evts if e.prompt_length is not None]
        avg_prompt = sum(e.prompt_length for e in prompt_events) / len(prompt_events) if prompt_events else 0.0
        chat_events = [e for e in evts if e.event_type == "chat_request"]
        ctx_ratio = (
            sum(1 for e in chat_events if e.metadata.get("has_code_context") is True) / len(chat_events)
            if chat_events
            else 0.0
        )

        sessions.append(
            Session(
                session_id=session_id,
                source=evts[0].source,
                started_at=started_at,
                ended_at=ended_at,
                duration_minutes=duration,
                events=evts,
                tools_used=tools_used,
                file_extensions=file_extensions,
                commands=commands,
                cwd_hash=cwd_hash,
                total_turns=total_turns,
                has_test_context=has_test_context,
                avg_prompt_length=avg_prompt,
                has_code_context_ratio=ctx_ratio,
                event_count=len(evts),
            )
        )
    return sessions


class JsonlReader:
    """Incremental JSONL reader that tracks byte offsets per file."""

    def __init__(self, sessions_dir: Path = SESSIONS_DIR, cursor_file: Path = CURSOR_FILE) -> None:
        self.sessions_dir = sessions_dir
        self.cursor_file = cursor_file

    # ── cursor I/O ────────────────────────────────────────────────────────────

    def _load_cursor(self) -> dict[str, int]:
        """Returns {filename: byte_offset}."""
        if not self.cursor_file.exists():
            return {}
        try:
            data = json.loads(self.cursor_file.read_text())
            return data.get("offsets", {})
        except Exception:
            return {}

    def _save_cursor(self, offsets: dict[str, int]) -> None:
        self.cursor_file.parent.mkdir(parents=True, exist_ok=True)
        self.cursor_file.write_text(json.dumps({"offsets": offsets}))

    # ── reading ───────────────────────────────────────────────────────────────

    def read_new_sessions(self) -> list[Session]:
        """Process only events that are new since the last cursor."""
        if not self.sessions_dir.exists():
            return []

        offsets = self._load_cursor()
        new_events: list[BeheldEvent] = []
        new_offsets: dict[str, int] = dict(offsets)

        for jsonl_file in sorted(self.sessions_dir.glob("*.jsonl")):
            filename = jsonl_file.name
            current_offset = offsets.get(filename, 0)

            try:
                with open(jsonl_file, "rb") as fh:
                    fh.seek(0, 2)  # seek to end
                    file_size = fh.tell()

                if file_size <= current_offset:
                    # No new content
                    new_offsets[filename] = current_offset
                    continue

                with open(jsonl_file, "r", encoding="utf-8", errors="replace") as fh:
                    fh.seek(current_offset)
                    for raw_line in fh:
                        line = raw_line.strip()
                        if not line:
                            continue
                        try:
                            data = json.loads(line)
                            new_events.append(BeheldEvent.from_dict(data))
                        except Exception:
                            logger.warning("Skipping malformed JSONL line in %s", filename)

                    new_offsets[filename] = fh.tell()

            except OSError as exc:
                logger.warning("Could not read %s: %s", jsonl_file, exc)
                continue

        self._save_cursor(new_offsets)

        if not new_events:
            return []

        return _build_sessions(new_events)
