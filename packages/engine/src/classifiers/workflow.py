from __future__ import annotations

from models import Session
from extractors.tools import detect_workflow


def classify_workflow(session: Session) -> str:
    return detect_workflow(session.events)
