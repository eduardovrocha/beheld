from __future__ import annotations

from typing import ClassVar, Optional

from models import Session
from scorers.base import DataSource

_ADVANCED_TOOLS = frozenset({"bash", "computer_use", "web_search"})


class PromptQualityScorer:
    """
    Dimensions (sums to 100):
      +20  avg prompt_length > 200 chars
      +20  has_code_context ratio
      +20  sessions with at least one file extension
      +15  avg distinct tools per session ≥ 4
      +15  long productive sessions (duration > 10 min AND events > 10)
      +10  sessions using Bash / advanced tools

    Enrichment-exclusive by design (spec §7.3 — R1.2) — prompt quality has no
    analogue in git history. When enrichment is absent (no sessions captured
    from any harness), the scorer returns None and the dimension simply does
    not appear in the profile. This is the "honestidade de captura" principle:
    we never fabricate a neutral score for an unobserved dimension.
    """

    data_sources: ClassVar[list[DataSource]] = ["enrichment"]
    fallback_when_enrichment_missing: ClassVar[bool] = False

    def score(self, sessions: list[Session]) -> Optional[int]:
        if not sessions:
            # R1.2 — return None instead of 0 to signal "dimension absent"
            # rather than "observed at neutral value". Honors
            # fallback_when_enrichment_missing = False.
            return None

        result = 0

        # 1. Avg prompt length — use pre-computed aggregate when no events
        avgs: list[float] = []
        for s in sessions:
            if s.events:
                prompt_events = [e for e in s.events if e.prompt_length is not None]
                if prompt_events:
                    avgs.append(sum(e.prompt_length for e in prompt_events) / len(prompt_events))
            elif s.avg_prompt_length > 0:
                avgs.append(s.avg_prompt_length)
        if avgs:
            avg_len = sum(avgs) / len(avgs)
            result += int(min(20, 20 * avg_len / 200))

        # 2. has_code_context ratio
        ctx_ratios: list[float] = []
        for s in sessions:
            if s.events:
                chat_events = [e for e in s.events if e.event_type == "chat_request"]
                if chat_events:
                    with_ctx = sum(1 for e in chat_events if e.metadata.get("has_code_context") is True)
                    ctx_ratios.append(with_ctx / len(chat_events))
            elif s.has_code_context_ratio > 0:
                ctx_ratios.append(s.has_code_context_ratio)
        if ctx_ratios:
            result += int(20 * sum(ctx_ratios) / len(ctx_ratios))

        # 3. Sessions with file context
        with_files = sum(1 for s in sessions if s.file_extensions)
        result += int(20 * with_files / len(sessions))

        # 4. Avg distinct tools ≥ 4
        avg_tools = sum(len(set(s.tools_used)) for s in sessions) / len(sessions)
        result += int(min(15, 15 * avg_tools / 4))

        # 5. Long productive sessions
        def _evt_count(s: Session) -> int:
            return len(s.events) if s.events else s.event_count

        long_productive = sum(
            1 for s in sessions if s.duration_minutes > 10 and _evt_count(s) > 10
        )
        result += int(15 * min(long_productive / len(sessions), 1.0))

        # 6. Sessions with Bash / advanced tools
        with_advanced = sum(
            1 for s in sessions if any(t.lower() in _ADVANCED_TOOLS for t in s.tools_used)
        )
        result += int(10 * with_advanced / len(sessions))

        return min(100, result)
