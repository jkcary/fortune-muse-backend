import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const source = new URL("../src/modules/oracle/contracts.ts", import.meta.url);
const target = new URL(
  "../../frontend/src/lib/oracle-contract.ts",
  import.meta.url,
);
const expected =
  "// Generated from backend/src/modules/oracle/contracts.ts. Do not edit by hand.\n" +
  readFileSync(source, "utf8");
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== expected)
    throw new Error(
      "Oracle contract is stale. Run npm run contracts:sync in backend.",
    );
  console.log("Oracle frontend/backend contract matches.");
} else {
  writeFileSync(target, expected);
  console.log("Synced " + fileURLToPath(target));
}
