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

export async function keysShowCommand(): Promise<void> {
  const paths = getKeyPaths();
  if (!keysExist()) {
    console.error("✗ Nenhuma chave Ed25519 encontrada.");
    console.error(`  Execute: devprofile init  (gera o par automaticamente)`);
    console.error(`  Ou: devprofile keys import <arquivo>`);
    process.exit(1);
  }
  const pub = loadPublicJwk();
  const fp = await publicKeyFingerprint(pub);

  console.log("");
  console.log("  Public key (Ed25519, JWK)");
  console.log(`    x:           ${pub.x}`);
  console.log(`    fingerprint: ${fp}`);
  console.log(`    path:        ${paths.publicPath}`);
  console.log("");
}

export async function keysImportCommand(sourcePath: string): Promise<void> {
  if (!sourcePath) {
    console.error("✗ Caminho da chave é obrigatório: devprofile keys import <arquivo>");
    process.exit(1);
  }
  if (!existsSync(sourcePath)) {
    console.error(`✗ Arquivo não encontrado: ${sourcePath}`);
    process.exit(1);
  }

  if (keysExist()) {
    console.error(
      "⚠️  Já existe uma chave instalada. Use `devprofile keys rotate` antes de importar — assim a chave atual fica no arquivo.",
    );
    process.exit(1);
  }

  try {
    const paths = await importPrivateKey(sourcePath);
    const pub = loadPublicJwk();
    const fp = await publicKeyFingerprint(pub);
    console.log("");
    console.log("  ✓ Chave Ed25519 importada");
    console.log(`    fingerprint: ${fp}`);
    console.log(`    private:     ${paths.privatePath}  (0600)`);
    console.log(`    public:      ${paths.publicPath}   (0644)`);
    console.log("");
  } catch (err) {
    console.error(`✗ Falha ao importar: ${(err as Error).message}`);
    process.exit(1);
  }
}

export async function keysRotateCommand(): Promise<void> {
  if (!keysExist()) {
    console.error("✗ Nenhuma chave para rotacionar. Execute: devprofile init");
    process.exit(1);
  }

  try {
    const { archived } = await rotateKeys();
    const pub = loadPublicJwk();
    const fp = await publicKeyFingerprint(pub);
    console.log("");
    console.log("  ✓ Par de chaves rotacionado");
    console.log(`    nova fingerprint:  ${fp}`);
    console.log(`    arquivo anterior:  ${archived}`);
    console.log("");
    console.log("  Snapshots antigos continuam verificáveis com a public_key embutida neles.");
    console.log("");
  } catch (err) {
    console.error(`✗ Falha ao rotacionar: ${(err as Error).message}`);
    process.exit(1);
  }
}

/** Hook used by `devprofile init` — silent if keys already exist. */
export async function ensureKeysSilent(): Promise<{ created: boolean }> {
  const result = await ensureKeys();
  return { created: result.created };
}
