# Design — view de documentação CLI versionada na Dashboard Dev

| Campo | Valor |
|---|---|
| Data | 2026-06-08 |
| Autor | Eduardo Rocha (com Claude) |
| Status | Aprovado para implementação |
| Escopo | Frontend + backend Rails completos (1 fase) |
| Repositórios afetados | `beheld` (monorepo) e `beheld-web` (companion, dir `web/source/backend`) |

## 1. Objetivo e contexto

Adicionar à Dashboard Dev do Beheld uma view de documentação técnica versionada do binário CLI sob a rota `/docs/cli`. Cada release do CLI publica um arquivo Markdown gerado por varredura do código-fonte (`packages/cli/docs/cli-references-v<X>-<Y>-<Z>.md`, hoje só `v0-4-1`). A view renderiza o Markdown com seletor de versão, TOC dinâmico, busca, scrollspy, deep-link de comando, e tema claro/escuro idêntico ao mockup `Beheld - Documentação CLI v2.html`.

A primeira versão real é `v0.4.1` (commit `d41f476`). Versões anteriores citadas no mockup demo (`0.4.0`, `0.3.2`, etc.) **não** entram nesta fase — o seed plante apenas o que existe de fato em disco.

## 2. Decisões já tomadas (perguntas do brainstorming)

| # | Pergunta | Resposta |
|---|---|---|
| 1 | Referências visuais ausentes | Usuário forneceu `Beheld - Documentação CLI v2.html`, `app-docs.css`, `app.css`, `beheld.css`, `cli-references-v0-4-1.md`. Fidelidade máxima ao mockup. |
| 2 | Escopo da fase | Frontend + backend Rails completos. |
| 3 | CSS no dashboard | Importar os 3 CSS de referência + classes BEM. Tailwind do `index.tsx` intacto. |
| 4 | Seed + ingestão | Seed só com v0.4.1 + rake task `docs:cli:ingest`. Workflow CI fica para depois. |
| 5 | Render do Markdown | Server-side via TanStack Start server function (sem FOUC, sanitização server). |
| 6 | Testes | Full — Vitest + RSpec + Playwright. |
| 7 | Procedimento | Spec → review → TDD. |

## 3. Arquitetura de rotas (TanStack Router file-based)

```
web/source/dashboard/src/routes/
├── __root.tsx                # já existe — adiciona <link rel=stylesheet> dos 3 CSS docs
├── index.tsx                 # NÃO TOCAR (developer dashboard atual, Tailwind/shadcn)
└── docs/
    ├── route.tsx             # pathless layout: topbar + sidebar app__side + <Outlet/>
    ├── index.tsx             # redireciona /docs → /docs/cli
    └── cli/
        ├── index.tsx         # /docs/cli — busca latest, redireciona p/ /docs/cli/<v>
        └── $version.tsx      # /docs/cli/0.4.1 — server function carrega MD parsed
```

**Por que `routes/docs/route.tsx` (não pathless `_docs.tsx`)**: o shell de docs é específico do contexto (TOC, version picker, meta strip) — não é compartilhado com `index.tsx`. Segregar por pasta deixa explícito que toda subrota de docs herda esse shell. `index.tsx` continua usando Tailwind sem cruzar mundos.

**Deep-link de comando**: hash fragment puro (`/docs/cli/0.4.1#beheld-init`). TanStack roteia até o path; client faz `scrollIntoView` no hash após mount.

## 4. Componentes e fluxo de dados

```
src/routes/docs/
├── route.tsx                  # DocsLayout — topbar + sidebar + submenu Documentação
├── cli/$version.tsx           # CliDocsView — page-h + meta-strip + artigo + scrollspy
├── -lib/                      # prefixo "-": módulos sem rota
│   ├── docs-api.ts            # client Rails: listVersions, getDoc
│   ├── markdown.ts            # parseMarkdown (server-only): marked+DOMPurify+pipeline
│   ├── slugify.ts             # puro, testável
│   ├── lift-labels.ts         # puro, testável (HTML in → HTML out)
│   ├── colorize-pre.ts        # puro, testável
│   └── build-toc.ts           # puro, testável (HTML → TocGroup[])
└── -components/
    ├── VersionPicker.tsx      # botão + listbox custom (Radix Popover p/ a11y)
    ├── DocsSidebar.tsx        # submenu collapse + search + TocList + scrollspy
    ├── TocList.tsx            # render TOC + filtro + ⌘K
    ├── MetaStrip.tsx          # fonte / commit / gerado em / sync indicator
    └── MarkdownArticle.tsx    # injeta HTML server-rendered (IDs já presentes)
```

