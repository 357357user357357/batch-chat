#!/usr/bin/env node
/**
 * Builds the pure (React-Native-free) service modules into .test-build/ with
 * the repo's TypeScript compiler, then runs the node:test suites in
 * tests/unit/ against the built JS. Run via `npm test`.
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, ".test-build");
const require = createRequire(import.meta.url);
const ts = require("typescript");

// Dependency-free modules only — anything importing expo/* or @/storage
// can't run under plain node.
const modules = ["model-variants", "message-meta", "backup-parse", "sync-mapping"];

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const name of modules) {
  const source = readFileSync(join(root, "src/services", `${name}.ts`), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: `${name}.ts`,
  });
  if (compiled.diagnostics?.length) {
    console.error(compiled.diagnostics.map(String).join("\n"));
    process.exit(1);
  }
  writeFileSync(join(outDir, `${name}.mjs`), compiled.outputText);
}

const result = spawnSync(
  process.execPath,
  ["--test", join("tests", "unit", "*.test.mjs")],
  {
    cwd: root,
    stdio: "inherit",
  },
);
process.exit(result.status ?? 1);
