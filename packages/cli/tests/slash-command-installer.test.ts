import { test, expect, describe } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  SLASH_COMMAND_CONTENT,
  SLASH_COMMAND_VERSION,
  installClaudeSlashCommand,
} from "../src/config/hooks";

function tmpFile(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "beheld-slash-"));
  return join(dir, name);
}

const LEGACY_V1_BODY =
  'Use the beheld MCP tool with view="$ARGUMENTS" (use "summary" if no argument given) and display the result exactly as returned, without adding any commentary.\n';

const LEGACY_V2_BODY = `---
version: "2"
---
Antes de qualquer resposta, apresente-se com exatamente esta frase,
substituindo [nome] pelo nome do usuário desta sessão do Claude
(você tem acesso a essa informação no contexto da conversa):

  "Meu nome é B3H31D, sou a testemunha da evolução do perfil de [nome]."

Em seguida, aplique as regras de roteamento abaixo com base em: $ARGUMENTS

Regras de roteamento (aplique exatamente — não interprete nem adicione conteúdo):

1. Se "$ARGUMENTS" começar com "import " (com espaço após "import"):
   → Extraia tudo após "import " como a URL
   → Chame a tool \`beheld\` com: action="import", url=<url extraída>

2. Se "$ARGUMENTS" for exatamente "import" (sem nada após):
   → Chame a tool \`beheld\` com: action="import", url=""

3. Em qualquer outro caso (vazio, "summary", "scores", "insights", "full", etc.):
   → Chame a tool \`beheld\` com: action="view", view="$ARGUMENTS" (ou "summary" se vazio)

Retorne a saudação + exatamente o que a tool retornar. Não adicione mais nada.
`;

const LEGACY_V3_BODY = `---
version: "3"
---
Antes de qualquer resposta, apresente-se com exatamente esta frase,
substituindo [nome] pelo nome do usuário desta sessão do Claude
(você tem acesso a essa informação no contexto da conversa):

  "Meu nome é B3H31D. Vou testemunhar a evolução do perfil de [nome]."

Em seguida, aplique as regras de roteamento abaixo com base em: $ARGUMENTS

Regra 1 — Modo conversacional b3:
  algum conteúdo antigo

Regra 4 — View (padrão):
  algum conteúdo antigo
`;

