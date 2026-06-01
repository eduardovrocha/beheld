from __future__ import annotations

from typing import ClassVar, Optional

from extractors.commands import detect_platforms
from extractors.files import detect_ecosystems
from models import Session
from scorers.base import DataSource, L1Snapshot


# ── helpers (kept for back-compat with test_scorers.py imports) ─────────────


def _delta_score(recent: float, previous: float, max_weight: int) -> int:
    """Legacy delta-to-weight helper. R1.2 GrowthRateScorer no longer uses
    this — kept to avoid breaking pre-R1.2 unit tests in test_scorers.py
    that still import the symbol. Will be removed in R1.2b downstream
    test cleanup (Phase 5)."""
    if previous == 0 and recent == 0:
        return max_weight // 2
    if previous == 0:
        return max_weight
    ratio = (recent - previous) / previous
    normalized = max(0.0, min(1.0, ratio + 0.5))
    return int(normalized * max_weight)


def _metrics(sessions: list[Session]) -> dict:
    """Compute aggregate metrics over a session window. Used for the
    L2 (enrichment) trajectory inside GrowthRateScorer."""
    if not sessions:
        return {
            "avg_prompt": 0.0,
            "test_ratio": 0.0,
            "avg_tools": 0.0,
            "avg_duration": 0.0,
            "ecosystems": set(),
            "platforms": set(),
        }

    avgs: list[float] = []
    for s in sessions:
        if s.events:
            prompt_events = [e for e in s.events if e.prompt_length is not None]
            if prompt_events:
                avgs.append(sum(e.prompt_length for e in prompt_events) / len(prompt_events))
        elif s.avg_prompt_length > 0:
            avgs.append(s.avg_prompt_length)

    test_ratio = sum(1 for s in sessions if s.has_test_context) / len(sessions)
    avg_tools = sum(len(s.tools_used) for s in sessions) / len(sessions)
    avg_duration = sum(s.duration_minutes for s in sessions) / len(sessions)

    all_ext_keys: set[str] = set()
    all_commands: list[str] = []
    for s in sessions:
        all_ext_keys.update(s.file_extensions.keys())
        all_commands.extend(s.commands)

    fake_paths = [f"f{ext}" for ext in all_ext_keys]
    ecosystems = set(detect_ecosystems(fake_paths).keys())
    platforms = set(detect_platforms(all_commands).keys())

    return {
        "avg_prompt": sum(avgs) / len(avgs) if avgs else 0.0,
        "test_ratio": test_ratio,
        "avg_tools": avg_tools,
        "avg_duration": avg_duration,
        "ecosystems": ecosystems,
        "platforms": platforms,
    }


def _add_months(yyyy_mm: str, months: int) -> str:
    """Add `months` (signed) to a YYYY-MM string. Returns YYYY-MM."""
    if not yyyy_mm or len(yyyy_mm) < 7 or yyyy_mm[4] != "-":
        return yyyy_mm
    y = int(yyyy_mm[:4])
    m = int(yyyy_mm[5:7])
    total = y * 12 + (m - 1) + months
    new_y, new_m_idx = divmod(total, 12)
    return f"{new_y:04d}-{new_m_idx + 1:02d}"


def _window_avg_test_ratio(buckets: list) -> float:
    """Commit-weighted average test_ratio across a list of MonthlyBucket."""
    total_commits = sum(b.commit_count for b in buckets)
    if total_commits == 0:
        return 0.0
    return sum(b.test_ratio * b.commit_count for b in buckets) / total_commits


def _window_set(buckets: list, attr: str) -> set[str]:
    """Union of a set-valued attribute across buckets."""
    out: set[str] = set()
    for b in buckets:
        out.update(getattr(b, attr))
    return out


# ── scorer ──────────────────────────────────────────────────────────────────


