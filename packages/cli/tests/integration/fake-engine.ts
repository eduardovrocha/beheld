// Standalone executable stub of the scoring engine for integration tests.
//
// Why a stub instead of the real engine: the real engine is a Python+FastAPI
// process bundled via PyInstaller, requires the Python toolchain at build
// time, and embeds its own SQLite/scorer logic that's exercised by Python
// tests already. The integration test under tests/integration/ is about the
// MCP-side contract — health detection, counter rebuild, doctor output, view
// alerts — and only needs a process that can be started, killed -9, and
// restarted on a known port.
//
// Spawn from a test:
//   const proc = Bun.spawn(["bun", "run", "fake-engine.ts"], {
//     env: { FAKE_ENGINE_PORT: "17338" },
//   });

const VERSION = "0.0.0-fake";
const port = parseInt(process.env.FAKE_ENGINE_PORT ?? "7338", 10);

let processedCount = 0;

const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, version: VERSION, pid: process.pid });
    }

    if (req.method === "GET" && url.pathname === "/status") {
      return Response.json({
        ok: true,
        version: VERSION,
        sessions_processed: processedCount,
        unprocessed_events: 0,
        last_processed_at: null,
      });
    }

    if (req.method === "POST" && url.pathname === "/process") {
      processedCount++;
      return Response.json({ status: "ok", processed: 1 });
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`[fake-engine] listening on http://127.0.0.1:${server.port} pid=${process.pid}`);

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT",  () => process.exit(0));
