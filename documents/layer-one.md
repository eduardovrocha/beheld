Como classificar o tipo de projeto a partir das conversas do Claude Code sem revelar o tema do negócio?


Boa pergunta — essa é a parte mais delicada do sistema. A lógica central é: analisar sinais técnicos, nunca semânticos de negócio.
Funciona em três camadas:
Camada 1 — Sinais estruturais (sem IA, só regex/keywords)
Você extrai padrões objetivos dos logs antes de qualquer análise:

nomes de arquivos e pastas (/models/, schema.rb, contracts/, pages/)
comandos executados (docker-compose, hardhat, rails db:migrate, flutter pub get)
dependências mencionadas (stripe, web3.js, prisma, pytest, rspec)
ferramentas de teste presentes (describe, it(, test(, RSpec, Playwright)

Camada 2 — Classificador técnico (IA com prompt restritivo)
Aqui está o ponto crítico. O prompt para o classificador precisa ser explicitamente proibitivo:
Você é um classificador de arquétipo técnico de software.

Analise os sinais abaixo e retorne APENAS a categoria técnica.
NÃO mencione, infira, ou registre: nome de empresa, setor de negócio, 
nome de usuário, domínio de aplicação, ou qualquer dado identificável.

Sinais técnicos extraídos:
- Dependências: stripe, prisma, next-auth, react-query
- Comandos: docker-compose up, prisma migrate
- Arquivos: /api/webhooks/, /components/dashboard/, /lib/billing/
- Padrões de teste: jest, testing-library

Categorias disponíveis:
[ SaaS_B2B | API_Backend | Financeiro_Dados | Mobile | Web3 | Automacao_IA | Biblioteca | CLI_Tool ]

Responda apenas com JSON:
{
  "categoria": "SaaS_B2B",
  "confianca": 0.91,
  "sinais_usados": ["stripe", "billing", "dashboard", "prisma migrate"],
  "sinais_ignorados": []
}
A chave é que sinais_usados lista só o que é técnico. Se o modelo tentar colocar algo como "fintech" ou "e-commerce" no output, o parser rejeita e reclassifica.
Camada 3 — Sanitização pós-classificação
Antes de salvar qualquer coisa no perfil, passa por um sanitizador que:
pythonTERMOS_NEGOCIO_PROIBIDOS = [
    # setores
    "fintech", "healthtech", "edtech", "agritech", "legaltech",
    "e-commerce", "marketplace", "banco", "hospital", "escola",
    # entidades
    r"\b[A-Z][a-z]+\s(Inc|Ltd|SA|LTDA|ME)\b",  # nomes de empresa
    r"\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b",  # emails
    r"\bwww\.[a-z]+\.[a-z]{2,}\b",  # domínios
]

def sanitizar_classificacao(resultado: dict) -> dict:
    texto = json.dumps(resultado)
    for termo in TERMOS_NEGOCIO_PROIBIDOS:
        if re.search(termo, texto, re.IGNORECASE):
            resultado["sinais_usados"] = [
                s for s in resultado["sinais_usados"]
                if not re.search(termo, s, re.IGNORECASE)
            ]
    return resultado
O pipeline completo fica assim:
log bruto → extrator de sinais técnicos → prompt restritivo → 
output JSON → sanitizador → categoria salva no perfil
O tema do negócio nunca entra no pipeline porque o extrator de sinais já filtra para só passar artefatos técnicos (imports, comandos, nomes de arquivo, dependências). O que chega ao classificador é algo como ["stripe", "prisma", "docker-compose", "jest"] — completamente agnóstico ao domínio.
Uma boa regra empírica: se o sinal não apareceria num package.json, Gemfile, requirements.txt, ou num comando de terminal, ele não entra na análise.
Quer que eu gere o código completo do extrator de sinais técnicos, ou prefere começar pelo hook MCP que alimenta tudo isso?