describe("installClaudeSlashCommand — versioning", () => {
  test("test_slash_command_version_4_written_on_fresh_install", async () => {
    const file = tmpFile("beheld.md");
    expect(existsSync(file)).toBe(false);

    await installClaudeSlashCommand(file);

    const content = readFileSync(file, "utf-8");
    expect(content.startsWith("---\n")).toBe(true);
    expect(content).toContain(`version: "${SLASH_COMMAND_VERSION}"`);
    expect(SLASH_COMMAND_VERSION).toBe("7");
  });

  test("test_slash_command_version_1_overwritten_on_init", async () => {
    const file = tmpFile("beheld.md");
    writeFileSync(file, LEGACY_V1_BODY);

    await installClaudeSlashCommand(file);

    const content = readFileSync(file, "utf-8");
    expect(content).toContain(`version: "${SLASH_COMMAND_VERSION}"`);
    expect(content).not.toContain(LEGACY_V1_BODY.trim());
  });

  test("test_slash_command_version_2_overwritten_on_init", async () => {
    const file = tmpFile("beheld.md");
    writeFileSync(file, LEGACY_V2_BODY);

    await installClaudeSlashCommand(file);

    const content = readFileSync(file, "utf-8");
    expect(content).toContain(`version: "${SLASH_COMMAND_VERSION}"`);
    expect(content).toMatch(/^---\nversion: "7"\n---\n/);
    // Old greeting and old "Retorne a saudação" trailer must be gone.
    expect(content).not.toContain("sou a testemunha da evolução");
    expect(content).not.toContain("Retorne a saudação");
  });

  test("test_slash_command_version_3_overwritten_on_init", async () => {
    const file = tmpFile("beheld.md");
    writeFileSync(file, LEGACY_V3_BODY);

    await installClaudeSlashCommand(file);

    const content = readFileSync(file, "utf-8");
    expect(content).toContain(`version: "${SLASH_COMMAND_VERSION}"`);
    expect(content).toMatch(/^---\nversion: "7"\n---\n/);
    // v3 had no stack routing — v4 must introduce it.
    expect(content).toContain("Regra 4 — Stack");
  });

  test("test_slash_command_version_1_frontmatter_overwritten_on_init", async () => {
    const file = tmpFile("beheld.md");
    writeFileSync(
      file,
      '---\nversion: "1"\n---\nantigo conteúdo nosso\n',
    );

    await installClaudeSlashCommand(file);

    const content = readFileSync(file, "utf-8");
    expect(content).toContain(`version: "${SLASH_COMMAND_VERSION}"`);
  });

  test("test_slash_command_content_contains_b3_routing_rule", async () => {
    const file = tmpFile("beheld.md");
    await installClaudeSlashCommand(file);

    const content = readFileSync(file, "utf-8");
    expect(content).toContain("Regra 1 — Modo conversacional b3");
    expect(content).toContain('"b3 "');
    expect(content).toContain('"B3 "');
    expect(content).toContain("case-insensitive");
    // b3 must precede import in the routing order so that "b3 import ..." is
    // routed to conversational mode, not to import.
    const b3Index = content.indexOf("Regra 1");
    const importIndex = content.indexOf("Regra 2");
    expect(b3Index).toBeGreaterThan(-1);
    expect(importIndex).toBeGreaterThan(b3Index);
  });

  test("test_slash_command_content_contains_response_template", async () => {
    const file = tmpFile("beheld.md");
    await installClaudeSlashCommand(file);

    const content = readFileSync(file, "utf-8");
    // v5: removido o blockquote (>) para evitar render italico no CLI.
    expect(content).toContain("-(·⊙·)-");
    // v7: template usa "[verbo em 3ª pessoa]" porque o bold B3H31D é o sujeito.
    expect(content).toContain("**B3H31D** [verbo em 3ª pessoa]");
    // Decoração + linha vazia + parágrafo do B3H31D, sem prefixo de blockquote.
    expect(content).toMatch(/-\(·⊙·\)-\n\s*\n\s*\*\*B3H31D\*\*/);
    // v6: regra absoluta contra itálico — citação literal das proibições.
    expect(content).toContain("ZERO ITÁLICO");
  });

  test("test_slash_command_content_contains_signal_symbol", async () => {
    const file = tmpFile("beheld.md");
    await installClaudeSlashCommand(file);

    const content = readFileSync(file, "utf-8");
    expect(content).toContain("-(·⊙·)-");
    // v7: a decoração aparece 2 vezes — uma no template e outra no EXEMPLO
    // CORRETO. Esse é o número fixo esperado; mais ou menos indica drift.
    const occurrences = content.split("-(·⊙·)-").length - 1;
    expect(occurrences).toBe(2);
    // Garantir que a decoração antiga não vazou.
    expect(content).not.toContain("─ ( · · · ⊙ · · · ) ─");
  });

  test("test_slash_command_content_contains_version_7_frontmatter", async () => {
    const file = tmpFile("beheld.md");
    await installClaudeSlashCommand(file);

    const content = readFileSync(file, "utf-8");
    expect(content.startsWith("---\n")).toBe(true);
    expect(content).toContain('version: "7"');
  });

  test("test_slash_command_content_contains_greeting_instruction", async () => {
    const file = tmpFile("beheld.md");
    await installClaudeSlashCommand(file);

    const content = readFileSync(file, "utf-8");
    expect(content).toContain(
      "Meu nome é B3H31D. Vou testemunhar a evolução do perfil de [nome].",
    );
    expect(content).toContain("[nome]");
    expect(content).toContain("Antes de qualquer resposta");
    expect(content).not.toMatch(/eduardo/i);
  });

  test("test_slash_command_content_contains_stack_routing", async () => {
    const file = tmpFile("beheld.md");
    await installClaudeSlashCommand(file);

    const content = readFileSync(file, "utf-8");
    expect(content).toContain("Regra 4 — Stack");
    expect(content).toContain('action="stack"');
    // All four trigger keywords listed in PT-BR for the dev.
    expect(content).toContain('"stack"');
    expect(content).toContain('"linguagens"');
    expect(content).toContain('"frameworks"');
    expect(content).toContain('"arquitetura"');
    // Stack must come before the fallback view rule (otherwise the keywords
    // would always be swallowed by view).
    const stackIdx = content.indexOf("Regra 4 — Stack");
    const viewIdx = content.indexOf("Regra 5 — View");
    expect(stackIdx).toBeGreaterThan(-1);
    expect(viewIdx).toBeGreaterThan(stackIdx);
  });

  test("test_slash_command_import_routing_preserved", async () => {
    const file = tmpFile("beheld.md");
    await installClaudeSlashCommand(file);

    const content = readFileSync(file, "utf-8");
    expect(content).toContain('action="import"');
    expect(content).toContain('url=<url extraída>');
    expect(content).toContain('url=""');
    expect(content).toContain("Regra 2 — Import com URL");
    expect(content).toContain("Regra 3 — Import sem URL");
  });

  test("test_slash_command_view_routing_preserved", async () => {
    const file = tmpFile("beheld.md");
    await installClaudeSlashCommand(file);

    const content = readFileSync(file, "utf-8");
    expect(content).toContain('action="view"');
    expect(content).toContain('view="$ARGUMENTS"');
    // View is now Regra 5 (renumbered when stack was inserted as Regra 4).
    expect(content).toContain("Regra 5 — View (padrão)");
    expect(content).toContain('"summary"');
  });

  test("test_slash_command_content_snapshot", async () => {
    // Hard snapshot — any change to SLASH_COMMAND_CONTENT must also bump
    // SLASH_COMMAND_VERSION (so previously-installed copies get overwritten)
    // and update this snapshot. If you got here from a content edit, do both
    // before suppressing the failure.
    const file = tmpFile("beheld.md");
    await installClaudeSlashCommand(file);

    const onDisk = readFileSync(file, "utf-8");
    expect(onDisk).toBe(SLASH_COMMAND_CONTENT);

    expect(SLASH_COMMAND_CONTENT).toContain(`version: "${SLASH_COMMAND_VERSION}"`);
    expect(SLASH_COMMAND_CONTENT).toMatch(/^---\nversion: "7"\n---\n/);
    expect(SLASH_COMMAND_CONTENT).toContain("B3H31D");
    // v5: invariants visuais
    expect(SLASH_COMMAND_CONTENT).toContain("-(·⊙·)-");
    expect(SLASH_COMMAND_CONTENT).not.toContain("> ─");
    // v6: regra absoluta contra itálico — proibições explícitas para cada
    // forma de marcação que poderia virar itálico no render.
    expect(SLASH_COMMAND_CONTENT).toContain("ZERO ITÁLICO");
    expect(SLASH_COMMAND_CONTENT).toContain("asterisco simples");
    expect(SLASH_COMMAND_CONTENT).toContain("underscore");
    expect(SLASH_COMMAND_CONTENT).toContain("blockquote");
    expect(SLASH_COMMAND_CONTENT).toContain("<em>");
    expect(SLASH_COMMAND_CONTENT).toContain("aspas");
    // v7: regra "sujeito uma só vez" — bold B3H31D é o sujeito da primeira
    // frase; corpo da resposta NUNCA repete o nome. Usamos regex porque o
    // prompt tem line wrap que separa "nome" e "B3H31D" em linhas distintas.
    expect(SLASH_COMMAND_CONTENT).toMatch(/NUNCA repita o nome\s+"B3H31D" no corpo/);
    expect(SLASH_COMMAND_CONTENT).toContain("EXEMPLO CORRETO");
    expect(SLASH_COMMAND_CONTENT).toContain("EXEMPLO ERRADO");
    // O exemplo errado contém o anti-padrão exato pra ficar visível na revisão
    // e pro modelo reconhecer e evitar.
    expect(SLASH_COMMAND_CONTENT).toContain("**B3H31D** B3H31D percebe");
    // Five routing rules: "Regra 1" through "Regra 5".
    expect(SLASH_COMMAND_CONTENT).toContain("Regra 1");
    expect(SLASH_COMMAND_CONTENT).toContain("Regra 2");
    expect(SLASH_COMMAND_CONTENT).toContain("Regra 3");
    expect(SLASH_COMMAND_CONTENT).toContain("Regra 4");
    expect(SLASH_COMMAND_CONTENT).toContain("Regra 5");
  });

  test("preserves user-customized content without legacy signature", async () => {
    const file = tmpFile("beheld.md");
    const original = "Conteúdo customizado pelo usuário — não toque.\n";
    writeFileSync(file, original);

    await installClaudeSlashCommand(file);

    expect(readFileSync(file, "utf-8")).toBe(original);
  });

  test("leaves v4 file untouched on subsequent install", async () => {
    const file = tmpFile("beheld.md");
    await installClaudeSlashCommand(file);
    const first = readFileSync(file, "utf-8");

    await installClaudeSlashCommand(file);
    const second = readFileSync(file, "utf-8");

    expect(second).toBe(first);
  });
});
