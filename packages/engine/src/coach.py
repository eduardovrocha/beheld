"""Coach feature: deterministic pattern detection + workflow metrics.

This module is intentionally separate from `insights.py` (which is the legacy
LLM-driven insight cache). The coach pipeline is:

    sessions  ──compute_workflow_metrics──▶  WorkflowMetrics
                                                    │
                                                    ▼
                                      detect_patterns ──▶ list[Pattern]

Both functions are pure. The output of `compute_workflow_metrics` is exactly
the shape that Phase 5 (.beheld) embeds in `signals.workflow_metrics` — so
the bundle hash stays deterministic across runs.

Patterns are derived, never persisted, never bundled.
"""
from __future__ import annotations

import statistics
from collections import Counter
from typing import Optional

from extractors.files import EXTENSION_TO_ECOSYSTEM
from models import (
    CoachingGuidance,
    Pattern,
    Scores,
    Session,
    SessionContext,
    WorkflowMetrics,
)


# Cap for ratios that would otherwise overflow / produce Infinity.
# Keeps WorkflowMetrics safe for canonical JSON serialization.
_RATIO_CAP = 100.0


# ── compute_workflow_metrics ──────────────────────────────────────────────────


_WRITE_TOOLS = {"write", "write_file", "create_file"}
_READ_TOOLS = {"read", "read_file"}
_EDIT_TOOLS = {"edit", "str_replace", "str_replace_based_edit", "multiedit"}
_BASH_TOOLS = {"bash", "bash_20241022", "execute_bash", "run_terminal_cmd"}


def _normalize_tool(tool: str) -> str:
    t = tool.lower().split(":")[0]
    if t.endswith("_test"):
        t = t[:-5]
    if t in _WRITE_TOOLS:
        return "write"
    if t in _READ_TOOLS:
        return "read"
    if t in _EDIT_TOOLS:
        return "edit"
    if t in _BASH_TOOLS:
        return "bash"
    return t


def _is_test_marker(tool: str) -> bool:
    return "_test" in tool.lower()


def compute_workflow_metrics(sessions: list[Session]) -> WorkflowMetrics:
    """Deterministic, scalar metrics over a session window.

    Pure function: same input → same output. Never produces Infinity or NaN.
    All ratios are clamped to [0, _RATIO_CAP] and durations are non-negative.
    """
    if not sessions:
        return WorkflowMetrics()

    n = len(sessions)

    test_after_ratio = sum(1 for s in sessions if s.workflow_pattern == "test-after") / n
    test_first_ratio = sum(1 for s in sessions if s.workflow_pattern == "tdd") / n

    total_bash = 0
    total_read = 0
    for s in sessions:
        for raw in s.tool_sequence:
            norm = _normalize_tool(raw)
            if norm == "bash":
                total_bash += 1
            elif norm == "read":
                total_read += 1
    if total_read == 0:
        bash_to_read_ratio = min(float(total_bash), _RATIO_CAP) if total_bash else 0.0
    else:
        bash_to_read_ratio = min(total_bash / total_read, _RATIO_CAP)

    durations = [s.duration_minutes for s in sessions if s.duration_minutes > 0]
    session_avg_duration_min = sum(durations) / len(durations) if durations else 0.0

    test_after_durations = [
        s.duration_minutes
        for s in sessions
        if s.workflow_pattern == "test-after" and s.duration_minutes > 0
    ]
    median_test_delay_min = (
        statistics.median(test_after_durations) if test_after_durations else 0.0
    )

    mixed_durations = [
        s.duration_minutes
        for s in sessions
        if s.duration_minutes > 0
        and any(_normalize_tool(t) == "edit" for t in s.tool_sequence)
        and any(_is_test_marker(t) for t in s.tool_sequence)
    ]
    edit_to_test_lag_min = statistics.median(mixed_durations) if mixed_durations else 0.0

    prompts_with_weights = [
        (s.avg_prompt_length, max(s.event_count, 1))
        for s in sessions
        if s.avg_prompt_length > 0
    ]
    if prompts_with_weights:
        total_weight = sum(w for _, w in prompts_with_weights)
        prompt_avg_chars = (
            sum(v * w for v, w in prompts_with_weights) / total_weight
        )
        prompt_median_chars = statistics.median(v for v, _ in prompts_with_weights)
    else:
        prompt_avg_chars = 0.0
        prompt_median_chars = 0.0

    varieties = [len(set(s.tools_used)) for s in sessions if s.tools_used]
    tool_variety_avg = sum(varieties) / len(varieties) if varieties else 0.0

    eco_counter: Counter = Counter()
    for s in sessions:
        for ext, count in s.file_extensions.items():
            eco = EXTENSION_TO_ECOSYSTEM.get(ext)
            if eco:
                eco_counter[eco] += count
    total_eco = sum(eco_counter.values())
    if total_eco > 0:
        ecosystem_concentration = sum((c / total_eco) ** 2 for c in eco_counter.values())
    else:
        ecosystem_concentration = 0.0

    return WorkflowMetrics(
        test_after_ratio=test_after_ratio,
        test_first_ratio=test_first_ratio,
        median_test_delay_min=median_test_delay_min,
        edit_to_test_lag_min=edit_to_test_lag_min,
        bash_to_read_ratio=bash_to_read_ratio,
        prompt_avg_chars=prompt_avg_chars,
        prompt_median_chars=prompt_median_chars,
        session_avg_duration_min=session_avg_duration_min,
        tool_variety_avg=tool_variety_avg,
        ecosystem_concentration=ecosystem_concentration,
    )


