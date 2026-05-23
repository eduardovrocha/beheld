import { describe, expect, test } from "bun:test";

import {
  buildStartUrl,
  claimAttestation,
  generateCliState,
  jwkXToStdB64,
  parseCallbackQuery,
} from "../src/commands/attest";

describe("jwkXToStdB64", () => {
  test("converte caractere base64url '-' pra '+' standard", () => {
    expect(jwkXToStdB64("a-b")).toBe("a+b=");
  });

  test("converte caractere base64url '_' pra '/' standard", () => {
    expect(jwkXToStdB64("a_b")).toBe("a/b=");
  });

  test("adiciona padding '=' até múltiplo de 4", () => {
    expect(jwkXToStdB64("AAA")).toBe("AAA=");
    expect(jwkXToStdB64("AA")).toBe("AA==");
    expect(jwkXToStdB64("A")).toBe("A===");
  });

  test("não altera input que já é múltiplo de 4 sem chars especiais", () => {
    expect(jwkXToStdB64("AAAA")).toBe("AAAA");
  });

  test("converte JWK.x real (43 chars base64url) pra 44 chars standard padded", () => {
    // 32 raw bytes = 43 base64url chars (no padding) or 44 standard chars (1 pad).
    const jwkX = "ao_AsOyFTMrORd9irGlQjbxI5C7Qb4TfZVi7sgnoyio";
    expect(jwkXToStdB64(jwkX)).toBe("ao/AsOyFTMrORd9irGlQjbxI5C7Qb4TfZVi7sgnoyio=");
  });
});

describe("generateCliState", () => {
  test("retorna string base64url com pelo menos 32 chars (24 bytes encoded)", () => {
    const s = generateCliState();
    expect(s.length).toBeGreaterThanOrEqual(32);
    expect(s).toMatch(/^[A-Za-z0-9_\-]+$/);
  });

  test("chamadas consecutivas produzem valores distintos", () => {
    expect(generateCliState()).not.toBe(generateCliState());
  });
});

describe("buildStartUrl", () => {
  test("monta URL com cli_state, cli_port e dev_pubkey URL-encoded", () => {
    const url = buildStartUrl({
      baseUrl: "http://localhost:3000",
      cliState: "abc123",
      cliPort: 53432,
      devPubkey: "ed25519-pub:ao/AsOyFTMrORd9irGlQjbxI5C7Qb4TfZVi7sgnoyio=",
    });
    expect(url).toContain("http://localhost:3000/api/auth/github/start?");
    expect(url).toContain("cli_state=abc123");
    expect(url).toContain("cli_port=53432");
    expect(url).toContain("dev_pubkey=ed25519-pub%3Aao%2FAsOyFTMrORd9irGlQjbxI5C7Qb4TfZVi7sgnoyio%3D");
  });
});

describe("parseCallbackQuery", () => {
  test("extrai cli_state e claim_code do search params", () => {
    const sp = new URLSearchParams({ cli_state: "s", claim_code: "c" });
    expect(parseCallbackQuery(sp)).toEqual({ cliState: "s", claimCode: "c" });
  });

  test("estoura quando cli_state ausente", () => {
    expect(() => parseCallbackQuery(new URLSearchParams({ claim_code: "c" }))).toThrow(/cli_state/);
  });

  test("estoura quando claim_code ausente", () => {
    expect(() => parseCallbackQuery(new URLSearchParams({ cli_state: "s" }))).toThrow(/claim_code/);
  });
});

describe("claimAttestation", () => {
  test("faz POST com claim_code e retorna o JSON da attestation", async () => {
    const expected = {
      payload: {
        type: "beheld-identity-attestation/v1",
        platform_key_id: "k",
        dev_pubkey: "ed25519-pub:AAAA",
        github: { user_id: 1, login: "u", verified_at: "t" },
        attested_at: "t",
      },
      signature: "ed25519:s",
    };
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("http://x/api/attestation/claim");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({ claim_code: "claim-code-xyz" });
      return new Response(JSON.stringify(expected), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await claimAttestation("http://x", "claim-code-xyz", fakeFetch);
    expect(result).toEqual(expected);
  });

  test("estoura quando backend responde !ok", async () => {
    const fakeFetch = (async () =>
      new Response("not found", { status: 404 })) as unknown as typeof fetch;
    await expect(claimAttestation("http://x", "c", fakeFetch)).rejects.toThrow(/404/);
  });
});
