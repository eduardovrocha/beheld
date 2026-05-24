import { test, expect, describe } from "bun:test";

import { renderTrustDetails, renderSnapshotHtml } from "../src/ui/snapshot-html";

// ── shared minimal data ──────────────────────────────────────────────────────

/** Build the minimum SnapshotHtmlData the renderer needs. The trust panel
 *  reads from `data.bundle.{hash,public_key,attestation,rekor,signature}` —
 *  everything else can be empty/null without affecting these assertions. */
function makeData(over: Partial<{
  signature: string;
  attestation: unknown;
  rekor: unknown;
}> = {}) {
  return {
    bundle: {
      version: "5",
      payload: {
        created_at: "2026-05-24T00:00:00+00:00",
        scores: { date: "2026-05-24", prompt_quality: 30, test_maturity: 10,
                  tech_breadth: 50, growth_rate: 70, overall: 35, sessions_analyzed: 30 },
        l1: { total_repos: 13 },
        l2: { sessions_analyzed: 32, platforms: {}, workflow_distribution: {} },
        engine_version_hash: "a".repeat(64),
      } as unknown as any,
      hash: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      signature: over.signature ?? "ed25519:dummy",
      public_key: "ed25519:pub",
      attestation: over.attestation ?? null,
      rekor: over.rekor ?? null,
    } as unknown as any,
    signals: { ecosystems: { dominant: [], secondary: [] } } as unknown as any,
    identity: {
      identity_long: "Dev test.",
      identity_short: "Dev test.",
      confidence: "low",
      generation_path: "fallback",
      model_used: null,
    } as unknown as any,
    emergent: null,
    authorName: "dev",
  };
}

const ATTESTATION = {
  payload: {
    type: "beheld-identity-attestation/v1",
    platform_key_id: "k1",
    dev_pubkey: "ed25519-pub:AAAA",
    github: { login: "eduardovrocha", user_id: 181376, verified_at: "2026-05-24T16:36:37Z" },
    attested_at: "2026-05-24T16:36:37Z",
  },
  signature: "ed25519:platformsig",
};

const REKOR = {
  logIndex: 287435982,
  uuid: "abcdef0123456789abcdef0123456789abcdef0123456789",
  integratedTime: "2026-05-24T16:40:00Z",
  signedEntryTimestamp: "base64set",
};

// ── tier badge ladder ────────────────────────────────────────────────────────

describe("renderTierBadge — ladder mapping", () => {
  test("rekor present → 'trusted' variant + Sigstore label", () => {
    const html = renderSnapshotHtml(makeData({ attestation: ATTESTATION, rekor: REKOR }));
    expect(html).toContain('data-tier="fully_verifiable"');
    expect(html).toContain("tier-trusted");
    expect(html).toContain("Sigstore Rekor");
  });

  test("attestation + engine hash, no rekor → 'strong' (engine_verified)", () => {
    const html = renderSnapshotHtml(makeData({ attestation: ATTESTATION, rekor: null }));
    expect(html).toContain('data-tier="engine_verified"');
    expect(html).toContain("tier-strong");
    expect(html).toContain("engine verificados");
  });

  test("signature only (no attestation, no rekor) → 'neutral' (signature_only)", () => {
    const html = renderSnapshotHtml(makeData({ attestation: null, rekor: null }));
    expect(html).toContain('data-tier="signature_only"');
    expect(html).toContain("tier-neutral");
    expect(html).toContain("Assinado localmente");
  });

  test("unsigned bundle → 'neutral' (unsigned)", () => {
    const html = renderSnapshotHtml(makeData({ signature: "", attestation: null, rekor: null }));
    expect(html).toContain('data-tier="unsigned"');
    expect(html).toContain("Não assinado");
  });
});

// ── trust details panel ──────────────────────────────────────────────────────

