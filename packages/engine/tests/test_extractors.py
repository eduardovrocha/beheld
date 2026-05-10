from __future__ import annotations

import pytest

from extractors.commands import detect_platforms
from extractors.files import detect_ecosystems, detect_languages, is_test_path
from extractors.timing import analyze_timing
from extractors.tools import build_tool_sequence, detect_workflow
from tests.conftest import EVENTS_SESSION_1


# ── commands / detect_platforms ───────────────────────────────────────────────


def test_detect_platforms_docker() -> None:
    result = detect_platforms(["docker build .", "docker-compose up"])
    assert "docker" in result
    assert result["docker"] >= 1


def test_detect_platforms_github() -> None:
    result = detect_platforms(["git push origin main"])
    assert "github" in result


def test_detect_platforms_testing() -> None:
    result = detect_platforms(["pytest tests/"])
    assert "testing" in result


def test_detect_platforms_multiple() -> None:
    result = detect_platforms(["docker build .", "git push origin main", "aws s3 ls"])
    assert "docker" in result
    assert "github" in result
    assert "cloud_infra" in result


def test_detect_platforms_empty() -> None:
    assert detect_platforms([]) == {}


def test_detect_platforms_no_match() -> None:
    assert detect_platforms(["echo hello"]) == {}


def test_detect_platforms_returns_dict() -> None:
    result = detect_platforms(["docker build ."])
    assert isinstance(result, dict)


# ── files / detect_ecosystems ─────────────────────────────────────────────────


def test_detect_ecosystems_rails() -> None:
    result = detect_ecosystems(["app/models/user.rb"])
    assert "rails" in result


def test_detect_ecosystems_node() -> None:
    result = detect_ecosystems(["index.ts", "server.js"])
    assert "node" in result or "react" in result  # ts→node, tsx→react


def test_detect_ecosystems_react() -> None:
    result = detect_ecosystems(["app.tsx", "component.tsx"])
    assert "react" in result


def test_detect_ecosystems_python() -> None:
    result = detect_ecosystems(["main.py", "setup.py"])
    assert "python" in result


def test_detect_ecosystems_blockchain() -> None:
    result = detect_ecosystems(["token.sol", "contract.sol"])
    assert "blockchain" in result


def test_detect_ecosystems_empty() -> None:
    assert detect_ecosystems([]) == {}


def test_detect_ecosystems_by_filename() -> None:
    result = detect_ecosystems(["Gemfile"])
    assert "rails" in result


def test_detect_ecosystems_returns_dict() -> None:
    result = detect_ecosystems(["app.py"])
    assert isinstance(result, dict)


# ── files / detect_languages ─────────────────────────────────────────────────


def test_detect_languages_python() -> None:
    result = detect_languages(["main.py", "util.py"])
    assert "python" in result


def test_detect_languages_typescript() -> None:
    result = detect_languages(["server.ts", "types.tsx"])
    assert "typescript" in result


def test_detect_languages_multiple() -> None:
    result = detect_languages(["main.py", "app.rb", "service.go"])
    assert set(result) >= {"python", "ruby", "go"}


def test_detect_languages_unknown_ext() -> None:
    result = detect_languages(["file.xyz"])
    assert result == {}


# ── files / is_test_path ──────────────────────────────────────────────────────


def test_is_test_path_spec() -> None:
    assert is_test_path("user.spec.ts")


def test_is_test_path_test() -> None:
    assert is_test_path("user.test.js")


def test_is_test_path_underscore() -> None:
    assert is_test_path("user_spec.rb")


def test_is_test_path_false() -> None:
    assert not is_test_path("user.ts")


# ── timing / analyze_timing ───────────────────────────────────────────────────


def test_analyze_timing_empty() -> None:
    result = analyze_timing([])
    assert result["peak_hours"] == []
    assert result["avg_duration_minutes"] == 0.0
    assert result["work_mode"] == "solo"
    assert result["rhythm"] == "continuous"


