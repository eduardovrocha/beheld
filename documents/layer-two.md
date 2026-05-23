Como classificar o tipo de projeto a partir das conversas do Claude Code sem revelar o tema do negócio?

Camada 1 — Sinais estruturais (sem IA, só regex/keywords)
Camada 2 — Classificador técnico (IA com prompt restritivo)
Camada 3 — Sanitização pós-classificação

----

O que o Claude Code registra por padrão

Camada 1 — Detecção por comandos bash
Camada 2 — Detecção por caminhos de arquivo
Camada 3 — Padrões comportamentais (sem IA)
Camada 4 — Fingerprint do ambiente de desenvolvimento

----

O produto está bem definido agora. Alguns pontos que merecem atenção antes de codar:

A decisão mais importante: local-first
Colocar os dados 100% na máquina do usuário resolve o problema de confiança antes mesmo de ele aparecer. Ninguém precisa acreditar na sua política de privacidade — o dado simplesmente não sai da máquina sem ação explícita. Isso também significa que o MVP funciona sem backend, sem conta, sem infraestrutura — só extensão + CLI + SQLite local.
O ponto de fricção mais perigoso: VS Code + Continue.dev
Continue.dev não tem um hook oficial para interceptar conversas. A estratégia mais limpa é rodar um MCP server local na porta 7337 que o Continue.dev chama — você captura pelo servidor, não pelo cliente. Isso mantém a extensão VS Code como camada de UX (ícone na status bar, painel de configuração) enquanto o MCP server faz a coleta real. Funciona igual para Claude Code.
O consentimento granular é um diferencial
A maioria dos produtos de telemetria tem um toggle "on/off" só. Deixar o usuário escolher dimensão por dimensão (ativar análise de testes mas não horários, por exemplo) gera muito mais confiança — e mais dados de qualidade, porque o usuário não desativa tudo por precaução.
O sync no dia 7 é intencional
Não oferecer conta no onboarding elimina a percepção de "mais um SaaS que quer meus dados". Quando o convite aparece no dia 7, o usuário já viu o valor do perfil local e a decisão de sync é genuinamente informada.
Quando quiser partir para o desenvolvimento, a sequência natural é: hook Claude Code → MCP server local → scoring engine → extensão VS Code. Cada peça entrega valor independente e você pode lançar o MVP assim que as três primeiras estiverem prontas.

----

