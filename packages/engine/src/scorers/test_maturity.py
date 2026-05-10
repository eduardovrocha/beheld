from __future__ import annotations

from models import Session

TEST_COMMANDS = ("rspec", "jest", "pytest", "playwright", "vitest", "cypress", "mocha", "minitest")
TEST_EXTENSIONS = (".spec.", ".test.", "_spec.", "_test.")


def compute_test_maturity(sessions: list[Session]) -> int:
    """
    Dimensions (sums to 100):
      +35  % sessions with has_test_context = true
      +30  TDD detected (test context + Bash after writes, per session)
      +20  test file extensions in any session
      +15  test commands present in any bash command
    """
    if not sessions:
        return 0

    score = 0

    # 1. Sessions with test context
    test_sessions = sum(1 for s in sessions if s.has_test_context)
    score += int(35 * test_sessions / len(sessions))

    # 2. TDD-like sessions: has test context + bash calls after edits
    tdd_count = 0
    for s in sessions:
        if not s.has_test_context:
            continue
        pre_tools = [e.tool_name for e in s.events if e.event_type == "pre_tool_use" and e.tool_name]
        bash_idxs = [i for i, t in enumerate(pre_tools) if t == "Bash"]
        write_idxs = [i for i, t in enumerate(pre_tools) if t in ("Write", "Edit")]
        if bash_idxs and write_idxs and any(b > w for b in bash_idxs for w in write_idxs):
            tdd_count += 1
    # *2 because TDD is rare: 50% of sessions with TDD → full score
    score += int(30 * min(tdd_count / len(sessions) * 2, 1.0))

    # 3. Test file extensions
    with_test_files = sum(
        1 for s in sessions
        if any(any(pat in ext for pat in TEST_EXTENSIONS) for ext in s.file_extensions)
    )
    score += int(20 * with_test_files / len(sessions))

    # 4. Test commands in bash
    with_test_cmds = sum(
        1 for s in sessions
        if any(
            cmd and any(t in cmd.lower() for t in TEST_COMMANDS)
            for cmd in s.commands
        )
    )
    score += int(15 * with_test_cmds / len(sessions))

    return min(100, score)
