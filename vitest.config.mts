import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// fileURLToPath (not URL.pathname) so a repo path containing spaces resolves.
const stub = fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Each suite drives the on-disk JSON store, so they must not interleave.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      // rm-db and session are marked server-only; that guard is a no-op here.
      "server-only": stub,
    },
  },
});