# ── coaching_guidance constant ────────────────────────────────────────────────

COACHING_GUIDANCE = CoachingGuidance(
    tone="pt-BR, segunda pessoa, conciso, sem julgamento",
    must=[
        "Cite no máximo 1 padrão por intervenção — o de maior severity com applies_to_current_session=true",
        "Use os números do campo `metric` — não invente porcentagens",
        "Sugira UMA ação concreta executável agora nesta sessão",
        "Se nenhum padrão aplica à sessão atual, fique em silêncio",
    ],
    must_not=[
        "Não listar todos os padrões como bullets",
        "Não usar score numérico como argumento ('seu score é 18')",
        "Não recomendar ferramentas externas — só o que já está na sessão",
        "Não repetir o coaching se já foi entregue nas últimas mensagens",
    ],
    good_example=(
        "Notei que normalmente você escreve o teste depois — quer começar essa "
        "feature pelo spec e deixar a implementação atrás?"
    ),
    bad_example=(
        "Seu test_maturity é 18/100, considere adotar TDD. "
        "(genérico, julga, cita número de score)"
    ),
)


# ── detect_patterns ───────────────────────────────────────────────────────────

# Ecosystems where each pattern is relevant. Empty set = universal.
_PATTERN_ECOSYSTEMS: dict[str, set[str]] = {
    "test_after_dominant": {"rails", "react", "node", "python", "go"},
    "test_first_strong": {"rails", "react", "node", "python", "go"},
    "debug_driven_bash_heavy": set(),
    "narrow_ecosystem": set(),
    "prompt_too_short": set(),
}


def _applies_to(pattern_id: str, ctx: SessionContext) -> bool:
    affinity = _PATTERN_ECOSYSTEMS.get(pattern_id)
    if affinity is None:
        return False
    if not affinity:  # universal pattern
        return True
    return any(eco in affinity for eco in ctx.ecosystems_recent)


