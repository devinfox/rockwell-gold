#!/usr/bin/env node
// Runs before `next build` (npm "prebuild"). The catalog and the pricing rule
// book are generated data files that are deliberately not committed; without
// them the app throws at module load with a stack trace. This turns that into
// a one-screen explanation of what is missing and how to produce it
// (audit: High — "clean clone cannot build").

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const required = [
  {
    path: join("app", "data", "products.json"),
    minBytes: 100_000,
    how: "npm run build:data   (parses data/apmex/*.csv; or restore from archive/master-catalog-ai-25457/ — see its README)",
  },
  {
    path: join("app", "data", "launch-pricing.json"),
    minBytes: 10_000,
    how: "npx tsx scripts/build-launch-pricing.mts   (needs app/data/products.json and the competitor observations under data/)",
  },
];

const problems = [];
for (const r of required) {
  const abs = join(root, r.path);
  if (!existsSync(abs)) problems.push(`${r.path} is missing.\n      → ${r.how}`);
  else if (statSync(abs).size < r.minBytes) problems.push(`${r.path} is only ${statSync(abs).size} bytes — looks truncated.\n      → ${r.how}`);
}

if (process.env.NODE_ENV === "production" || process.argv.includes("--strict")) {
  const secret = process.env.RM_SESSION_SECRET || "";
  if (secret.length < 32) problems.push("RM_SESSION_SECRET is unset or shorter than 32 characters.\n      → openssl rand -base64 48, then set it in the deployment environment");
}

if (problems.length) {
  console.error("\nRockwell Metals · build inputs check failed:\n");
  for (const p of problems) console.error(`  • ${p}\n`);
  console.error("See .env.example and README.md → \"Product data pipeline\".\n");
  process.exit(1);
}
console.log("build inputs OK: catalog + pricing rule book present");