### 4.1 Fluxo

```
[Browser GET /docs/cli/0.4.1]
        │
        ▼
[$version.tsx loader] — chama duas server functions em paralelo:
        ├─ getVersionsList()    → GET Rails /api/v1/docs/cli/versions   (60s cache)
        └─ getDocForVersion(v)  → GET Rails /api/v1/docs/cli/0.4.1      (1h cache)
                                  → parseMarkdown(md) no server:
                                      1. marked.parse(gfm:true, breaks:false)
                                      2. DOMPurify.sanitize
                                      3. liftLabels(html)
                                      4. colorizePre(html)
                                      5. addHeadingIds(html) com slugify único
                                      6. buildToc(html) → JSON
                                  → { html, toc, title, subtitle, meta, syncStatus }
        ▼
[Server HTML] — page-h, meta-strip, artigo (HTML pronto), sidebar com TOC já renderizado
        ▼
[Client hydration]:
   - VersionPicker (state + router.navigate)
   - DocsSidebar.toggle (.is-open)
   - tocSearch + ⌘K listener
   - IntersectionObserver scrollspy
   - hash → scrollIntoView no mount + após swap
   - theme toggle (localStorage "beheld:theme" + data-theme no <html>)
```

### 4.2 Sync indicator

Comparação `doc.commit_sha` vs binário instalado acontece **no server** durante a server function. URL do binário vem de `BEHELD_BINARY_VERSION_URL` (default `http://localhost:3000/api/version`, endpoint já implementado — observação 6733). Resultado `syncStatus: "in_sync" | "doc_older" | "unknown"` define se o `●` vira `⚠`.

### 4.3 Estado de erro

Server function retorna `{ kind: "error", status, message }` quando Rails responde 4xx/5xx. Componente renderiza `.docs-error` âmbar (classe existe no `app-docs.css`). Nunca 500 para o usuário.

## 5. Backend Rails

### 5.1 Migration — `db/migrate/<ts>_create_cli_docs.rb`

```ruby
create_table :cli_docs do |t|
  t.string   :version,      null: false           # "0.4.1" (sem prefixo v)
  t.string   :commit_sha,   null: false           # SHA 7-12 chars
  t.datetime :published_at, null: false
  t.string   :tag                                 # "latest" | "stable" | "legacy" | nil
  t.text     :markdown,     null: false
  t.string   :checksum,     null: false           # sha256 hex do markdown
  t.jsonb    :meta,         null: false, default: {}
  t.timestamps
end
add_index :cli_docs, :version, unique: true
add_index :cli_docs, :tag
add_index :cli_docs, :published_at
```

### 5.2 Model — `app/models/cli_doc.rb`

- `validates :tag, inclusion: { in: %w[latest stable legacy], allow_nil: true }`
- After-save guard: ao receber `tag = "latest"`, zera `tag` de outros registros com `latest`
- `scope :ordered, -> { order(published_at: :desc) }`
- `def to_index_entry` → JSON enxuto sem markdown
- `def cache_etag` → `"W/\"#{checksum}\""`
- Class method `tag_latest_automatically!` → marca o mais recente por `published_at` como `latest` se nenhum tem tag

### 5.3 Controller — `app/controllers/api/v1/docs/cli_controller.rb`

```ruby
module Api::V1::Docs
  class CliController < Api::V1::BaseController
    skip_before_action :authenticate!   # docs CLI são públicas

    def versions
      docs = CliDoc.ordered.select(:version, :commit_sha, :published_at, :tag)
      response.set_header("Cache-Control", "public, max-age=300")
      render json: docs.map(&:to_index_entry)
    end

    def show
      doc = CliDoc.find_by!(version: params[:version])
      fresh_when(etag: doc.cache_etag, public: true, last_modified: doc.updated_at)
      render plain: doc.markdown,
             content_type: "text/markdown; charset=utf-8"
    rescue ActiveRecord::RecordNotFound
      render json: { error: "version_not_found", version: params[:version] },
             status: :not_found
    end

    def latest
      doc = CliDoc.where(tag: "latest").ordered.first || CliDoc.ordered.first
      return render(json: { error: "no_docs_published" }, status: :not_found) unless doc
      redirect_to api_v1_docs_cli_show_path(version: doc.version), status: :found
    end
  end
end
```

### 5.4 Routes — adicionar dentro do namespace `:api, :v1` existente

```ruby
namespace :docs do
  get "cli/versions",  to: "cli#versions"
  get "cli/latest",    to: "cli#latest"
  get "cli/:version",  to: "cli#show", constraints: { version: /[\w.\-]+/ }
end
```

