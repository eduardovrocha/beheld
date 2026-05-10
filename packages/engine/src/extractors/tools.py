from __future__ import annotations

# Tool name aliases used in sequences (normalized to lowercase)
_WRITE_TOOLS = {"write", "write_file", "create_file"}
_READ_TOOLS = {"read", "read_file"}
_EDIT_TOOLS = {"edit", "str_replace", "str_replace_based_edit", "multiedit"}
_BASH_TOOLS = {"bash", "bash_20241022", "execute_bash", "run_terminal_cmd"}


def _normalize(tool: str) -> str:
    t = tool.lower().split(":")[0]  # strip context suffix
    if t.endswith("_test"):
        t = t[:-5]  # strip annotation suffix before category lookup
    if t in _WRITE_TOOLS:
        return "write"
    if t in _READ_TOOLS:
        return "read"
    if t in _EDIT_TOOLS:
        return "edit"
    if t in _BASH_TOOLS:
        return "bash"
    return t


def _is_test(tool_with_ctx: str) -> bool:
    return "_test" in tool_with_ctx.lower()


def detect_workflow(tool_sequence: list[str]) -> str:
    """
    Analyse the MCP tool sequence and return the predominant workflow pattern.

    Items may be plain tool names ("Write", "Bash") or context-annotated
    ("Write_test", "Bash_test") — callers should annotate based on
    has_test_context and file_extension.

    Priority (highest first):
      tdd          — Write_test before Write (impl), then Bash
      test-after   — Write (impl) then Write_test
      debug-driven — bash → read → edit → bash cycle ≥ 2×
      refactor     — ≥3 edit without intervening write; ratio edit/write > 2
      exploratory  — ratio read/write > 3.0
      unknown      — no pattern matched
    """
    if not tool_sequence:
        return "unknown"

    normalized = [_normalize(t) for t in tool_sequence]
    has_test_write = any(_is_test(t) for t in tool_sequence if _normalize(t) == "write")
    has_test_bash = any(_is_test(t) for t in tool_sequence if _normalize(t) == "bash")

    writes = [i for i, t in enumerate(normalized) if t == "write"]
    reads = [i for i, t in enumerate(normalized) if t == "read"]
    edits = [i for i, t in enumerate(normalized) if t == "edit"]
    bashes = [i for i, t in enumerate(normalized) if t == "bash"]

    n = len(normalized)
    if n == 0:
        return "unknown"

    # ── TDD: test write before impl write, then bash ─────────────────────────
    if has_test_write and writes:
        test_write_idxs = [
            i for i, t in enumerate(tool_sequence) if _normalize(t) == "write" and _is_test(t)
        ]
        impl_write_idxs = [
            i for i, t in enumerate(tool_sequence) if _normalize(t) == "write" and not _is_test(t)
        ]
        if test_write_idxs and impl_write_idxs:
            # At least one test-write before an impl-write
            if min(test_write_idxs) < max(impl_write_idxs):
                if bashes:
                    return "tdd"

    # ── test-after: impl write then test write ────────────────────────────────
    if has_test_write and writes:
        test_write_idxs = [
            i for i, t in enumerate(tool_sequence) if _normalize(t) == "write" and _is_test(t)
        ]
        impl_write_idxs = [
            i for i, t in enumerate(tool_sequence) if _normalize(t) == "write" and not _is_test(t)
        ]
        if impl_write_idxs and test_write_idxs:
            if min(impl_write_idxs) < max(test_write_idxs):
                return "test-after"

    # ── debug-driven: bash→read→edit→bash cycle ≥ 2× ─────────────────────────
    cycle_count = 0
    i = 0
    while i < len(normalized) - 2:
        if (
            normalized[i] == "bash"
            and normalized[i + 1] == "read"
            and i + 2 < len(normalized)
            and normalized[i + 2] in ("edit", "bash")
        ):
            cycle_count += 1
            i += 2
        else:
            i += 1
    if cycle_count >= 2:
        return "debug-driven"

    # ── refactor: ≥3 edits without a write, edit/write ratio > 2 ─────────────
    if len(edits) >= 3:
        # Check that edits are not separated by writes
        if not writes or len(edits) / max(len(writes), 1) > 2:
            return "refactor"

    # ── exploratory: read/write ratio > 3 ────────────────────────────────────
    if writes and len(reads) / len(writes) > 3.0:
        return "exploratory"
    if not writes and len(reads) >= 3:
        return "exploratory"

    return "unknown"


def build_tool_sequence(session) -> list[str]:
    """
    Build a context-annotated tool sequence from a Session's events.
    Test-related operations get a '_test' suffix.
    """
    TEST_EXTENSIONS = (".spec.", ".test.", "_spec.", "_test.")
    sequence = []
    for event in session.events:
        if event.event_type != "pre_tool_use" or not event.tool_name:
            continue
        name = event.tool_name
        ext = event.file_extension or ""
        is_test = event.has_test_context is True or any(p in ext for p in TEST_EXTENSIONS)
        if is_test:
            name = f"{name}_test"
        sequence.append(name)
    return sequence
