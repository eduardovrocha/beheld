import { Command } from "commander";

export const VERSION = "0.1.1";

const program = new Command();

program
  .name("devprofile")
  .description("Privacy-first developer profiling for Claude Code and Continue.dev")
  .version(VERSION, "-v, --version");

program
  .command("init")
  .description("Configure DevProfile for Claude Code and Continue.dev")
  .option("--force", "skip reinit prompt and run all setup steps")
  .action(async (opts: { force?: boolean }) => {
    const { initCommand } = await import("./commands/init");
    await initCommand(opts);
  });

program
  .command("start")
  .description("Start the DevProfile daemon")
  .action(async () => {
    const { startCommand } = await import("./commands/start");
    await startCommand();
  });

program
  .command("stop")
  .description("Stop the DevProfile daemon")
  .action(async () => {
    const { stopCommand } = await import("./commands/stop");
    await stopCommand();
  });

program
  .command("restart")
  .description("Restart the DevProfile daemon (graceful stop + fresh start, validates via /health)")
  .action(async () => {
    const { restartCommand } = await import("./commands/restart");
    await restartCommand();
  });

program
  .command("status")
  .description("Show daemon and session status")
  .action(async () => {
    const { statusCommand } = await import("./commands/status");
    await statusCommand();
  });

program
  .command("doctor")
  .description("Diagnose DevProfile health (daemons, PID file, codesign, JSONL, orphans)")
  .action(async () => {
    const { doctorCommand } = await import("./commands/doctor");
    await doctorCommand();
  });

program
  .command("view")
  .description("Display your developer profile")
  .option("--json", "Output as JSON")
  .option("--scores-only", "Output scores as space-separated numbers")
  .option("--refresh", "Process pending events before displaying profile")
  .option("--coach", "Show coaching context (patterns + suggestions) instead of full profile")
  .option(
    "--session-hint <phase>",
    "Hint about current session phase (feature_work | debug | refactor | exploration | unknown)",
  )
  .action(async (opts: {
    json?: boolean;
    scoresOnly?: boolean;
    refresh?: boolean;
    coach?: boolean;
    sessionHint?: string;
  }) => {
    const { viewCommand } = await import("./commands/view");
    await viewCommand(opts);
  });

program
  .command("attest")
  .description("Bind your Ed25519 pubkey to your GitHub identity (Phase 5 / F5.6.1)")
  .option("--url <url>", "Platform API base URL (defaults to DEVPROFILE_API_URL or http://localhost:3000)")
  .action(async (opts: { url?: string }) => {
    const { attestCommand } = await import("./commands/attest");
    await attestCommand(opts);
  });

const snapshotCmd = program
  .command("snapshot")
  .description("Generate a signed .dpbundle of your current profile")
  .option("--output <path>", "Also write the bundle to this path")
  .option("--share", "Upload to the portal and print a QR + short URL")
  .option("--html", "Also generate a self-contained HTML retrato técnico")
  .option("--author-name <name>", "Name displayed on the HTML retrato (defaults to 'dev')")
  .action(async (opts: { output?: string; share?: boolean; html?: boolean; authorName?: string }) => {
    const { snapshotCommand } = await import("./commands/snapshot");
    await snapshotCommand(opts);
  });

snapshotCmd
  .command("list")
  .description("List previously generated snapshots")
  .action(async () => {
    const { snapshotListCommand } = await import("./commands/snapshot");
    await snapshotListCommand();
  });

program
  .command("verify <file>")
  .description("Verify a .dpbundle offline (schema + hash + signature)")
  .option("--chain", "Also walk previous_hash links resolving from ~/.devprofile/snapshots/")
  .action(async (file: string, opts: { chain?: boolean }) => {
    const { verifyCommand } = await import("./commands/verify");
    await verifyCommand(file, opts);
  });

const keysCmd = program
  .command("keys")
  .description("Manage Ed25519 keys used to sign .dpbundle snapshots");

keysCmd
  .command("show")
  .description("Display the current public key (Ed25519, JWK)")
  .action(async () => {
    const { keysShowCommand } = await import("./commands/keys");
    await keysShowCommand();
  });

keysCmd
  .command("import <path>")
  .description("Import an existing Ed25519 private key (JWK or PEM)")
  .action(async (path: string) => {
    const { keysImportCommand } = await import("./commands/keys");
    await keysImportCommand(path);
  });

keysCmd
  .command("rotate")
  .description("Generate a new key pair; current pair is archived (snapshots stay verifiable)")
  .action(async () => {
    const { keysRotateCommand } = await import("./commands/keys");
    await keysRotateCommand();
  });

program
  .command("import [url]")
  .description("Import repositories into L1 (git history bootstrap)")
  .option("--list", "List imported repositories")
  .option("--remove <hash>", "Remove an imported repository by its root commit hash")
  .option("--github", "Select from your GitHub repositories (uses gh CLI)")
  .option("--gitlab", "Select from your GitLab projects (uses glab CLI)")
  .action(async (
    url: string | undefined,
    opts: { list?: boolean; remove?: string; github?: boolean; gitlab?: boolean },
  ) => {
    const { runImport } = await import("./commands/import");
    await runImport({ ...opts, url });
  });

program
  .command("update")
  .description("Update DevProfile to the latest version")
  .action(async () => {
    const { updateCommand } = await import("./commands/update");
    await updateCommand();
  });

program
  .command("delete")
  .description("Remove DevProfile data")
  .option("--local", "Delete local data (~/.devprofile/)")
  .option("--remote", "Delete remote account and data")
  .option("--all", "Delete everything (local + remote + hooks)")
  .action(async (opts: { local?: boolean; remote?: boolean; all?: boolean }) => {
    const { deleteCommand } = await import("./commands/delete");
    await deleteCommand(opts);
  });

program
  .command("migrate-legacy")
  .description("Remove project-scoped MCP registrations (migrates to global scope)")
  .action(async () => {
    const { migrateProjectScopedRegistrations } = await import("./config/hooks");
    const n = await migrateProjectScopedRegistrations();
    if (n > 0) {
      console.log(`Migrated ${n} project-scoped registration(s) to global scope.`);
    } else {
      console.log("No project-scoped registrations found.");
    }
  });

program
  .command("server")
  .description("Start the MCP server (internal)")
  .option("--stdio", "Run as MCP stdio server (used by Claude Code)")
  .action(async (opts: { stdio?: boolean }) => {
    // --stdio: spawned by Claude Code via ~/.claude.json (type: stdio)
    // no flag: spawned by daemon-manager (stdio: ignore) or invoked manually
    const isStdio = opts.stdio === true;
    if (isStdio) {
      const { startStdioServer } = await import("../../mcp-server/src/stdio-server");
      await startStdioServer();
    } else {
      const { startServer } = await import("../../mcp-server/src/server");
      await startServer();
    }
  });

if (import.meta.main) {
  program.parse(process.argv);
}