### 5.5 Rake task — `lib/tasks/docs.rake`

```ruby
namespace :docs do
  namespace :cli do
    desc "Ingest packages/cli/docs/cli-references-v*.md into cli_docs"
    task ingest: :environment do
      glob = ENV.fetch("BEHELD_CLI_DOCS_GLOB",
                       Rails.root.join("../..", "packages/cli/docs/cli-references-v*.md").to_s)
      Dir[glob].each do |path|
        version = File.basename(path).match(/v(\d+-\d+-\d+)\.md\z/)[1].tr("-", ".")
        md      = File.read(path)
        meta    = DocsCli::MetaExtractor.call(md)
        CliDoc.upsert(
          {
            version:      version,
            commit_sha:   meta.fetch(:commit_sha),
            published_at: meta.fetch(:published_at),
            tag:          (meta[:is_latest] ? "latest" : nil),
            markdown:     md,
            checksum:     Digest::SHA256.hexdigest(md),
            meta:         meta[:extra] || {}
          },
          unique_by: :version
        )
      end
      CliDoc.tag_latest_automatically!
    end
  end
end
```

### 5.6 Service `DocsCli::MetaExtractor`

PORO em `app/services/docs_cli/meta_extractor.rb`. Recebe o markdown e parseia o cabeçalho `> Fonte: ... (commit \`d41f476\` · 2026-06-08)` para extrair `commit_sha` e `published_at`. Falha alto (raise) se o cabeçalho não casar — protege contra ingerir doc malformado.

### 5.7 Seed — `db/seeds/cli_docs.rb`

```ruby
Rake::Task["docs:cli:ingest"].invoke if CliDoc.none?
```

## 6. Pipeline de Markdown (server-side)

```typescript
// src/routes/docs/-lib/markdown.ts
export interface ParsedDoc {
  html: string;       // HTML pronto, sanitizado, com IDs em h2/h3
  toc: TocGroup[];    // JSON, não HTML
  title: string;      // do primeiro #
  subtitle: string;   // do primeiro > blockquote
}

export interface TocGroup {
  kind: "section" | "h2-only";
  id: string;
  title: string;
  children: { id: string; title: string; hint?: string }[];
}
```

`liftLabels`, `colorizePre`, `buildToc`, `slugify`, `addHeadingIds` operam em strings via `node-html-parser` (não jsdom — menor footprint). Mesmas funções servem ao Vitest sem setup de browser.

### 6.1 Regras canônicas

| Função | Regras | Edge cases |
|---|---|---|
| `slugify` | NFD strip diacríticos, lowercase, replace `\s+`→`-`, slice 80, contador `-2`/`-3` em colisão | `` "`beheld init`" `` → `beheld-init`; colisão produz `beheld-init-2`; vazio → `section` |
| `liftLabels` | `<p>` com um único `<strong>` cujo texto bate `^(Flags\|Argumentos\|Execução\|Resultado esperado\|Exit codes\|Notas\|Pré-condições\|Descrição)$` (com `.` ou `:` opcional no fim) → vira `<h4>` | 8 labels suportados; negativo: `<strong>Hello</strong> rest` NÃO vira h4 |
| `colorizePre` | Por linha: `▎`→`.hl`, `✓`→`.ok`, `✗`→`.err`, `⚠`/`!`→`.warn`, `→`/`•`→`.arrow`, `$`→`.pmt`, `🔧`→`.warn` linha inteira, `─` puro→`.dim` | Escape de `&<>` antes dos spans; linha sem marcador intocada |
| `buildToc` | Agrupa h3 sob h2 anterior; h2 sem filhos vira `h2-only`; h3 sem h2 anterior vai pro grupo `"Geral"` | h3 órfão; h2 órfão; mix; documento vazio |
| `renderTocLabel` (client) | `"beheld (sem subcomando)"` → `<code>beheld</code> <span class="toc__hint">sem subcomando</span>`; `"beheld foo bar [args...]"` → strip `[...]`/`<...>`, restante em `<code>` | `"verify <file>"` mantém o `<...>` no nome original mas remove no display |

### 6.2 Fixtures de teste

```
src/routes/docs/-lib/__fixtures__/
├── sample.md            # reduzido: 1 h2 + 3 comandos cobrindo todos labels
├── expected-html.html   # saída canônica esperada
└── expected-toc.json    # estrutura TOC esperada
```

## 7. CSS e assets

### 7.1 Onde ficam os CSS

```
web/source/dashboard/src/styles/docs/
├── beheld.css        # copiado de design_handoff_dev/reference/
├── app.css           # copiado de design_handoff_dev/reference/
├── app-docs.css      # copiado do upload do usuário
└── cli-article.css   # regras inline do HTML demo (linhas 14-342) — gitable
```

