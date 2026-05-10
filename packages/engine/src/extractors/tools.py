from __future__ import annotations

from models import DevProfileEvent


def detect_workflow(events: list[DevProfileEvent]) -> str:
    """Detect workflow pattern from MCP tool sequence."""
    tools = [e.tool_name for e in events if e.tool_name and e.event_type == "pre_tool_use"]
    if not tools:
        return "unknown"

    total = len(tools)
    read_count = tools.count("Read")
    write_count = sum(1 for t in tools if t in ("Write", "Edit"))
    bash_count = tools.count("Bash")
    bash_positions = [i for i, t in enumerate(tools) if t == "Bash"]
    write_positions = [i for i, t in enumerate(tools) if t in ("Write", "Edit")]

    has_test = any(e.has_test_context is True for e in events)

    read_ratio = read_count / total
    write_ratio = write_count / total
    bash_ratio = bash_count / total

    # Debug-driven: many bash runs + moderate reads, cyclic pattern
    if bash_ratio > 0.30 and read_ratio > 0.15 and bash_count >= 2:
        return "debug_driven"

    # TDD: test context detected + bash runs after writes (red-green cycle)
    if has_test and bash_positions and write_positions:
        interleaved = any(b > w for b in bash_positions for w in write_positions)
        if interleaved:
            return "tdd"

    # Test-after: writes followed by test commands
    if has_test and write_positions and bash_count >= 1:
        return "test_after"

    # Refactor: many edits, few bash runs
    if write_ratio > 0.40 and bash_ratio < 0.15 and write_count >= 3:
        return "refactor"

    # Exploratory: lots of reads, few writes
    if read_ratio > 0.50 and write_ratio < 0.20:
        return "exploratory"

    return "unknown"


def count_distinct_tools(tools_used: list[str]) -> int:
    return len(set(tools_used))
