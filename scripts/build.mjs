import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(
  process.execPath,
  [
    path.join(root, "node_modules/typescript/bin/tsc"),
    "-p",
    path.join(root, "tsconfig.json"),
  ],
  { cwd: root, stdio: "inherit" },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const source = path.join(root, "src/db/migrations");
const destination = path.join(root, "dist/db/migrations");
mkdirSync(destination, { recursive: true });
for (const file of readdirSync(source).filter((name) =>
  name.endsWith(".sql"),
)) {
  writeFileSync(
    path.join(destination, file),
    readFileSync(path.join(source, file)),
  );
}
console.log("API compiled; SQL migrations copied to dist/db/migrations.");