`docs/route.tsx` registra os 4 como `<link>` via `Route.head()`. Não afetam o `index.tsx` Tailwind — não há colisão de tokens (`--background` Tailwind ≠ `--bg` beheld).

### 7.2 Dependências novas

```bash
# Dashboard
bun add marked@^12 isomorphic-dompurify node-html-parser
bun add -d vitest @testing-library/react jsdom @playwright/test
```

### 7.3 Theme toggle sem FOUC

`__root.tsx` injeta no `<head>` um script inline pré-hidratação que lê `localStorage["beheld:theme"]` e seta `data-theme="light"` no `<html>` antes do React hidratar. Idêntico ao snippet do HTML demo (linhas 345–349).

### 7.4 Env vars novas

| Var | Onde | Default | Para que |
|---|---|---|---|
| `RAILS_API_URL` | dashboard server | `http://localhost:3000` | Base do Rails para server functions (versões + markdown) |
| `BEHELD_CLI_DOCS_GLOB` | Rails rake | `../../packages/cli/docs/cli-references-v*.md` | Origem do .md na ingestão |
| `BEHELD_BINARY_VERSION_URL` | dashboard server | `${RAILS_API_URL}/api/version` | URL específica para o sync indicator. Default deriva de `RAILS_API_URL`; pode ser overridden quando docs e binário vivem em hosts diferentes. |

## 8. Testes

### 8.1 Vitest (dashboard)

Setup: `vitest.config.ts` com `environment: "node"` por default; testes UI declaram `// @vitest-environment jsdom` no topo. Scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.

Arquivos (red-first):

1. `slugify.test.ts` — 6 casos (vazio, diacríticos, backticks, colisão, slice 80, especiais)
2. `lift-labels.test.ts` — 8 labels positivos + variações `.`/`:` + 3 negativos
3. `colorize-pre.test.ts` — um teste por marcador + escape HTML + linha sem marcador
4. `build-toc.test.ts` — h3 órfão, h2 órfão, mix, vazio
5. `markdown.test.ts` — integração: `sample.md` → `expected-html.html` + `expected-toc.json`
6. `docs-api.test.ts` — mock fetch: 200, 404, 500, conteúdo malformado
7. `VersionPicker.test.tsx` — render, abre menu, navega ao clicar (mock `useNavigate`)
8. `DocsSidebar.test.tsx` — toggle collapse, filtro esconde itens, ⌘K foca input

### 8.2 RSpec (backend)

`spec/requests/api/v1/docs/cli_spec.rb`:
- `GET /versions` retorna lista ordenada por `published_at desc`, sem markdown, Cache-Control public
- `GET /:version` 200, content-type markdown, ETag W/sha256
- `GET /:version` inexistente → 404 JSON
- `GET /latest` redireciona 302 para versão com `tag=latest`
- `GET /latest` sem nenhum doc → 404
- ETag match → 304 no segundo request com `If-None-Match`

`spec/lib/tasks/docs_cli_ingest_spec.rb`:
- Ingere v0.4.1 a partir de fixture md real
- Upsert idempotente (rodar 2x não cria duplicado)
- `tag_latest_automatically!` só deixa um `latest`
- Falha alto quando blockquote de cabeçalho está malformado

`spec/services/docs_cli/meta_extractor_spec.rb`:
- Extrai `commit_sha` e `published_at` do blockquote canônico
- Levanta erro com mensagem clara se faltar `Fonte:`

### 8.3 Playwright E2E

`web/source/dashboard/tests/e2e/docs-cli.spec.ts`:

Setup: `playwright.config.ts` apontando para `bun run preview` na 4173, mock do Rails via `page.route("**/api/v1/docs/cli/**")` com fixtures. As fixtures incluem **duas** versões (`0.4.1` e uma fake `0.3.2`) **apenas no contexto dos testes E2E** — o seed real continua só com `0.4.1`. Isso permite testar troca de versão sem depender de múltiplas releases existirem.

Cenários:
1. `/docs/cli` → redireciona para `/docs/cli/0.4.1`, renderiza h1, TOC populado, console limpo
2. Deep-link `/docs/cli/0.4.1#beheld-init` → viewport rola para o comando; item correspondente fica `.active` no TOC
3. Trocar versão no dropdown (usando as 2 versões mockadas) → URL muda, crumb muda, conteúdo recarrega; navegação client-side (sem full reload)
4. Filtro `/init` no `docs-search` esconde itens não-matches; ⌘K (`Meta+K`) foca o input
5. Toggle de tema persiste em `localStorage["beheld:theme"]` e sobrevive a reload

