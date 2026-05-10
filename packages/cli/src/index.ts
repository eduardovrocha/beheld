export const VERSION = "0.1.0";

const COMMANDS = ["init", "start", "stop", "restart", "status", "view", "update", "delete"] as const;
type Command = (typeof COMMANDS)[number];

function printHelp(): void {
  console.log(`devprofile ${VERSION}

Usage: devprofile <command> [options]

Commands:
  init     Configure DevProfile for Claude Code and Continue.dev
  start    Start the DevProfile daemon
  stop     Stop the DevProfile daemon
  restart  Restart the DevProfile daemon
  status   Show daemon and session status
  view     Display your developer profile
  update   Update DevProfile to the latest version
  delete   Remove DevProfile data

Options:
  -v, --version  Show version number
  -h, --help     Show this help message

Run 'devprofile <command> --help' for command-specific options.`);
}

function isCommand(arg: string): arg is Command {
  return (COMMANDS as readonly string[]).includes(arg);
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  if (args.includes("--version") || args.includes("-v")) {
    console.log(`devprofile ${VERSION}`);
    process.exit(0);
  }

  const [command] = args;

  if (!isCommand(command)) {
    console.error(`devprofile: unknown command '${command}'`);
    console.error("Run 'devprofile --help' for usage.");
    process.exit(1);
  }

  console.error(`devprofile: '${command}' is not yet implemented.`);
  console.error("Check https://github.com/devprofile/devprofile for the latest release.");
  process.exit(1);
}

main();