def test_analyze_timing_returns_keys() -> None:
    result = analyze_timing(["2026-05-10T10:00:00Z", "2026-05-10T11:00:00Z"])
    for key in ("peak_hours", "avg_duration_minutes", "work_mode", "rhythm"):
        assert key in result


def test_analyze_timing_peak_hours() -> None:
    timestamps = [
        "2026-05-10T10:00:00Z",
        "2026-05-10T10:30:00Z",
        "2026-05-10T14:00:00Z",
    ]
    result = analyze_timing(timestamps)
    assert 10 in result["peak_hours"]


def test_analyze_timing_rhythm_continuous() -> None:
    # Two timestamps 30 min apart → avg gap < 1440 → continuous
    result = analyze_timing(["2026-05-10T10:00:00Z", "2026-05-10T10:30:00Z"])
    assert result["rhythm"] == "continuous"


def test_analyze_timing_rhythm_project_by_project() -> None:
    # Two timestamps 2 days apart → avg gap > 1440 → project-by-project
    result = analyze_timing(["2026-05-08T10:00:00Z", "2026-05-10T10:00:00Z"])
    assert result["rhythm"] == "project-by-project"


# ── tools / detect_workflow ───────────────────────────────────────────────────


def test_detect_workflow_tdd() -> None:
    # Test write before impl write, then bash
    seq = ["Write_test", "Write", "Bash"]
    assert detect_workflow(seq) == "tdd"


def test_detect_workflow_test_after() -> None:
    # Impl write before test write (no bash or bash doesn't matter)
    seq = ["Write", "Write_test"]
    assert detect_workflow(seq) == "test-after"


def test_detect_workflow_debug_driven() -> None:
    seq = ["Bash", "Read", "Edit", "Bash", "Read", "Edit", "Bash"]
    assert detect_workflow(seq) == "debug-driven"


def test_detect_workflow_refactor() -> None:
    seq = ["Edit", "Edit", "Edit"]
    assert detect_workflow(seq) == "refactor"


def test_detect_workflow_exploratory() -> None:
    seq = ["Read", "Read", "Read", "Read", "Write"]
    assert detect_workflow(seq) == "exploratory"


def test_detect_workflow_unknown_empty() -> None:
    assert detect_workflow([]) == "unknown"


def test_detect_workflow_unknown_single_tool() -> None:
    assert detect_workflow(["Bash"]) == "unknown"


# ── tools / build_tool_sequence ───────────────────────────────────────────────


def test_build_tool_sequence_includes_test_suffix() -> None:
    from models import DevProfileEvent, Session
    from datetime import datetime, timezone

    events = [DevProfileEvent.from_dict(e) for e in EVENTS_SESSION_1]
    session = Session(
        session_id="s",
        source="claude-code",
        started_at=datetime(2026, 5, 10, 10, 0, 0, tzinfo=timezone.utc),
        ended_at=None,
        duration_minutes=0,
        events=events,
    )
    seq = build_tool_sequence(session)
    # evt-4: Write + .spec.rb → Write_test
    assert "Write_test" in seq
    # evt-1: Bash + has_test_context=True → Bash_test
    assert "Bash_test" in seq


def test_build_tool_sequence_skips_non_pre_tool_use() -> None:
    from models import DevProfileEvent, Session
    from datetime import datetime, timezone

    events = [DevProfileEvent.from_dict(e) for e in EVENTS_SESSION_1]
    session = Session(
        session_id="s",
        source="claude-code",
        started_at=datetime(2026, 5, 10, 10, 0, 0, tzinfo=timezone.utc),
        ended_at=None,
        duration_minutes=0,
        events=events,
    )
    seq = build_tool_sequence(session)
    # Only pre_tool_use events should appear; stop/post_tool_use skipped
    assert len(seq) == 4  # evt-1, evt-3, evt-4, evt-5