### 8.4 CI

Adicionar ao `.github/workflows/ci.yml` existente:
- `dashboard:test` (Vitest)
- `dashboard:e2e` (Playwright headless)
- `backend:rspec:docs` (RSpec dos novos arquivos)

## 9. Edge cases (especificação operacional)

| Caso | Comportamento |
|---|---|
| Rails 4xx/5xx no `/cli/:version` | Server function devolve `{ kind: "error", status, message }`; componente renderiza `.docs-error` âmbar com código + sugestão; TOC vazio com hint "nenhum item — verifique o documento" |
| Versão na URL não existe | Loader detecta 404 e renderiza página dedicada com link "ver latest" (chama `/latest`) |
| Markdown sem nenhum `h2` | `buildToc` retorna `[]`; `TocList` renderiza estado vazio mono |
| `commit_sha` doc ≠ binário | `MetaStrip` troca `●` verde por `⚠` âmbar + "documento gerado em commit anterior ao do seu binário"; comparação no server |
| TOC com 40+ itens | `.app__side` já tem `position:sticky` + `overflow-y:auto` + scrollbar fino (app-docs.css) |
| Print (Ctrl+P) | `@media print { .app__top, .app__side { display: none } .app__main { padding: 0 } .art { max-width: none } }` em `cli-article.css` |
| Hash inválido | `useEffect` checa `document.getElementById(hash)`; se não existe, no-op silencioso |
| Server function falha (Rails down) | Error boundary do `route.tsx` mostra `.docs-error` "não foi possível alcançar a API" + retry |
| Versão duplicada na ingestão | `upsert(unique_by: :version)` faz UPDATE — sem duplicado |

## 10. Acessibilidade

- `<button>` real para `docsTrigger` e `verBtn` (não `<a href="#">`)
- `aria-expanded` nos triggers; `aria-haspopup="listbox"` no `verBtn`
- `role="listbox"` no `.ver__menu`; `role="option"` + `aria-selected` nos `.ver__opt`
- Hierarquia de headings preservada pelo pipeline (h4 só após h3)
- `:focus-visible` em `.toc a`, `.ver__opt`, `.docs-trigger`
- `⌘K`/`Ctrl+K` com `e.preventDefault()` e `<kbd>` visual

## 11. Não-objetivos (fora desta fase)

- Editor inline do Markdown
- Diff entre versões do documento
- Comentários do usuário em comandos
- Pesquisa full-text dentro do artigo (apenas TOC)
- Múltiplos documentos (engine, MCP, portal) — só CLI nesta fase
- Workflow GitHub Action de publicação automática em tag `cli@v*`
- Versões históricas fictícias (0.4.0, 0.3.2, etc.) — apenas o que existe em disco

## 12. Critérios de aceite

1. Acessando `/docs` no dashboard, browser redireciona para `/docs/cli/0.4.1` e a referência renderiza completa, sem FOUC de tema.
2. Submenu "Documentação" no sidebar lista todas as seções e comandos do documento, com busca funcional e item ativo destacado por scroll.
3. Trocar versão no dropdown (quando houver mais de uma) atualiza URL, conteúdo, TOC e meta strip, sem reload completo.
4. Anchors funcionam: copiar `#beheld-init` da URL, abrir em nova aba e a página rola para o comando após `loadDoc`.
5. Tema claro/escuro preservam contraste em todos os `<pre>` e tabelas; toggle persiste em `localStorage["beheld:theme"]`.
6. Sem erros no console em loads bem-sucedidos e em loads com erro de rede.
7. Tudo respeita `beheld.css`/`app.css`/`app-docs.css` — sem estilo novo "out of system" introduzido.
8. `bun test` no dashboard passa todos os 8 arquivos Vitest.
9. `rspec spec/requests/api/v1/docs spec/services/docs_cli spec/lib/tasks` passa.
10. `bunx playwright test tests/e2e/docs-cli.spec.ts` passa os 5 cenários.

## 13. Plano de entrega (2 PRs)

- **PR1 — monorepo `beheld`** (branch `feat/docs-cli-view`):
  - Rotas `routes/docs/*`, lib do pipeline, componentes, CSS, fixtures, Vitest + Playwright
  - 1 commit por subsistema (TDD: testes primeiro, depois implementação)
- **PR2 — companion `beheld-web`** (branch `feat/docs-cli-backend`):
  - Migration, model, controller, routes, rake task, MetaExtractor, seed, RSpec
  - Mesmo padrão TDD

Ordem: PR2 mergeia primeiro (backend disponível), depois PR1 (frontend consome).
