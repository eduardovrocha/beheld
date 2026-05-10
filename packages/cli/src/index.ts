import { Command } from "commander";

export const VERSION = "0.1.0";

const program = new Command();

program
  .name("devprofile")
  .description("Privacy-first developer profiling for Claude Code and Continue.dev")
  .version(VERSION, "-v, --version");

program
  .command("init")
  .description("Configure DevProfile for Claude Code and Continue.dev")
  .action(async () => {
    const { initCommand } = await import("./commands/init");
    await initCommand();
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
  .description("Restart the DevProfile daemon")
  .action(async () => {
    const { stopCommand } = await import("./commands/stop");
    const { startCommand } = await import("./commands/start");
    await stopCommand();
    await startCommand();
  });

program
  .command("status")
  .description("Show daemon and session status")
  .action(async () => {
    const { statusCommand } = await import("./commands/status");
    await statusCommand();
  });

program
  .command("view")
  .description("Display your developer profile")
  .option("--json", "Output as JSON")
  .option("--scores-only", "Output scores as space-separated numbers")
  .action(async (opts: { json?: boolean; scoresOnly?: boolean }) => {
    const { viewCommand } = await import("./commands/view");
    await viewCommand(opts);
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
  .command("server")
  .description("Start the MCP server (internal)")
  .action(async () => {
    const { startServer } = await import("../../mcp-server/src/server");
    await startServer();
  });

if (import.meta.main) {
  program.parse(process.argv);
}
