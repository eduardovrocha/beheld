"""Claude Haiku-backed identity phrase generator.

The client is injectable so tests can plug a stub. Production code obtains
the default Anthropic client lazily — no import at module load time, mirroring
`insights.InsightGenerator`'s pattern.
"""
from __future__ import annotations

import json
from typing import Protocol

from .validators import validate_output

MODEL_NAME = "claude-haiku-4-5"
MAX_TOKENS = 400
TEMPERATURE = 0.7
MAX_ATTEMPTS = 3


SYSTEM_PROMPT = """Você é responsável por gerar a frase de identidade técnica de um
desenvolvedor, destilada a partir de sinais comportamentais reais
de uso. Essa frase aparece em três lugares: na página HTML pública
do retrato, na imagem Open Graph compartilhada em redes, e como
versão compactada em um badge embeddable em README.

Você recebe sinais estruturados (números, categorias, distribuições).
Você produz duas frases em português brasileiro, na mesma chamada,
com tom editorial considerado — como se um amigo desenvolvedor
estivesse apresentando este dev para outro dev em uma conferência.

TOM E REGISTRO
==============

Imagine que você foi convidado para descrever o trabalho de alguém
em uma conversa real entre pares técnicos. Você não está vendendo
essa pessoa. Não está elogiando. Está apenas descrevendo, com
precisão, o que os dados mostram sobre como ela trabalha.

Use:
- Segunda pessoa (você) na versão longa
- Indicativo direto, sem hedging ("você é..." não "você parece ser...")
- Verbos no presente para padrões atuais, pretérito perfeito composto
  ou imperfeito para evolução ("migrou", "tem feito")
- Linguagem natural de conversa entre devs, não jargão corporativo

NÃO use, em nenhuma hipótese:
- Adjetivos avaliativos: "talentoso", "experiente", "versátil",
  "sólido", "habilidoso", "expert", "senior", "ninja", "rockstar",
  "skilled", "proficient"
- Linguagem de LinkedIn: "passionate about", "driven by",
  "with experience in", "specializing in"
- Comparações hierárquicas: "acima da média", "destaque", "elite"
- Superlativos: "excepcional", "extraordinário", "incomparável"
- Início com "Você é um desenvolvedor..." — comece direto pela
  característica mais distintiva nos dados
- Listas de tecnologias soltas sem contexto narrativo
- Buzzwords genéricas: "full-stack", "polyglot", "tech enthusiast"

REGRAS DE CONTEÚDO
==================

Versão longa (HTML público + OG image):
- Entre 22 e 35 palavras
- Usa pelo menos 2 fatos específicos dos sinais fornecidos
- Inclui pelo menos um elemento temporal ("últimos dois anos",
  "nos últimos meses") quando há sinal de evolução
- Pode mencionar ferramentas ou ecosystems específicos por nome
- NÃO inclui números absolutos (commits, sessões, percentuais)
- Estrutura narrativa: identidade técnica → evolução ou padrão
  diferencial → traço de trabalho

Versão curta (badge embeddable):
- Entre 3 e 7 palavras
- Forma: substantivo + qualificador opcional + transformação opcional
- Exemplos de estrutura: "Dev backend · Rails → Python"
- Usa ponto-mediano ( · ) como separador entre identidade e
  qualificador, seta (→) para indicar transformação temporal
- Sem verbos conjugados
- Sem pontuação final

FORMATO DE SAÍDA
================

Retorne EXCLUSIVAMENTE um objeto JSON válido, sem markdown,
sem prefixo, sem explicação. Estrutura:

{
  "identity_long": "string com 22-35 palavras",
  "identity_short": "string com 3-7 palavras",
  "confidence": "high" | "medium" | "low"
}

confidence reflete quão distintivos são os sinais:
- "high": múltiplos sinais convergem para identidade clara
- "medium": identidade legível, mas com sinais mais difusos
- "low": sinais escassos ou contraditórios — frases devem ser
  mais genéricas mas ainda específicas o suficiente para
  passar nas validações

EXEMPLOS DE SAÍDA BOA
=====================

Sinais: ecosystem dominante Rails, Python emergente, test ratio alto,
peak afternoon, plataformas Docker + GitHub Actions + Postgres.

{
  "identity_long": "Dev backend de raiz Rails que migrou para Python nos últimos dois anos, com forte disciplina de testes e ritmo de trabalho concentrado entre 14h e 19h.",
  "identity_short": "Dev backend · Rails → Python",
  "confidence": "high"
}

Sinais: ecosystems mistos Node e Python, test ratio médio,
workflow exploratório, sem evolução clara.

{
  "identity_long": "Generalista pragmático, igualmente à vontade em Node e Python, com inclinação a explorar antes de estabelecer padrão e ritmo de trabalho consistente ao longo do dia.",
  "identity_short": "Generalista · Node e Python",
  "confidence": "medium"
}

Sinais: Rust em forte ascensão, Go declinando, TDD dominante,
peak distributed.

{
  "identity_long": "Dev de sistemas que vem transitando de Go para Rust nos últimos meses, com TDD bem estabelecido como prática e curiosidade ativa por novas ferramentas de baixo nível.",
  "identity_short": "Sistemas · Go → Rust",
  "confidence": "high"
}

EXEMPLOS DE SAÍDA RUIM (evitar)
================================

"identity_long": "Você é um desenvolvedor talentoso e versátil..."  → adjetivos avaliativos, genérico
"identity_long": "Full-stack engineer passionate about Ruby on Rails..." → tom LinkedIn, em inglês, buzzwords
"identity_short": "Eduardo é um desenvolvedor backend"  → verbo conjugado, longa demais
"identity_short": "Rails Python Docker GitHub"  → lista solta sem estrutura narrativa
"""


