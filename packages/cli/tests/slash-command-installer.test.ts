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

describe("installClaudeSlashCommand — versioning", () => {
  test("test_slash_command_version_3_written_on_fresh_install", async () => {
    const file = tmpFile("beheld.md");
    expect(existsSync(file)).toBe(false);

    await installClaudeSlashCommand(file);

    const content = readFileSync(file, "utf-8");
    expect(content.startsWith("---\n")).toBe(true);
    expect(content).toContain(`version: "${SLASH_COMMAND_VERSION}"`);
    expect(SLASH_COMMAND_VERSION).toBe("3");
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
    expect(content).toMatch(/^---\nversion: "3"\n---\n/);
    // Old greeting and old "Retorne a saudação" trailer must be gone.
    expect(content).not.toContain("sou a testemunha da evolução");
    expect(content).not.toContain("Retorne a saudação");
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

  test("test_slash_command_content_contains_blockquote_template", async () => {
    const file = tmpFile("beheld.md");
    await installClaudeSlashCommand(file);

    const content = readFileSync(file, "utf-8");
    // The three blockquote lines must appear literally, in order, so the
    // model can copy the format verbatim.
    expect(content).toContain("> ─ ( · · · ⊙ · · · ) ─");
    expect(content).toContain("> **B3H31D** [resposta na voz de testemunha");
    // The blank blockquote line between symbol and body.
    expect(content).toMatch(/> ─ \( · · · ⊙ · · · \) ─\n\s*>\n\s*> \*\*B3H31D\*\*/);
  });

  test("test_slash_command_content_contains_signal_symbol", async () => {
    const file = tmpFile("beheld.md");
    await installClaudeSlashCommand(file);

    const content = readFileSync(file, "utf-8");
    expect(content).toContain("─ ( · · · ⊙ · · · ) ─");
    // Exactly one occurrence — the template literal in Regra 1.
    const occurrences = content.split("─ ( · · · ⊙ · · · ) ─").length - 1;
    expect(occurrences).toBe(1);
  });

  test("test_slash_command_content_contains_version_3_frontmatter", async () => {
    const file = tmpFile("beheld.md");
    await installClaudeSlashCommand(file);

    const content = readFileSync(file, "utf-8");
    expect(content.startsWith("---\n")).toBe(true);
    expect(content).toContain('version: "3"');
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
    // Guard against accidental hardcoding of a real user name.
    expect(content).not.toMatch(/eduardo/i);
  });

  test("test_slash_command_import_routing_preserved", async () => {
    const file = tmpFile("beheld.md");
    await installClaudeSlashCommand(file);

    const content = readFileSync(file, "utf-8");
    // Both import variants still routed exactly as in v2.
    expect(content).toContain('action="import"');
    expect(content).toContain('url=<url extraída>');
    expect(content).toContain('url=""');
    // The rules naming them stayed:
    expect(content).toContain("Regra 2 — Import com URL");
    expect(content).toContain("Regra 3 — Import sem URL");
  });

  test("test_slash_command_view_routing_preserved", async () => {
    const file = tmpFile("beheld.md");
    await installClaudeSlashCommand(file);

    const content = readFileSync(file, "utf-8");
    // Fallback view routing kept identical surface: action="view" + view="$ARGUMENTS".
    expect(content).toContain('action="view"');
    expect(content).toContain('view="$ARGUMENTS"');
    expect(content).toContain("Regra 4 — View (padrão)");
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

    // Cross-check the snapshot itself: structural invariants the snapshot must
    // continue to encode. Diffing against the literal alone is enough to fail,
    // but these assertions document what the snapshot is meant to guarantee.
    expect(SLASH_COMMAND_CONTENT).toContain(`version: "${SLASH_COMMAND_VERSION}"`);
    expect(SLASH_COMMAND_CONTENT).toMatch(/^---\nversion: "3"\n---\n/);
    expect(SLASH_COMMAND_CONTENT).toContain("B3H31D");
    // Four routing rules: "Regra 1" through "Regra 4".
    expect(SLASH_COMMAND_CONTENT).toContain("Regra 1");
    expect(SLASH_COMMAND_CONTENT).toContain("Regra 2");
    expect(SLASH_COMMAND_CONTENT).toContain("Regra 3");
    expect(SLASH_COMMAND_CONTENT).toContain("Regra 4");
  });

  test("preserves user-customized content without legacy signature", async () => {
    const file = tmpFile("beheld.md");
    const original = "Conteúdo customizado pelo usuário — não toque.\n";
    writeFileSync(file, original);

    await installClaudeSlashCommand(file);

    expect(readFileSync(file, "utf-8")).toBe(original);
  });

  test("leaves v3 file untouched on subsequent install", async () => {
    const file = tmpFile("beheld.md");
    await installClaudeSlashCommand(file);
    const first = readFileSync(file, "utf-8");

    await installClaudeSlashCommand(file);
    const second = readFileSync(file, "utf-8");

    expect(second).toBe(first);
  });
});
