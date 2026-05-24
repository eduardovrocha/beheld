# Beheld — Análise de Mercado

> Última atualização: 2026-05-21
> Escopo: estado da contratação de devs, colapso do sinal, substrato técnico, mapa competitivo, encaixe estratégico do Beheld.

---

## Sumário executivo

Em 2026 três forças se sobrepõem: (1) a demanda por devs está estruturalmente apertada — tempo de contratação de seniors quase dobrou em dois anos; (2) o sinal tradicional (currículo + entrevista) desabou — entre 38% e 48% dos candidatos técnicos mostram indícios de uso não autorizado de IA em entrevistas, e a Gartner projeta que 1 em cada 4 perfis de candidato será falso até 2028; (3) o substrato que o Beheld depende — adoção de assistentes de código IA — passou de 41% para 73% das equipes em um ano.

Existe um espaço branco bem definido: ninguém hoje opera como testemunha técnica do trabalho real do dev. Plataformas de teste pontuam, plataformas de analytics medem para gerentes, marketplaces vendem acesso a candidatos. O Beheld observa e relata — e isso é diferente de tudo que existe.

A janela é agora porque o sinal alternativo (avaliações pontuais) está colapsando enquanto o substrato necessário (sessões assinadas de Claude Code/Cursor/Copilot) atingiu massa crítica simultaneamente. Nenhuma das duas condições estava madura há 24 meses.

---

## 1. Estado do mercado de contratação dev em 2026

### 1.1 Mercado bifurcado

O mercado de devs em 2026 não é um mercado — são dois rodando em direções opostas.

| Segmento | Movimento desde fev/2020 |
|----------|--------------------------|
| Listagens de SE geral | -49% [^pin] |
| Listagens de ML engineer | +59% [^pin] |
| Listagens com skills de IA (US) | +153% jan/2024→jan/2026 [^pin] |
| Geração de listings GenAI (Indeed) | +170% em 12 meses [^pin] |

Recrutadores rodam dois pipelines no mesmo dashboard: um mercado contraído para devs generalistas, um mercado escasso e caro para IA/ML [^pin]. Devs full-stack e front-end enfrentam mais seletividade, ciclos mais longos e exigência crescente de senioridade e contexto de produto [^bluecoders].

### 1.2 Tempo e custo

| Métrica | 2024 | 2026 |
|---------|------|------|
| Time-to-hire — senior dev (local) | 52 dias | 90+ dias [^fullscale] |
| Tempo médio engenharia (global) | — | 62 dias [^rockstar] |
| Entrevistas por contratação | 14 (2021) | 20 — alta de 42% [^rockstar] |
| Custo típico em marketplace | — | ~$25K por engenheiro experiente [^startup101] |

Três forças simultâneas explicam o aperto: demanda triplicou para seniors com a adoção de IA, 18% dos seniors nascidos 1970–1980 se aposentam antes de 2027, e restrições H-1B cortaram ~45.000 devs/ano do pool americano [^fullscale]. Cada uma sozinha apertaria; juntas criaram uma escassez estrutural que contratação local não resolve em prazo aceitável.

### 1.3 O diagnóstico que importa

A síntese mais relevante do mercado vem de uma análise de set/2025: o problema da contratação deixou de ser falta de currículos — virou problema de sinal [^rockstar]. Empresas têm sinais demais, fracos demais, e poucas formas confiáveis de identificar quem realmente entrega.

Esse é o problema que o Beheld endereça. Não é um problema novo, mas é a primeira vez que ele aparece nesta intensidade e com substrato técnico para uma resposta estrutural.

---

## 2. O colapso do sinal

### 2.1 IA quebrou a entrevista técnica

Entre julho/2025 e janeiro/2026, a Fabric analisou 19.368 entrevistas técnicas e encontrou 38,5% de candidatos exibindo sinais de uso não autorizado de IA. Em vagas puramente técnicas, o número sobe para 48%. Juniors (0–5 anos) cometem o dobro da taxa de seniors [^werecruit].

