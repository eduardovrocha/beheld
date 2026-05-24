import { Command } from "commander";

export const VERSION = "0.3.2";

const program = new Command();

program
  .name("beheld")
  .description("Privacy-first developer profiling for Claude Code and Continue.dev")
  .version(VERSION, "-v, --version");

program
  .command("init")
  .description("Configure Beheld for Claude Code and Continue.dev")
  .option("--force", "skip reinit prompt and run all setup steps")
  .action(async (opts: { force?: boolean }) => {
    const { initCommand } = await import("./commands/init");
    await initCommand(opts);
  });

program
  .command("start")
  .description("Start the Beheld daemon")
  .action(async () => {
    const { startCommand } = await import("./commands/start");
    await startCommand();
  });

program
  .command("stop")
  .description("Stop the Beheld daemon")
  .action(async () => {
    const { stopCommand } = await import("./commands/stop");
    await stopCommand();
  });

program
  .command("restart")
  .description("Restart the Beheld daemon (graceful stop + fresh start, validates via /health)")
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
  .description("Diagnose Beheld health (daemons, PID file, codesign, JSONL, orphans)")
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
  .option("--url <url>", "Platform API base URL (defaults to BEHELD_API_URL or http://localhost:3000)")
  .action(async (opts: { url?: string }) => {
    const { attestCommand } = await import("./commands/attest");
    await attestCommand(opts);
  });

const identityCmd = program
  .command("identity")
  .description("Manage the GitHub identity binding (Phase 5 / F5.6)");

identityCmd
  .command("link")
  .description("Bind your Ed25519 pubkey to your GitHub identity (alias of `beheld attest`)")
  .option("--url <url>", "Platform API base URL (defaults to BEHELD_API_URL or http://localhost:3000)")
  .action(async (opts: { url?: string }) => {
    const { identityLinkCommand } = await import("./commands/identity");
    await identityLinkCommand(opts);
  });

identityCmd
  .command("status")
  .description("Show the GitHub identity currently bound to your key, if any")
  .action(async () => {
    const { identityStatusCommand } = await import("./commands/identity");
    await identityStatusCommand();
  });

const snapshotCmd = program
  .command("snapshot")
  .description("Generate a signed .beheld of your current profile")
  .option("--output <path>", "Also write the bundle to this path")
  .option("--share", "Upload to the portal and print a QR + short URL")
  .option("--html", "Also generate a self-contained HTML retrato técnico")
  .option("--author-name <name>", "Name displayed on the HTML retrato (defaults to 'dev')")
  .option("--no-rekor", "Skip Sigstore Rekor submission (Phase 5 / F5.8)")
  .option(
    "--rekor-submit <path>",
    "Re-submit an existing bundle to Rekor and promote it to fully_verifiable",
  )
  .action(async (opts: {
    output?: string;
    share?: boolean;
    html?: boolean;
    authorName?: string;
    rekor?: boolean;
    rekorSubmit?: string;
  }) => {
    const { snapshotCommand } = await import("./commands/snapshot");
    // commander's --no-rekor sets `opts.rekor = false`; translate to noRekor.
    await snapshotCommand({
      output: opts.output,
      share: opts.share,
      html: opts.html,
      authorName: opts.authorName,
      noRekor: opts.rekor === false,
      rekorSubmit: opts.rekorSubmit,
    });
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
  .description("Verify a .beheld offline (schema + hash + signature)")
  .option("--chain", "Also walk previous_hash links resolving from ~/.beheld/snapshots/")
  .option("--verify-rekor", "Confirm the Rekor inclusion proof via the public log (Phase 5 / F5.8)")
  .action(async (file: string, opts: { chain?: boolean; verifyRekor?: boolean }) => {
    const { verifyCommand } = await import("./commands/verify");
    await verifyCommand(file, opts);
  });

const keysCmd = program
  .command("keys")
  .description("Manage Ed25519 keys used to sign .beheld snapshots");

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
  .description("Update Beheld to the latest version")
  .action(async () => {
    const { updateCommand } = await import("./commands/update");
    await updateCommand();
  });

program
  .command("delete")
  .description("Remove Beheld data")
  .option("--local", "Delete local data (~/.beheld/)")
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
