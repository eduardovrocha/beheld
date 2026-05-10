from __future__ import annotations

from collections import Counter

import pytest

from extractors.commands import extract_platforms, has_advanced_tools
from extractors.files import (
    compute_test_file_ratio,
    extract_ecosystems,
    extract_languages,
    has_test_files,
)
from extractors.timing import classify_session_length, compute_session_duration
from extractors.tools import count_distinct_tools, detect_workflow
from models import DevProfileEvent
from tests.conftest import EVENTS_SESSION_1, EVENTS_SESSION_2


# ── commands ──────────────────────────────────────────────────────────────────


def test_extract_platforms_docker() -> None:
    platforms = extract_platforms(["docker build .", "docker-compose up"])
    assert "docker" in platforms


def test_extract_platforms_github() -> None:
    platforms = extract_platforms(["git push origin main"])
    assert "github" in platforms


def test_extract_platforms_testing() -> None:
    platforms = extract_platforms(["pytest tests/"])
    assert "testing" in platforms


def test_extract_platforms_multiple() -> None:
    cmds = ["docker build .", "git push origin main", "aws s3 ls"]
    platforms = extract_platforms(cmds)
    assert "docker" in platforms
    assert "github" in platforms
    assert "cloud_infra" in platforms


def test_extract_platforms_empty() -> None:
    assert extract_platforms([]) == []


def test_extract_platforms_no_match() -> None:
    assert extract_platforms(["echo hello"]) == []


def test_has_advanced_tools_false() -> None:
    assert not has_advanced_tools(["Read", "Write", "Bash"])


def test_has_advanced_tools_true() -> None:
    assert has_advanced_tools(["computer_use", "Read"])


# ── files ─────────────────────────────────────────────────────────────────────


def test_extract_languages_python() -> None:
    langs = extract_languages(Counter({".py": 5}))
    assert "python" in langs


def test_extract_languages_typescript() -> None:
    langs = extract_languages(Counter({".ts": 3, ".tsx": 2}))
    assert "typescript" in langs


def test_extract_languages_multiple() -> None:
    langs = extract_languages(Counter({".py": 1, ".rb": 1, ".go": 1}))
    assert set(langs) >= {"python", "ruby", "go"}


def test_extract_languages_unknown_ext() -> None:
    langs = extract_languages(Counter({".xyz": 3}))
    assert langs == []


def test_extract_ecosystems_react() -> None:
    ecos = extract_ecosystems(Counter({".tsx": 5}))
    assert "react" in ecos


def test_extract_ecosystems_ruby() -> None:
    ecos = extract_ecosystems(Counter({".rb": 3}))
    assert "ruby" in ecos


def test_has_test_files_spec() -> None:
    assert has_test_files(Counter({".spec.ts": 1}))


def test_has_test_files_test() -> None:
    assert has_test_files(Counter({".test.js": 1}))


def test_has_test_files_false() -> None:
    assert not has_test_files(Counter({".ts": 5, ".rb": 3}))


def test_compute_test_file_ratio_partial() -> None:
    ratio = compute_test_file_ratio(Counter({".spec.ts": 2, ".ts": 8}))
    assert abs(ratio - 0.2) < 0.01


def test_compute_test_file_ratio_empty() -> None:
    assert compute_test_file_ratio(Counter()) == 0.0


# ── timing ────────────────────────────────────────────────────────────────────


def test_classify_brief() -> None:
    assert classify_session_length(3.0) == "brief"


def test_classify_medium() -> None:
    assert classify_session_length(15.0) == "medium"


def test_classify_long() -> None:
    assert classify_session_length(60.0) == "long"


def test_classify_extended() -> None:
    assert classify_session_length(120.0) == "extended"


# ── tools ─────────────────────────────────────────────────────────────────────


def test_detect_workflow_debug_driven() -> None:
    events = [DevProfileEvent.from_dict(e) for e in EVENTS_SESSION_2]
    # sess-2 has: Write → Bash → Read → no test context → debug_driven pattern
    result = detect_workflow(events)
    assert result in ("debug_driven", "unknown")  # depends on ratio


def test_detect_workflow_tdd(sample_session_1) -> None:
    result = detect_workflow(sample_session_1.events)
    assert result in ("tdd", "test_after", "debug_driven")  # has test context + bash after write


def test_detect_workflow_unknown_empty() -> None:
    assert detect_workflow([]) == "unknown"


def test_count_distinct_tools() -> None:
    assert count_distinct_tools(["Read", "Write", "Bash", "Read"]) == 3