A prevalência subiu de 15% para 35% em apenas seis meses [^werecruit]. Ferramentas como Cluely, Interview Coder e LeetCode Wizard operam via overlays gráficos invisíveis ao screen-sharing — o entrevistador vê o IDE "limpo" e o candidato vê respostas do LLM sobrepostas [^werecruit]. Vendors de proctoring reivindicam 85–95% de detecção, mas seis novas ferramentas apareceram só em 2025 [^werecruit]. A detecção sempre vai estar um ou dois passos atrás.

O diagnóstico técnico subjacente: testar se o código roda virou commodity. O que se mede agora é acesso a ferramentas, não capacidade de engenharia [^humanly].

### 2.2 Fraude de currículo escalou

| Sinal | Dado |
|-------|------|
| Recrutadores que já encontraram credenciais fabricadas, work samples gerados por IA ou deepfakes | >70% [^valid8] |
| Candidatos que usam IA na aplicação (Gartner) | 39% [^metaview] |
| Candidatos que fazem entrevistas com deepfake | 6% [^metaview] |
| Projeção Gartner: perfis de candidato falsos até 2028 | 25% [^metaview] |
| Profissionais americanos que admitem exagerar responsabilidades/datas (FlexJobs) | 10% [^rival] |
| Hiring managers que descartam aplicações IA-geradas (Forbes 2024) | até 80% [^wiki] |

A nota mais importante: verificações tradicionais — referências, educação, histórico de emprego — não são mais confiáveis contra deception moderna [^evefin].

### 2.3 A queda da confiança nos próprios outputs de IA

| Métrica | 2024 | 2026 |
|---------|------|------|
| Devs que usam ou planejam usar ferramentas de IA | — | 84% [^uvik] |
| Devs que confiam no output da IA | 40% | 29% [^uvik] |
| Code churn (código reescrito em ≤2 semanas) | 3,1% (2020) | 5,7% (2024) [^uvik] |

O gap entre adoção e confiança é o motor que mais ajuda o Beheld. Quanto mais devs usam IA e menos confiam no que ela produz, mais valiosa fica uma forma de demonstrar como o dev realmente trabalha com IA — não se usa, mas como usa.

---

## 3. O substrato técnico

O Beheld depende de duas fontes independentes: histórico git (L1) e sessões de assistentes de código IA (L2). L1 sempre existiu. L2 só existe em escala desde meados de 2025.

### 3.1 Adoção de assistentes de código

| Fonte | Métrica | Dado |
|-------|---------|------|
| Pragmatic Engineer (n=15.000), fev/2026 | Equipes que usam IA de coding diariamente | 73% (era 41% em 2025) [^gradually] |
| Stack Overflow 2025 (n=49.000+) | Devs que usam ou planejam usar | 84% [^uvik] |
| Google DORA 2025 | Times que usam IA no trabalho diariamente | 90% [^uvik] |

### 3.2 Distribuição entre as ferramentas

| Ferramenta | Uso primário (Q1 2026) | Trajetória | CSAT / "most loved" |
|------------|------------------------|------------|---------------------|
| Claude Code | 28% [^digitalapplied] / 18% adoção (24% US-CAN) [^uvik41] | Awareness 31→49→57% em 9 meses [^uvik41] | 91% CSAT, 46% "most loved" [^serpsculpt] |
| Cursor | 24% [^digitalapplied] | $2B ARR fev/2026, crescimento desacelerando [^uvik] | 19% "most loved" |
| GitHub Copilot | 58% any-use, share primária caindo [^digitalapplied] | 20M users, 4,7M pagantes [^uvik] | 9% "most loved" |

Pontos relevantes para o Beheld:

