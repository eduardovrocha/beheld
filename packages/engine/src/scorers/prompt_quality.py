from __future__ import annotations

from models import Session

ADVANCED_BASH_TOOLS = {"bash", "computer_use", "web_search"}


def compute_prompt_quality(sessions: list[Session]) -> int:
    """
    Dimensions (sums to 100):
      +20  avg prompt_length > 200 chars
      +20  has_code_context ratio (chat_request events)
      +20  sessions with at least one file extension
      +15  avg distinct tools per session ≥ 4
      +15  long productive sessions (duration > 10 min AND events > 10)
      +10  sessions using Bash / advanced tools
    """
    if not sessions:
        return 0

    score = 0
    all_events = [e for s in sessions for e in s.events]

    # 1. Avg prompt length
    prompt_events = [e for e in all_events if e.prompt_length is not None]
    if prompt_events:
        avg_len = sum(e.prompt_length for e in prompt_events) / len(prompt_events)
        score += int(min(20, 20 * avg_len / 200))

    # 2. has_code_context on chat_request events
    chat_events = [e for e in all_events if e.event_type == "chat_request"]
    if chat_events:
        with_ctx = sum(1 for e in chat_events if e.metadata.get("has_code_context") is True)
        score += int(20 * with_ctx / len(chat_events))

    # 3. Sessions with file context
    with_files = sum(1 for s in sessions if s.file_extensions)
    score += int(20 * with_files / len(sessions))

    # 4. Avg distinct tools ≥ 4
    avg_tools = sum(len(set(s.tools_used)) for s in sessions) / len(sessions)
    score += int(min(15, 15 * avg_tools / 4))

    # 5. Long productive sessions
    long_productive = sum(
        1 for s in sessions if s.duration_minutes > 10 and len(s.events) > 10
    )
    score += int(15 * min(long_productive / len(sessions), 1.0))

    # 6. Advanced-tool sessions (Bash or other)
    with_advanced = sum(
        1 for s in sessions if any(t.lower() in ADVANCED_BASH_TOOLS for t in s.tools_used)
    )
    score += int(10 * with_advanced / len(sessions))

    return min(100, score)