describe("renderTrustDetails — GitHub identity block", () => {
  test("includes GitHub login + verified date when attestation is present", () => {
    const bundle = makeData({ attestation: ATTESTATION }).bundle as any;
    const html = renderTrustDetails(bundle);

    expect(html).toContain("Identidade GitHub");
    expect(html).toContain("@eduardovrocha");
    expect(html).toContain("https://github.com/eduardovrocha");
    expect(html).toContain("user id 181376");
    expect(html).toContain("24/05/2026");
  });

  test("shows attestation hint when attestation is absent", () => {
    const bundle = makeData({ attestation: null }).bundle as any;
    const html = renderTrustDetails(bundle);

    expect(html).toContain("Identidade GitHub");
    expect(html).toContain("Não vinculada");
    expect(html).toContain("beheld attest");
    expect(html).not.toContain("github.com/");
  });

  test("treats attestation without signature as absent", () => {
    const bundle = makeData({
      attestation: { ...ATTESTATION, signature: "" },
    }).bundle as any;
    const html = renderTrustDetails(bundle);
    expect(html).toContain("Não vinculada");
  });
});

describe("renderTrustDetails — Rekor block", () => {
  test("includes search.sigstore.dev (primary) + entry URL (secondary) when present", () => {
    const bundle = makeData({ rekor: REKOR }).bundle as any;
    const html = renderTrustDetails(bundle);

    expect(html).toContain("Sigstore Rekor");
    expect(html).toContain("log #287435982");
    // 🎉 prefixes the section title (not the body) to mark the inclusion
    // as a confirmed success — recrutador não passa por isso por acidente.
    expect(html).toContain('<p class="trust-section-title">🎉 Sigstore Rekor</p>');
    // Primary link: user-friendly Sigstore search UI by logIndex.
    expect(html).toContain("search.sigstore.dev/?logIndex=287435982");
    // Secondary link: raw API URL for auditors, with full UUID.
    expect(html).toContain("rekor.sigstore.dev/api/v1/log/entries/" + REKOR.uuid);
    // UUID is truncated for display; full UUID is only in the API URL.
    expect(html).toContain("abcdef012345…6789");
    expect(html).toContain("24/05/2026");
  });

  test("shows 'não submetido' hint when rekor is null", () => {
    const bundle = makeData({ rekor: null }).bundle as any;
    const html = renderTrustDetails(bundle);

    expect(html).toContain("Sigstore Rekor");
    expect(html).toContain("Não submetido");
    expect(html).toContain("--rekor-submit");
    expect(html).not.toContain("rekor.sigstore.dev/api/v1/log/entries/");
  });

  test("treats malformed rekor (missing logIndex) as absent", () => {
    const bundle = makeData({ rekor: { uuid: "x" } }).bundle as any;
    const html = renderTrustDetails(bundle);
    expect(html).toContain("Não submetido");
  });
});

describe("renderTrustDetails — preserves existing hash + key block", () => {
  test("keeps hash and public_key code blocks in the panel", () => {
    const bundle = makeData().bundle as any;
    const html = renderTrustDetails(bundle);

    expect(html).toContain("Hash do payload");
    expect(html).toContain('id="payload-hash"');
    expect(html).toContain(bundle.hash);
    expect(html).toContain("Chave pública");
    expect(html).toContain('id="public-key"');
    expect(html).toContain(bundle.public_key);
  });
});

// ── header display name — cascade ───────────────────────────────────────────

describe("renderSnapshotHtml — header display name", () => {
  test("explicit authorName wins over attestation", () => {
    const data = makeData({ attestation: ATTESTATION });
    data.authorName = "Maria Silva";
    const html = renderSnapshotHtml(data);
    expect(html).toContain('<span class="name" itemprop="name">Maria Silva</span>');
    expect(html).not.toContain("@eduardovrocha</span>");
  });

  test("falls back to @<github_login> when authorName is empty + attestation present", () => {
    const data = makeData({ attestation: ATTESTATION });
    data.authorName = undefined;
    const html = renderSnapshotHtml(data);
    expect(html).toContain('<span class="name" itemprop="name">@eduardovrocha</span>');
  });

  test("falls back to 'dev' when neither authorName nor attestation present", () => {
    const data = makeData({ attestation: null });
    data.authorName = undefined;
    const html = renderSnapshotHtml(data);
    expect(html).toContain('<span class="name" itemprop="name">dev</span>');
  });

  test("blank authorName is treated as not provided", () => {
    const data = makeData({ attestation: ATTESTATION });
    data.authorName = "   ";
    const html = renderSnapshotHtml(data);
    expect(html).toContain('<span class="name" itemprop="name">@eduardovrocha</span>');
  });
});