- **Multi-tool é o padrão.** Devs rodam stack de três ferramentas; raramente comprometem com uma só [^digitalapplied]. Implicação: integração L2 não pode privilegiar uma única IDE.
- **Claude Code lidera CSAT e "most loved"** [^serpsculpt] — o segmento de devs mais engajados, que tendem a ser early-adopters do Beheld, está concentrado aí. Alinhado com a integração inicial.
- **Adoção é heterogênea por porte.** Pequenas empresas: 75% Claude Code; enterprise (10K+): Copilot domina [^gradually]. Para a Fase 1 (startups/médias empresas como compradoras), a sobreposição é favorável.
- **Revisão > escrita.** Devs gastam 11,4h/semana revisando código gerado por IA vs 9,8h escrevendo — reversão do padrão de 2024 [^digitalapplied]. Padrão observável e capturável como sinal L2 de senioridade ("o dev revisa mais do que escreve").

### 3.3 Implicação substantiva

A janela do Beheld abriu porque os dois ingredientes — necessidade de sinal alternativo e disponibilidade de telemetria de sessões IA em escala — se materializaram juntos em 2025–2026. Não eram coincidentes em 2023.

---

## 4. Mapa competitivo

Cinco categorias adjacentes. O Beheld toca todas e não está em nenhuma.

### 4.1 Plataformas de avaliação técnica
HackerRank, CodeSignal, Codility, CoderPad, TestGorilla, Coderbyte [^g2k] [^playcode]

**O que fazem:** testes pontuais, problemas algorítmicos, screening em larga escala.
**Estado em 2026:** postura defensiva. Tentando vender "anti-cheat" sobre uma metodologia comprometida pelo próprio uso universal de IA [^humanly]. HackerRank acrescentou "AI Assistant" e detecção de monitores múltiplos. CodeSignal adicionou scoring com IA. Nenhuma resolve o problema raiz.
**Relação com Beheld:** ortogonal. Eles medem performance sob pressão em sessão sintética; Beheld observa trabalho real ao longo de meses. Coexistência provável — empresas podem usar ambos.

### 4.2 Camadas de integridade / entrevista por IA
Karat, Fabric, Humanly [^codinginterview] [^fabric] [^humanly]

**O que fazem:** entrevistas conversacionais adaptativas que dificultam o uso de copilots. Karat usa entrevistadores humanos treinados; Fabric e Humanly automatizam com IA. Karat adquiriu Triplebyte em 2023 e descontinuou o lado de marketplace, mantendo só o assessment [^terminal] [^pitchbook].
**Estado:** corrida armamentista; cada nova defesa gera novas ferramentas de bypass [^werecruit].
**Relação com Beheld:** complementar. Entrevista bem feita continua valendo para soft skills e fit. Beheld responde à pergunta anterior: vale a pena entrevistar este dev?

### 4.3 Marketplaces de devs passivos
Hired (adquirida pela Vettery) [^hiredcrunch], Triplebyte (adquirida pela Karat, descontinuada) [^terminal], Wellfound, Honeypot [^honeypot]

**O que faziam:** dev se cadastra, empresas pagam para acessar pool pré-avaliado.
**Estado:** consolidação severa. Triplebyte e Hired — os dois nomes mais conhecidos — saíram. O modelo de marketplace dev tem três falhas crônicas: (1) custo alto (~$25K/contratação), (2) cold-start no supply side, (3) devs vão para opções "mais estáveis" e fecham pouco [^startup101]. Existe um buraco real no mercado.
**Relação com Beheld:** este é o terreno disputado. A Fase 2 do Beheld (diretório pago para devs) entra nele. O wedge do Beheld contra os mortos:

- Triplebyte/Hired exigiam avaliação ativa para entrar no pool — barreira que escala mal. Beheld constrói o perfil passivamente enquanto o dev trabalha.
- Cobravam empresas por contato/contratação — modelo de success fee ou crédito. Beheld é assinatura simples.
- Compromisso "forever free for developers" remove a fricção de supply que matou os antecessores.

### 4.4 Plataformas de analytics de engenharia
DX, Jellyfish, LinearB, Swarmia [^gartner] [^cbi]