def detect_patterns(
    metrics: WorkflowMetrics,
    scores: Scores,
    context: Optional[SessionContext] = None,
) -> list[Pattern]:
    """Derive behavioural patterns from already-computed metrics.

    Pure function. Same metrics → same patterns. No side effects.
    Confidence is a linear scaling from the threshold (entry confidence) to a
    saturation point (confidence=1.0).
    """
    ctx = context or SessionContext()
    patterns: list[Pattern] = []

    # 1. test_after_dominant — >= 60% test-after sessions
    if metrics.test_after_ratio >= 0.6:
        confidence = min((metrics.test_after_ratio - 0.5) * 2.0, 1.0)
        severity = "high" if metrics.test_after_ratio >= 0.8 else "medium"
        patterns.append(Pattern(
            id="test_after_dominant",
            label="Testes escritos após o código",
            evidence=(
                f"{metrics.test_after_ratio * 100:.0f}% das sessões classificadas como "
                f"test-after, com mediana de {metrics.median_test_delay_min:.0f} min de "
                "duração nessas sessões."
            ),
            metric={
                "ratio": round(metrics.test_after_ratio, 3),
                "median_session_min": round(metrics.median_test_delay_min, 1),
            },
            confidence=round(confidence, 2),
            trend_30d="stable",
            severity=severity,
            applies_to_current_session=_applies_to("test_after_dominant", ctx),
        ))

    # 2. test_first_strong — >= 25% TDD sessions (a strength to reinforce)
    if metrics.test_first_ratio >= 0.25:
        confidence = min(metrics.test_first_ratio * 2.0, 1.0)
        patterns.append(Pattern(
            id="test_first_strong",
            label="Padrão TDD presente",
            evidence=(
                f"{metrics.test_first_ratio * 100:.0f}% das sessões iniciam pelos testes."
            ),
            metric={"ratio": round(metrics.test_first_ratio, 3)},
            confidence=round(confidence, 2),
            trend_30d="stable",
            severity="low",
            applies_to_current_session=_applies_to("test_first_strong", ctx),
        ))

    # 3. debug_driven_bash_heavy — bash >= 4× reads
    if metrics.bash_to_read_ratio >= 4.0:
        ratio = metrics.bash_to_read_ratio
        confidence = min((ratio - 3.0) / 5.0, 1.0)
        severity = "medium" if ratio >= 8.0 else "low"
        patterns.append(Pattern(
            id="debug_driven_bash_heavy",
            label="Loop de debug com pouca leitura prévia",
            evidence=(
                f"Bash representa {ratio:.1f}× o uso de Read — indica iteração "
                "via tentativa em vez de leitura do código."
            ),
            metric={"bash_to_read_ratio": round(ratio, 2)},
            confidence=round(confidence, 2),
            trend_30d="stable",
            severity=severity,
            applies_to_current_session=_applies_to("debug_driven_bash_heavy", ctx),
        ))

    # 4. narrow_ecosystem — Herfindahl >= 0.7 (one ecosystem dominates)
    if metrics.ecosystem_concentration >= 0.7:
        conc = metrics.ecosystem_concentration
        confidence = min((conc - 0.6) / 0.4, 1.0)
        patterns.append(Pattern(
            id="narrow_ecosystem",
            label="Concentração em um único ecossistema",
            evidence=(
                f"Índice de concentração de ecossistemas em {conc:.2f} "
                "(0 = diversidade máxima, 1 = mono-ecossistema)."
            ),
            metric={"hhi": round(conc, 3)},
            confidence=round(confidence, 2),
            trend_30d="stable",
            severity="low",
            applies_to_current_session=_applies_to("narrow_ecosystem", ctx),
        ))

    # 5. prompt_too_short — median prompt < 80 chars
    if 0 < metrics.prompt_median_chars < 80:
        median = metrics.prompt_median_chars
        confidence = min((80 - median) / 60.0, 1.0)
        severity = "medium" if median < 50 else "low"
        patterns.append(Pattern(
            id="prompt_too_short",
            label="Prompts curtos podem limitar o contexto",
            evidence=(
                f"Mediana de {median:.0f} caracteres por prompt — prompts mais ricos "
                "costumam produzir respostas mais precisas."
            ),
            metric={"median_chars": round(median, 0)},
            confidence=round(confidence, 2),
            trend_30d="stable",
            severity=severity,
            applies_to_current_session=_applies_to("prompt_too_short", ctx),
        ))

    return patterns
