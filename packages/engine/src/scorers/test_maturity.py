from __future__ import annotations

from models import Session

_TEST_COMMANDS = frozenset(
    ("rspec", "jest", "pytest", "playwright", "vitest", "cypress", "mocha", "minitest")
)
_TEST_EXTENSIONS = (".spec.", ".test.", "_spec.", "_test.")


class TestMaturityScorer:
    """
    Dimensions (sums to 100):
      +35  % sessions with has_test_context
      +30  TDD / test-after workflow pattern
      +20  test file extensions present
      +15  test commands in bash
    """

    def score(self, sessions: list[Session]) -> int:
        if not sessions:
            return 0

        result = 0

        # 1. Sessions with test context
        test_count = sum(1 for s in sessions if s.has_test_context)
        result += int(35 * test_count / len(sessions))

        # 2. TDD / test-after workflow (use stored pattern or detect from events)
        tdd_count = 0
        for s in sessions:
            if s.workflow_pattern in ("tdd", "test-after"):
                tdd_count += 1
                continue
            # Fallback: detect from events when available
            if s.events and s.has_test_context:
                tools = [e.tool_name for e in s.events if e.event_type == "pre_tool_use" and e.tool_name]
                bash_idxs = [i for i, t in enumerate(tools) if t == "Bash"]
                write_idxs = [i for i, t in enumerate(tools) if t in ("Write", "Edit")]
                if bash_idxs and write_idxs and any(b > w for b in bash_idxs for w in write_idxs):
                    tdd_count += 1
        # 50% of sessions with TDD → full score
        result += int(30 * min(tdd_count / len(sessions) * 2, 1.0))

        # 3. Test file extensions
        with_test_files = sum(
            1 for s in sessions
            if any(any(pat in ext for pat in _TEST_EXTENSIONS) for ext in s.file_extensions)
        )
        result += int(20 * with_test_files / len(sessions))

        # 4. Test commands
        with_test_cmds = sum(
            1 for s in sessions
            if any(cmd and any(t in cmd.lower() for t in _TEST_COMMANDS) for cmd in s.commands)
        )
        result += int(15 * with_test_cmds / len(sessions))

        return min(100, result)