**O que fazem:** medem produtividade, ciclo de PRs, throughput, deployment frequency — para CTOs e VPs internamente.
**Estado:** maduras, ~7-9 anos de mercado. Há debate ativo sobre "metric is not the objective" e o risco de virar vigilância [^wadmiraal]. Jellyfish vende "métricas por pessoa", DX explicitamente se recusa a reportar produtividade individual [^jellyfishvsdx].
**Relação com Beheld:** invertida e crítica de entender. Esses sistemas medem devs PARA o empregador, DENTRO da empresa, sem consentimento granular. O Beheld mede o dev PARA o próprio dev, é portátil, é assinado, e a chave criptográfica é dele. É a inversão exata da relação de poder. Confundir o Beheld com Jellyfish é o pior posicionamento possível e deve ser evitado em todo material público.

### 4.5 Verifiable credentials / Sigstore / Open Badges
W3C VCs, Sigstore Rekor, Open Badges 3.0, Velocity Network [^dock] [^certopus]

**O que são:** infraestrutura padrão para credenciais criptograficamente verificáveis. Sigstore Rekor é log público append-only para artefatos assinados.
**Estado:** padrão estabelecido, adoção lenta fora de educação formal. EU Europass usa; alguns estados americanos pilotam [^teacheducator]. Sem player consolidado para credenciais técnicas dinâmicas.
**Relação com Beheld:** Beheld participa dessa pilha (Ed25519 + chain hash + Rekor). É a fundação técnica, não um concorrente. Permite que o Beheld diga: "qualquer auditor pode verificar offline, sem depender de nós" — argumento defensável contra a crítica de "centralização de poder".

### 4.6 Currículo declarado: LinkedIn, GitHub
**Estado:** LinkedIn permanece como ferramenta default mas é universalmente reconhecida como auto-declarada e infiel ao trabalho real. GitHub mostra só código público — frequentemente uma fração do que o dev faz.
**Relação com Beheld:** o Beheld não compete com LinkedIn como rede social. Compete com a função "verificar se o dev faz o que diz". Para essa função específica, ambos são fracos: LinkedIn por design, GitHub por escopo.

---

## 5. Onde o Beheld se encaixa

### 5.1 Matriz de posicionamento

| Player | Sinal capturado | Quem mede | Postura |
|--------|-----------------|-----------|---------|
| HackerRank/Codility | Performance sob pressão (1h) | A plataforma | Pontua |
| Karat/Fabric | Conversação técnica (1h) | A plataforma | Pontua |
| DX/Jellyfish | Métricas de processo (contínuo) | Gerência interna | Mede para gestão |
| LinkedIn | Auto-declaração (estática) | O dev | Apresenta |
| GitHub | Código público (incremental) | O dev | Apresenta |
| **Beheld** | **Trabalho real (L1+L2 contínuo, assinado)** | **Ninguém — relata** | **Testemunha** |

A postura "testemunha — relata o observável, não classifica talento" é única no mapa. É também juridicamente defensável (sem afirmação avaliativa, sem responsabilidade por decisão de contratação) e moralmente coerente com o compromisso de privacidade do daemon local.

### 5.2 O wedge específico

| Categoria | O que o Beheld faz que ninguém faz |
|-----------|-----------------------------------|
| vs. testes pontuais | Histórico contínuo, imune ao cheating de sessão única |
| vs. marketplaces antigos | Supply side cresce sem que o dev pague — quebra o cold-start |
| vs. analytics de engenharia | Dado pertence ao dev, é portátil, assinado por chave dele |
| vs. credenciais blockchain | Captura trabalho real, não conclusão de curso |
| vs. LinkedIn | Não exige manutenção; cresce com o trabalho |

### 5.3 White-space defensável

A posição é defensável por três camadas:

1. **Técnica:** Sigstore + Ed25519 + reproducible builds + bundle offline-verificável. Qualquer auditor pode validar sem o Beheld existir. Isso impede que o produto seja deslegitimado por ataques de tipo "e se o Beheld for hackeado".
2. **Legal:** posição de testemunha (não juiz) limita exposição. O produto nunca afirma que um dev "é bom" — apenas relata o observável.
3. **Moral/posicional:** compromisso público "forever free for developers" cria contrato social difícil de revogar. Qualquer entrante futuro que cobre do dev parte em desvantagem de confiança.

