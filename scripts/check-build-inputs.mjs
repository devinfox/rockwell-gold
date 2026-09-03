#!/usr/bin/env node
// Runs before `next build` (npm "prebuild").
//
// 1. When RM_CATALOG_SOURCE=supabase, pulls the catalog snapshot from the
//    rockwell_* tables first (scripts/catalog-pull.mts), so a deploy always
//    builds against the database, the system of record.
// 2. Verifies the two generated data files exist and are not truncated. They
//    are deliberately not committed; without them the app throws at module
//    load with a stack trace. This turns that into a one-screen explanation
//    (audit: High — "clean clone cannot build").

import { existsSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();

// .env.local is not loaded by plain `node`; read the two keys this script needs.
function envFromFile(key) {
  if (process.env[key] !== undefined) return process.env[key];
  try {
    const m = readFileSync(join(root, ".env.local"), "utf-8").match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)\\s*$`, "m"));
    return m ? m[1].replace(/^"(.*)"$/, "$1") : undefined;
  } catch {
    return undefined;
  }
}

const source = (envFromFile("RM_CATALOG_SOURCE") || "file").trim().toLowerCase();
if (source === "supabase") {
  console.log("build inputs: RM_CATALOG_SOURCE=supabase → pulling catalog from rockwell_* tables");
  const r = spawnSync("npx", ["tsx", "scripts/catalog-pull.mts"], { stdio: "inherit", cwd: root, shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.error("\nCatalog pull failed. Fix the database connection, or set RM_CATALOG_SOURCE=file to build from the local snapshot.\n");
    process.exit(r.status ?? 1);
  }
}

const required = [
  {
    path: join("app", "data", "products.json"),
    minBytes: 100_000,
    how: "npx tsx scripts/catalog-pull.mts   (from Supabase; or npm run build:data from data/apmex/*.csv; or restore from archive/master-catalog-ai-25457/)",
  },
  {
    path: join("app", "data", "launch-pricing.json"),
    minBytes: 10_000,
    how: "npx tsx scripts/catalog-pull.mts   (from Supabase; or npx tsx scripts/build-launch-pricing.mts)",
  },
];

const problems = [];
for (const r of required) {
  const abs = join(root, r.path);
  if (!existsSync(abs)) problems.push(`${r.path} is missing.\n      → ${r.how}`);
  else if (statSync(abs).size < r.minBytes) problems.push(`${r.path} is only ${statSync(abs).size} bytes — looks truncated.\n      → ${r.how}`);
}

if (process.env.NODE_ENV === "production" || process.argv.includes("--strict")) {
  const secret = envFromFile("RM_SESSION_SECRET") || "";
  if (secret.length < 32) problems.push("RM_SESSION_SECRET is unset or shorter than 32 characters.\n      → openssl rand -base64 48, then set it in the deployment environment");
}

if (problems.length) {
  console.error("\nRockwell Metals · build inputs check failed:\n");
  for (const p of problems) console.error(`  • ${p}\n`);
  console.error("See .env.example and README.md → \"Catalog\".\n");
  process.exit(1);
}
console.log(`build inputs OK: catalog + pricing rule book present (source: ${source})`);
