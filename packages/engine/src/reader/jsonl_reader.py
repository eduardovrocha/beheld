from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from models import DevProfileEvent, Session

SESSIONS_DIR = Path.home() / ".devprofile" / "sessions"


def _parse_ts(ts: str) -> datetime:
    ts = ts.rstrip("Z")
    if "+" in ts or (ts.count("-") > 2):
        # Has timezone info
        try:
            return datetime.fromisoformat(ts)
        except ValueError:
            pass
    try:
        dt = datetime.fromisoformat(ts)
    except ValueError:
        for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S"):
            try:
                dt = datetime.strptime(ts, fmt)
                break
            except ValueError:
                continue
        else:
            dt = datetime.now(timezone.utc)
    return dt.replace(tzinfo=timezone.utc)


def read_all_events(sessions_dir: Path = SESSIONS_DIR) -> list[DevProfileEvent]:
    events: list[DevProfileEvent] = []
    if not sessions_dir.exists():
        return events

    for jsonl_file in sorted(sessions_dir.glob("*.jsonl")):
        try:
            with open(jsonl_file, "r", encoding="utf-8", errors="replace") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                        events.append(DevProfileEvent.from_dict(data))
                    except Exception:
                        continue
        except OSError:
            continue

    return events


def group_into_sessions(events: list[DevProfileEvent]) -> list[Session]:
    buckets: dict[str, list[DevProfileEvent]] = {}
    for event in events:
        buckets.setdefault(event.session_id, []).append(event)

    sessions: list[Session] = []
    for session_id, evts in buckets.items():
        evts.sort(key=lambda e: e.timestamp)

        started_at = _parse_ts(evts[0].timestamp)
        ended_at = _parse_ts(evts[-1].timestamp) if len(evts) > 1 else None

        duration_minutes = 0.0
        if ended_at and ended_at != started_at:
            duration_minutes = (ended_at - started_at).total_seconds() / 60.0

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
        source = evts[0].source

        sessions.append(
            Session(
                session_id=session_id,
                source=source,
                started_at=started_at,
                ended_at=ended_at,
                duration_minutes=duration_minutes,
                events=evts,
                tools_used=tools_used,
                file_extensions=file_extensions,
                commands=commands,
                cwd_hash=cwd_hash,
                total_turns=total_turns,
                has_test_context=has_test_context,
            )
        )

    return sessions
