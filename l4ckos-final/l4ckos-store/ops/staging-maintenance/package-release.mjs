import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const source = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(source, "../..");

const git = (...args) =>
  execFileSync("git", args, {
    cwd: project,
    encoding: "utf8",
  }).trim();

if (git("branch", "--show-current") !== "feat/preorder-batch") {
  throw new Error("BRANCH_INCORRETA");
}

const baseline = git("rev-parse", "a087bb2^{commit}");
const ancestor = git("merge-base", "a087bb2", "HEAD");

if (ancestor !== baseline) {
  throw new Error("COMMIT_BASE_INCORRETO");
}

if (git("rev-parse", "--show-prefix") !==
    "l4ckos-final/l4ckos-store/") {
  throw new Error("ESTRUTURA_INESPERADA");
}

const root = mkdtempSync(
  path.join(tmpdir(), "l4ckos-maintenance-release.")
);

const app = path.join(
  root,
  "l4ckos-final",
  "l4ckos-store"
);

const dst = path.join(app, "ops", "staging-maintenance");

mkdirSync(dst, { recursive: true });
mkdirSync(path.join(app, "server"), { recursive: true });

const files = [
  "package.json",
  "package-lock.json",
  "guard.mjs",
  "http.mjs",
  "server.mjs",
];

for (const file of files) {
  copyFileSync(
    path.join(source, file),
    path.join(dst, file)
  );
}

copyFileSync(
  path.join(source, "Dockerfile.release"),
  path.join(app, "server", "Dockerfile")
);

const sha = (file) => createHash("sha256")
  .update(readFileSync(file))
  .digest("hex");

for (const file of files) {
  if (sha(path.join(source, file)) !==
      sha(path.join(dst, file))) {
    throw new Error(`COPY_CHECKSUM_FAILED: ${file}`);
  }
}

console.error("[OK] Seis arquivos empacotados");
console.error("[OK] Checksums dos arquivos de aplicação verificados");
console.error("[OK] Dockerfile no caminho esperado");
console.log(root);