class GrowthRateScorer:
    """
    R1.2 reescrita conforme spec §7.2 — trajetória intra-L1.

    Antes (legacy):
      compara janelas L2 (30d recent vs 30d previous) ou L2 recent vs
      L1 aggregate. Fallback neutral=50 quando L2 vazio.

    Agora (R1.2):
      - core (L1) é backbone temporal. Janela baseline = primeiros 12
        meses de commits importados, current = últimos 6.
      - Quatro signals normalizados (cada um em range anotado):
            ecosystems_signal = min(1, |Δ ecosystems(curr \\ base)| / 3)
            platforms_signal  = min(1, |Δ platforms(curr \\ base)| / 2)
            test_ratio_signal = clip((avg_test_curr - avg_test_base) / 0.20, -1, +1)
            diversity_signal  = clip((distinct_repos_curr - distinct_repos_base) / 3, -1, +1)
      - Pesos: ecosystems 0.30 · platforms 0.20 · test_ratio 0.25 · diversity 0.25
      - score_l1_only = clip(50 + l1_trajectory * 50, 0, 100)

    Edge cases:
      - History < 6 meses: retorna None (não há base pra trajetória).
      - History 6-18 meses: janelas 50/50 com confidence=low.
      - History ≥ 18 meses: 12mo baseline + 6mo current (canonical).

    Enrichment (L2 sessions) presente:
      l2_trajectory derivado das janelas (recent vs previous) em [-1, +1]
      blended = l1_trajectory * 0.60 + l2_trajectory * 0.40
      score   = clip(50 + blended * 50, 0, 100)

    fallback_when_enrichment_missing = True — quando recent/previous
    sessions são vazias, retorna o score baseado só em l1_trajectory.
    Não há neutral-50 fallback.
    """

    data_sources: ClassVar[list[DataSource]] = ["core", "enrichment"]
    fallback_when_enrichment_missing: ClassVar[bool] = True

    def score(
        self,
        recent: list[Session],
        previous: list[Session],
        l1: Optional[L1Snapshot] = None,
    ) -> Optional[int]:
        l1 = l1 or L1Snapshot()

        # Compute L1 trajectory from monthly_buckets if available.
        l1_traj = self._compute_l1_trajectory(l1)

        # No core data → fall back to legacy L2-only behavior, OR None
        # if we have nothing observed at all.
        if l1_traj is None:
            if not recent and not previous:
                # No core history AND no recent enrichment — dimension absent.
                return None
            return self._score_enrichment_only(recent, previous)

        # L1 trajectory exists. Blend with L2 if we have it.
        if recent or previous:
            l2_traj = self._compute_l2_trajectory(recent, previous)
            blended = l1_traj * 0.60 + l2_traj * 0.40
        else:
            blended = l1_traj

        return max(0, min(100, int(round(50 + blended * 50))))

    # ── L1 (core) intra-trajectory — the R1.2 §7.2 algorithm ─────────────

    def _compute_l1_trajectory(self, l1: L1Snapshot) -> Optional[float]:
        """Returns a float in roughly [-0.5, +1] when L1 has enough history,
        or None when history < 6 months (dimension absent).

        For 6-18 month history, splits timeline 50/50 (confidence=low — not
        currently surfaced in the wire format; reserved for R1.2c if a
        confidence field is added). For ≥18 months, uses canonical 12mo
        baseline + 6mo current windows."""
        if l1.is_empty or not l1.monthly_buckets:
            return None

        total_months = l1.total_history_months
        if total_months < 6:
            return None

        earliest = l1.earliest_commit[:7] if l1.earliest_commit else ""
        latest = l1.latest_commit[:7] if l1.latest_commit else ""
        if not earliest or not latest:
            return None

        if total_months >= 18:
            # Canonical: 12-month baseline + 6-month current, with a gap.
            baseline_end = _add_months(earliest, 11)
            current_start = _add_months(latest, -5)
        else:
            # 6-18 months: 50/50 split of the available history.
            half = total_months // 2
            baseline_end = _add_months(earliest, half - 1)
            current_start = _add_months(baseline_end, 1)

        baseline = l1.buckets_in_range(earliest, baseline_end)
        current = l1.buckets_in_range(current_start, latest)

        if not baseline or not current:
            return None

        # Spec §7.2 — four signals.
        base_eco = _window_set(baseline, "ecosystems")
        curr_eco = _window_set(current, "ecosystems")
        ecosystems_signal = min(1.0, len(curr_eco - base_eco) / 3)

        base_plat = _window_set(baseline, "platforms")
        curr_plat = _window_set(current, "platforms")
        platforms_signal = min(1.0, len(curr_plat - base_plat) / 2)

        base_test = _window_avg_test_ratio(baseline)
        curr_test = _window_avg_test_ratio(current)
        test_ratio_signal = max(-1.0, min(1.0, (curr_test - base_test) / 0.20))

        base_repos = _window_set(baseline, "repo_hashes")
        curr_repos = _window_set(current, "repo_hashes")
        diversity_signal = max(
            -1.0, min(1.0, (len(curr_repos) - len(base_repos)) / 3)
        )

        # Spec §7.2 weighted sum.
        return (
            ecosystems_signal * 0.30
            + platforms_signal * 0.20
            + test_ratio_signal * 0.25
            + diversity_signal * 0.25
        )

    # ── L2 (enrichment) trajectory — sign-aware deltas ───────────────────

    def _compute_l2_trajectory(
        self,
        recent: list[Session],
        previous: list[Session],
    ) -> float:
        """Returns a float in roughly [-1, +1] from session window deltas.

        Used to blend with the L1 trajectory at 0.60/0.40 weight when
        enrichment is present. When recent or previous is empty, the
        signal is muted (closer to 0) so it doesn't drag the L1 score."""
        r = _metrics(recent)
        p = _metrics(previous)

        signals: list[float] = []

        for r_val, p_val in (
            (r["avg_prompt"], p["avg_prompt"]),
            (r["test_ratio"], p["test_ratio"]),
            (r["avg_tools"], p["avg_tools"]),
            (r["avg_duration"], p["avg_duration"]),
        ):
            if p_val == 0:
                # No baseline — small positive bump if we're now active, else 0.
                signals.append(0.25 if r_val > 0 else 0.0)
            else:
                ratio = (r_val - p_val) / p_val
                signals.append(max(-1.0, min(1.0, ratio)))

        # Diversity (sessions): new ecosystems + platforms relative to previous.
        new_eco = len(r["ecosystems"] - p["ecosystems"])
        new_plat = len(r["platforms"] - p["platforms"])
        signals.append(min(1.0, (new_eco + new_plat) / 3))

        return sum(signals) / len(signals)

    # ── fallback when L1 is empty ────────────────────────────────────────

    def _score_enrichment_only(
        self,
        recent: list[Session],
        previous: list[Session],
    ) -> int:
        """Used when there's no L1 data but enrichment is present. Bridges
        the old behavior into the new normalized scoring."""
        l2_traj = self._compute_l2_trajectory(recent, previous)
        return max(0, min(100, int(round(50 + l2_traj * 50))))
