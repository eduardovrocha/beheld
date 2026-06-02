import { test, expect, describe } from "bun:test";

describe("pidListeningOn", () => {
  test("retorna undefined em porta sem listener", async () => {
    const { pidListeningOn } = await import("../../src/util/ports");
    // Porta improvável de estar em uso na máquina de teste.
    expect(pidListeningOn(65530)).toBeUndefined();
  });
});

describe("engineHealthy", () => {
  test("retorna false quando ninguém escuta a porta", async () => {
    const { engineHealthy } = await import("../../src/util/ports");
    const result = await engineHealthy(65530, 500);
    expect(result).toBe(false);
  });

  test("retorna true contra um servidor /health=200 local", async () => {
    const { engineHealthy } = await import("../../src/util/ports");
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/health") return new Response("ok");
        return new Response("no", { status: 404 });
      },
    });
    try {
      const result = await engineHealthy(server.port, 500);
      expect(result).toBe(true);
    } finally {
      server.stop();
    }
  });

  test("retorna false em timeout", async () => {
    const { engineHealthy } = await import("../../src/util/ports");
    const server = Bun.serve({
      port: 0,
      async fetch() {
        await new Promise((r) => setTimeout(r, 1000));
        return new Response("late");
      },
    });
    try {
      const t0 = Date.now();
      const result = await engineHealthy(server.port, 100);
      const elapsed = Date.now() - t0;
      expect(result).toBe(false);
      expect(elapsed).toBeLessThan(900);
    } finally {
      server.stop();
    }
  });
});

describe("waitSocketRelease", () => {
  test("retorna true imediato quando ninguém escuta", async () => {
    const { waitSocketRelease } = await import("../../src/util/ports");
    const result = await waitSocketRelease(65530, 1000);
    expect(result).toBe(true);
  });

  test("retorna false em timeout enquanto socket continua preso", async () => {
    const { waitSocketRelease } = await import("../../src/util/ports");
    const server = Bun.serve({ port: 0, fetch: () => new Response("x") });
    try {
      const t0 = Date.now();
      const result = await waitSocketRelease(server.port, 250);
      const elapsed = Date.now() - t0;
      expect(result).toBe(false);
      expect(elapsed).toBeGreaterThanOrEqual(200);
    } finally {
      server.stop();
    }
  });

  test("retorna true quando socket libera durante o poll", async () => {
    const { waitSocketRelease } = await import("../../src/util/ports");
    const server = Bun.serve({ port: 0, fetch: () => new Response("x") });
    const port = server.port;
    // Stop após 300ms — o poll deve detectar.
    setTimeout(() => server.stop(), 300);
    const result = await waitSocketRelease(port, 2000);
    // Validação do contrato lógico: a função detecta corretamente a
    // liberação dentro do timeout. NÃO assertamos wall-clock — o
    // `spawnSync("lsof")` interno fica enfileirado sob load da suite
    // completa (macOS lsof é serializado), inflando o elapsed para
    // 2-3s e quebrando uma assertion que não testa o contrato real.
    // Em produção o que importa é o `true/false` final, e esse é
    // entregue corretamente.
    expect(result).toBe(true);
  });
});