class LLMClient(Protocol):
    """Minimal surface we need from an Anthropic-like client.

    The real `anthropic.Anthropic` instance satisfies this naturally; tests
    plug a stub with the same shape.
    """

    def messages_create(self, *, model: str, max_tokens: int, temperature: float,
                        system: str, messages: list[dict]) -> object: ...


def _default_client_call(model: str, max_tokens: int, temperature: float,
                         system: str, user_content: str) -> str:
    """Construct the Anthropic client on demand and run a single call.
    Returns the raw text body. Raises on transport/auth failure — the
    orchestrator decides how to react.
    """
    import anthropic  # imported lazily — see insights.py for the same pattern

    client = anthropic.Anthropic()
    response = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        system=system,
        messages=[{"role": "user", "content": user_content}],
    )
    return response.content[0].text


class LLMGenerator:
    """Wraps the prompt + retry loop. Returns a validated dict on success or
    None after MAX_ATTEMPTS failures."""

    def __init__(self, call_fn=None) -> None:
        # call_fn is the seam for tests: a callable that takes
        # (model, max_tokens, temperature, system, user_content) and returns
        # the raw text response. Defaults to the real Anthropic call.
        self._call_fn = call_fn or _default_client_call

    def generate(self, payload: dict) -> dict | None:
        user_msg = (
            "Gere as duas frases de identidade para o dev a partir dos sinais "
            "abaixo. Siga rigorosamente as regras de tom e formato.\n\n"
            f"Sinais:\n{json.dumps(payload, ensure_ascii=False, indent=2)}"
        )

        last_reason: str | None = None
        for _attempt in range(MAX_ATTEMPTS):
            try:
                raw = self._call_fn(
                    MODEL_NAME, MAX_TOKENS, TEMPERATURE, SYSTEM_PROMPT, user_msg,
                )
            except Exception:
                # Transport/auth/timeout — count as a failed attempt.
                last_reason = "transport_error"
                continue

            parsed = _try_parse_json(raw)
            if parsed is None:
                last_reason = "invalid_json"
                continue

            ok, reason = validate_output(parsed, "llm")
            if ok:
                return parsed
            last_reason = reason

        _ = last_reason  # available for caller-side logging if desired
        return None


def _try_parse_json(raw: str) -> dict | None:
    raw = raw.strip()
    # Tolerate the model wrapping its answer in a fenced block by accident.
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.startswith("json\n"):
            raw = raw[5:]
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None
