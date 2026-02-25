import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const cacheDir = path.join(os.tmpdir(), "npm-pack-check-cache");
mkdirSync(cacheDir, { recursive: true });

const packResult = spawnSync(
  "npm",
  ["pack", "--dry-run", "--json", "--cache", cacheDir],
  { encoding: "utf8" },
);

if (packResult.status !== 0) {
  process.stderr.write(packResult.stderr || "npm pack --dry-run failed\n");
  process.exit(packResult.status ?? 1);
}

const raw = packResult.stdout.trim();
if (!raw) {
  console.error("npm pack --dry-run returned empty output");
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(raw);
} catch (error) {
  console.error("failed to parse npm pack --dry-run JSON output");
  console.error(String(error));
  process.exit(1);
}

const files = (parsed?.[0]?.files ?? []).map((file) => String(file.path));
const blocked = files.filter((file) => file.includes("__tests__/") || file.endsWith(".test.ts"));

if (blocked.length > 0) {
  console.error("publish tarball contains test files:");
  for (const file of blocked) {
    console.error(`- ${file}`);
  }
  process.exit(1);
}

console.log(`pack check passed: ${files.length} files, no test files included`);