---

## 6. Vulnerabilidades e premissas

### 6.1 Dependências do substrato

O L2 depende da continuação da adoção de assistentes de código IA com interfaces observáveis. Cenários adversos:

- **Vendor lock-down:** Anthropic, OpenAI ou GitHub fecham os hooks/MCPs que permitem captura local. Mitigação: a integração via MCP é hoje pública e padronizada; reversão seria publicamente impopular. Risco baixo no horizonte de 18 meses, monitorável.
- **Mudança de paradigma:** se o coding migra de IDE para web (Devin-style hosted agents), a captura local fica difícil. Mitigação: L1 (git) persiste como fallback robusto; L2 vira opcional.

### 6.2 Risco do entrante "óbvio"

O concorrente mais perigoso não é outra plataforma de assessment — é GitHub/Microsoft lançando "GitHub Verified Work" como feature do Copilot, aproveitando posse dos dados de commits + sessões. Probabilidade não-trivial dado que Microsoft adotou Claude Code internamente apesar de vender Copilot [^serpsculpt], sinal de pragmatismo. Defesas:

- **Open source MIT + bundle offline-verificável.** Posição "neutra" contra um vendor que controla o repo.
- **Daemon local + assinatura própria do dev.** Vendor centralizado teria dificuldade de oferecer isso sem se contradizer.
- **Velocidade.** A janela para estabelecer "padrão de fato" é provavelmente de 12–24 meses.

### 6.3 Adoção do lado da empresa

O modelo só fecha se empresas pagam pelo diretório. Riscos:

- **Liquidez:** sem base crítica de devs, o diretório não tem valor para empresa. Mitigação: a Fase 1 (URL pública gratuita do bundle) permite uso em processo seletivo individual antes do diretório existir — gera primeiros casos sem depender do marketplace.
- **Cultura conservadora de RH:** empresas grandes podem demorar a aceitar "bundle assinado" como artefato hiring. Mitigação: foco em startups/scale-ups na Fase 1, conforme já planejado.

### 6.4 Confusão de categoria

Risco material e baixo custo de mitigar: ser percebido como "mais um DX/Jellyfish" ou "mais um HackerRank". Cada material público (landing, docs, pitch) precisa explicitamente recusar essas categorias. A página atual já faz isso bem com "Beheld nunca afirma 'esse dev é confiável'" — manter consistente.

---

## 7. Implicações estratégicas

### 7.1 Beachhead

Três beachheads possíveis, ordenados por força do encaixe:

1. **Devs early-adopters de Claude Code, US/CAN, vagas remote-first.** Maior densidade do substrato (24% adoção [^uvik41]), maior receptividade a artefatos verificáveis, mercado mais carente de sinal pós-cheating-crisis.
2. **LATAM nearshore para empresas americanas.** Brasil tem 630K-759K devs [^mismonear] [^mismolatam], mercado de outsourcing LATAM projetado a $76,5B até 2027 [^hiresouth]. Empresas americanas hesitam em contratar LATAM porque o sinal é mais fraco (referências menos verificáveis, contexto cultural distante). Beheld resolve exatamente esse gap — e a Fase 1 (URL pública gratuita) é particularmente útil para um dev brasileiro candidatando-se a uma vaga americana. Vantagem regional para o fundador.
3. **Open source maintainers / contribuidores freelancer.** Já tendem a "show your work"; bundle verificável encaixa naturalmente.

### 7.2 Mensagem que ressoa em 2026

Três mensagens testáveis, ranqueadas pela aderência à conjuntura:

1. **"O sinal que sua entrevista técnica não captura mais."** Direta sobre a crise de cheating. Empresa-side.
2. **"Seu trabalho real assinado por você — não o LinkedIn."** Dev-side, alinhada com o desconforto contra performance de currículo.
3. **"Você não usa IA — você é avaliado por como usa."** Aproveita o paradoxo adoção-vs-confiança (84% usam, 29% confiam) e reposiciona o dev como agente, não suspeito.

