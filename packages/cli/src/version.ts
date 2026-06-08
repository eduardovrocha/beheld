/**
 * Single source of truth for the CLI's binary version string.
 *
 * Importado por:
 *   - index.ts          → `program.version(VERSION)` e o `-v` global
 *   - commands/init.ts  → escrito em `~/.beheld/config.json` (auditoria de
 *     qual CLI inicializou a config)
 *   - commands/update.ts → comparação contra a versão remota servida por
 *     `GET <api>/api/version`
 *   - ui/wizard.ts      → payload do counter `POST /api/install/register`
 *
 * Bump no release: editar somente este arquivo. O backend (Rails)
 * mantém um espelho explícito em `app/controllers/versions_controller.rb`
 * que precisa ser bumpado em paralelo no deploy.
 */
export const VERSION = "0.4.1";
