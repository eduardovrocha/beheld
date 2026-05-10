from __future__ import annotations

from extractors.tools import build_tool_sequence, detect_workflow
from models import Session


def classify_workflow(session: Session) -> str:
    seq = build_tool_sequence(session)
    return detect_workflow(seq)