### 7.3 O que não fazer

- **Não entrar na corrida do anti-cheat.** É o terreno onde HackerRank/Karat estão sangrando. O Beheld vence ao tornar a categoria menos relevante, não ao competir nela.
- **Não posicionar como "produtividade".** É a porta para virar Jellyfish na mente de quem ouve. Posicionar como "verificação de trabalho real".
- **Não relativizar o forever-free.** O compromisso é o moat mais barato e mais duradouro contra entrantes.
- **Não classificar.** Toda tentação de adicionar "score geral", "tier", "ranking" sai do white-space e entra no terreno disputado da pontuação. O perfil deve continuar relatando.

### 7.4 Métricas de sucesso por fase

| Fase | Métrica que importa |
|------|---------------------|
| 1 (perfil acumulado) | % de devs early-adopter que mantêm o daemon ativo após 90 dias |
| 1→2 (URL pública usada em processo) | nº de bundles compartilhados externamente; nº de empresas que verificam offline |
| 2 (diretório dev paga) | conversão URL temporária → assinatura quando o dev sente que vai ser encontrável |
| 3 (portal recrutador) | tempo médio empresa-side de "pesquisa → contato"; reply rate vs. cold email |

---

## Apêndice — fontes consultadas

[^pin]: Pin, *Tech Job Market 2026: Layoffs, AI Salaries, and Hiring Data*, mai/2026. https://www.pin.com/blog/tech-job-market-report/
[^fullscale]: Full Scale, *Developer Hiring Trends in 2026 Is Broken*, abr/2026. https://fullscale.io/blog/developer-hiring-trends-2026/
[^rockstar]: Rockstar Developer University, *Software Developer Hiring Statistics 2026*, mai/2026. https://rockstardeveloperuniversity.com/software-developer-hiring-statistics/
[^bluecoders]: Bluecoders, *Tech Recruitment in 2026: Market figures and trends*, mai/2026. https://www.bluecoders.com/en/blog/recrutement-tech-chiffres-tendances
[^startup101]: Startup Hiring 101, *Hiring marketplaces (Karat/Triplebyte)*. https://startuphiring101.com/2-finding-reaching-out-to-great-candidates/2d-hiring-marketplaces-egtriplebyte
[^werecruit]: We Recruit IT, *38% of Your Tech Candidates Are Using AI to Cheat*, mai/2026 (com dados Fabric, 19.368 entrevistas). https://werecruit.it/blog/ai-cheating-interviews-2026/
[^humanly]: Humanly, *AI Interview Anti-Cheating Protocol 2026*, jan/2026. https://www.humanly.io/blog/ai-interview-anti-cheating-protocol-2026
[^fabric]: Fabric, *Why LeetCode Interviews Are Now Vulnerable to Cheating*, jan/2026. https://fabrichq.ai/blogs/why-leetcode-interviews-are-now-vulnerable-to-cheating-and-how-to-prevent-it
[^valid8]: valid8, *How Fake Resumes and Interview Impostors Are Changing Hiring In 2026*, jan/2026. https://valid8ed.com/how-fake-resumes-and-interview-impostors-are-changing-hiring-in-2026
[^metaview]: Metaview, *Candidate fraud detection: What hiring teams need to know for 2026*, jan/2026. https://www.metaview.ai/resources/blog/candidate-fraud-detection
[^rival]: Rival, *Fake Resumes on the Rise* (com dados FlexJobs), mar/2026. https://rival-hr.com/fake-resumes-on-the-rise-how-to-recognize-defend-against-candidate-fraud/
[^wiki]: Wikipedia, *Job fraud* (cita Forbes 2024). https://en.wikipedia.org/wiki/Job_fraud
[^evefin]: Eve Placement, *Resume Fraud Crisis: 7 Ways AI Is Changing Hiring in 2026*, abr/2026. https://eveplacement.com/career-insights/resume-fraud-ai-hiring-crisis/
[^uvik]: Uvik Software, *AI Coding Assistant Stats 2026*, mai/2026 (consolida Stack Overflow 2025, JetBrains AI Pulse jan/2026, Bloomberg, GitClear). https://uvik.net/blog/ai-coding-assistant-statistics/
[^uvik41]: Uvik Software, *Claude Code vs Cursor vs Copilot vs Codex: 2026*, mai/2026. https://uvik.net/blog/claude-code-vs-cursor-vs-copilot-vs-codex-2026/
[^gradually]: Gradually.ai, *Claude Code Statistics 2026* (Pragmatic Engineer survey n=15.000). https://www.gradually.ai/en/claude-code-statistics/
[^serpsculpt]: SERP Sculpt, *Claude Code Usage Statistics 2026* (consolida Anthropic, SemiAnalysis, Pragmatic Engineer, Reuters), mai/2026. https://serpsculpt.com/claude-code-usage-statistics/
[^digitalapplied]: Digital Applied, *AI Coding Tool Adoption 2026: Developer Survey Results*, abr/2026. https://www.digitalapplied.com/blog/ai-coding-tool-adoption-2026-developer-survey
[^g2k]: G2, *Top 10 Karat Alternatives & Competitors in 2026*. https://www.g2.com/products/karat/competitors/alternatives
[^playcode]: Playcode, *Best Coding Interview Platforms 2026*, jan/2026. https://playcode.io/blog/best-coding-interview-platforms-2026
[^codinginterview]: CodingInterviewAI, *Karat Interview 2026*, fev/2026. https://codinginterviewai.com/blog/karat-interview-guide
[^terminal]: Terminal.io, *Top Triplebyte Alternatives for Hiring Software Engineers*. https://www.terminal.io/blog/top-triplebyte-alternatives-for-hiring-software-engineers-remotely-in-2024
[^pitchbook]: PitchBook, *Triplebyte 2026 Company Profile* (acquired by Karat 16-mar-2023). https://pitchbook.com/profiles/company/117318-97
[^hiredcrunch]: Tracxn, *Hired - Company Profile* (acquired by Vettery). https://tracxn.com/d/companies/hired/
[^honeypot]: Crunchbase, *Honeypot company profile*. https://www.crunchbase.com/organization/honeypot
[^gartner]: Gartner Peer Insights, *Developer Productivity Insight Platforms Reviews*. https://www.gartner.com/reviews/market/developer-productivity-insight-platforms
[^cbi]: CB Insights, *DX alternatives and competitors*. https://www.cbinsights.com/company/dx/alternatives-competitors
[^wadmiraal]: Wouter Admiraal, *Measuring What Matters: How to Use GetDx, LinearB, and Co as a Leadership Tool, Not Surveillance*, fev/2026. https://wadmiraal.net/lore/2026/02/15/measure-what-matters/
[^jellyfishvsdx]: Jellyfish, *Jellyfish vs. DX* (citando posição da DX de não reportar produtividade individual), abr/2026. https://jellyfish.co/jellyfish-vs-dx/
[^dock]: Dock Labs, *Verifiable Credentials: The Ultimate Guide 2026*. https://www.dock.io/post/verifiable-credentials
[^certopus]: Certopus, *Verifiable Credentials 2.0*. https://blog.certopus.com/Verifiable-Credentials-2.0
[^teacheducator]: Teacheducator, *Blockchain Verified Microcredentials* (abrange Europass, Singapore SkillsFuture), abr/2026. https://teacheducator.com/blockchain-verified-microcredentials/
[^mismonear]: Mismo, *Nearshore Outsourcing in Latin America: 2026 Guide* (cita 630K+ devs no Brasil). https://mismo.team/nearshore-outsourcing-in-latin-america-guide/
[^mismolatam]: Mismo, *How to Hire LATAM Software Engineers in 2026* (cita 759K devs no Brasil). https://mismo.team/how-to-hire-latam-software-engineers/
[^hiresouth]: Hire South, *Nearshore Outsourcing Companies in LATAM* (cita Statista: mercado a $76,53B até 2027). https://www.hiresouth.com/blog/7-great-nearshore-outsourcing-companies-in-latam
