from __future__ import annotations

import json
import os
from datetime import datetime, timezone

from models import Scores
from storage.sqlite import DevProfileDB


class InsightGenerator:
    """Generates developer insights with a 24-hour SQLite cache."""

    def __init__(self, db: DevProfileDB) -> None:
        self.db = db

    def generate(self) -> dict:
        cached = self.db.get_profile("insights_cache")
        cached_at_str = self.db.get_profile("insights_cached_at")

        if cached and cached_at_str:
            try:
                cached_at = datetime.fromisoformat(cached_at_str)
                if (datetime.now(timezone.utc) - cached_at).total_seconds() < 86400:
                    return json.loads(cached)
            except Exception:
                pass

        scores = self.db.get_current_scores()
        if scores is None or scores.sessions_analyzed < 5:
            return {"insights": [], "generated_at": None, "requires_sessions": 5}

        result = self._generate_with_ai(scores) if self._has_api_key() else self._generate_rule_based(scores)
        self._cache(result)
        if result.get("insights"):
            self.db.set_profile("top_insight", result["insights"][0])
        return result

    # ── private ───────────────────────────────────────────────────────────────

    def _has_api_key(self) -> bool:
        return bool(os.environ.get("ANTHROPIC_API_KEY", ""))

    def _cache(self, result: dict) -> None:
        self.db.set_profile("insights_cache", json.dumps(result))
        self.db.set_profile("insights_cached_at", datetime.now(timezone.utc).isoformat())

    def _generate_with_ai(self, scores: Scores) -> dict:
        try:
            import anthropic

            prompt = (
                f"Developer profile scores (0-100):\n"
                f"  prompt_quality={scores.prompt_quality}\n"
                f"  test_maturity={scores.test_maturity}\n"
                f"  tech_breadth={scores.tech_breadth}\n"
                f"  growth_rate={scores.growth_rate}\n"
                f"  overall={scores.overall}\n"
                f"  sessions_analyzed={scores.sessions_analyzed}\n\n"
                f"Generate 2-3 brief, actionable insights for this developer. "
                f"Focus on technical growth and coding practices. "
                f"Do NOT mention business, customers, revenue, or products. "
                f"Reply with a JSON array of strings: [\"insight1\", \"insight2\"]"
            )
            client = anthropic.Anthropic()
            response = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=300,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = response.content[0].text.strip()
            insights = json.loads(raw)
            if isinstance(insights, list) and all(isinstance(i, str) for i in insights):
                return {
                    "insights": insights[:4],
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                    "model": "claude-sonnet-4-6",
                }
        except Exception:
            pass
        return self._generate_rule_based(scores)

    def _generate_rule_based(self, scores: Scores) -> dict:
        items: list[str] = []
        overall = scores.overall
        pq, tm, tb, gr = scores.prompt_quality, scores.test_maturity, scores.tech_breadth, scores.growth_rate
        n = scores.sessions_analyzed

        if overall >= 80:
            items.append(f"Top {100 - overall}% em score geral — excelente uso do Claude")
        elif overall >= 60:
            items.append(f"Score geral {overall}/100 — acima da média")

        if pq >= 75:
            items.append("Qualidade de prompt acima da média — contexto rico e sessões longas")
        elif pq < 40:
            items.append("Prompts curtos detectados — adicionar contexto de arquivo melhora as respostas")

        if tm >= 70:
            items.append("Alta maturidade em testes — TDD e test coverage bem integrados")
        elif tm < 35:
            items.append("Baixa cobertura de testes — oportunidade de crescimento com TDD")

        if tb >= 80:
            items.append("Alta diversidade técnica — múltiplos ecossistemas e plataformas")

        if gr > 55:
            items.append("Crescimento positivo nos últimos 30 dias")
        elif gr < 45:
            items.append("Score estável — consistência é um ativo")

        if not items:
            items.append(f"Score geral: {overall}/100 baseado em {n} sessões")

        return {
            "insights": items[:4],
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "model": "rule-based",
        }
