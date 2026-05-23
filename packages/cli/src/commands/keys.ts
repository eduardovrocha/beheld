import { existsSync } from "node:fs";

import {
  ensureKeys,
  getKeyPaths,
  importPrivateKey,
  keysExist,
  loadPublicJwk,
  publicKeyFingerprint,
  rotateKeys,
} from "../keys/keystore";
import { ok, fail, warn, meta, bold, brand, DIM, RESET } from "../ui/styles";

export async function keysShowCommand(): Promise<void> {
  console.log(brand("sua chave de assinatura"));
  const paths = getKeyPaths();
  if (!keysExist()) {
    console.error(fail("Nenhuma chave Ed25519 encontrada"));
    console.error(`     ${DIM}Execute: beheld init  ${meta("(gera o par automaticamente)")}${RESET}`);
    console.error(`     ${DIM}Ou: beheld keys import <arquivo>${RESET}`);
    process.exit(1);
  }
  const pub = loadPublicJwk();
  const fp = await publicKeyFingerprint(pub);

  console.log("");
  console.log(`  ${bold("Public key")} ${meta("(Ed25519, JWK)")}`);
  console.log(`     ${DIM}x:${RESET}           ${pub.x}`);
  console.log(`     ${DIM}fingerprint:${RESET} ${bold(fp)}`);
  console.log(`     ${DIM}path:${RESET}        ${paths.publicPath}`);
  console.log("");
}

export async function keysImportCommand(sourcePath: string): Promise<void> {
  console.log(brand("adicionando uma chave"));
  if (!sourcePath) {
    console.error(fail("Caminho da chave é obrigatório"));
    console.error(`     ${DIM}Uso: beheld keys import <arquivo>${RESET}`);
    process.exit(1);
  }
  if (!existsSync(sourcePath)) {
    console.error(fail(`Arquivo não encontrado: ${sourcePath}`));
    process.exit(1);
  }

  if (keysExist()) {
    console.error(warn("Já existe uma chave instalada"));
    console.error(`     ${DIM}Use \`beheld keys rotate\` antes de importar — a chave atual fica arquivada.${RESET}`);
    process.exit(1);
  }

  try {
    const paths = await importPrivateKey(sourcePath);
    const pub = loadPublicJwk();
    const fp = await publicKeyFingerprint(pub);
    console.log("");
    console.log(ok("Chave Ed25519 importada"));
    console.log(`     ${DIM}fingerprint:${RESET} ${bold(fp)}`);
    console.log(`     ${DIM}private:${RESET}     ${paths.privatePath}  ${meta("(0600)")}`);
    console.log(`     ${DIM}public:${RESET}      ${paths.publicPath}   ${meta("(0644)")}`);
    console.log("");
  } catch (err) {
    console.error(fail(`Falha ao importar: ${(err as Error).message}`));
    process.exit(1);
  }
}

export async function keysRotateCommand(): Promise<void> {
  console.log(brand("trocando suas chaves"));
  if (!keysExist()) {
    console.error(fail("Nenhuma chave para rotacionar"));
    console.error(`     ${DIM}Execute: beheld init${RESET}`);
    process.exit(1);
  }

  try {
    const { archived } = await rotateKeys();
    const pub = loadPublicJwk();
    const fp = await publicKeyFingerprint(pub);
    console.log("");
    console.log(ok("Par de chaves rotacionado"));
    console.log(`     ${DIM}nova fingerprint:${RESET} ${bold(fp)}`);
    console.log(`     ${DIM}arquivo anterior:${RESET} ${archived}`);
    console.log("");
    console.log(`  ${meta("Snapshots antigos continuam verificáveis com a public_key embutida neles.")}`);
    console.log("");
  } catch (err) {
    console.error(fail(`Falha ao rotacionar: ${(err as Error).message}`));
    process.exit(1);
  }
}

/** Hook used by `beheld init` — silent if keys already exist. */
export async function ensureKeysSilent(): Promise<{ created: boolean }> {
  const result = await ensureKeys();
  return { created: result.created };
}
