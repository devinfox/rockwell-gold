// Lets plain `node` run the app's TypeScript modules.
//
// The app uses extensionless relative imports ("./fine-weight"), which is what
// Next/Turbopack expects but which Node's ESM resolver rejects. Node strips the
// types itself; it just needs the specifier resolved. This hook retries a failed
// relative specifier with .ts, so scripts can import app modules directly rather
// than the engine being duplicated for scripting.
//
//   node --import ./scripts/ts-extension-hook.mjs scripts/price-test-10.mts

import { register } from "node:module";
import { pathToFileURL } from "node:url";

if (!process.env.__RM_TS_HOOK__) {
  process.env.__RM_TS_HOOK__ = "1";
  register(pathToFileURL(import.meta.filename));
}

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith(".") && !/\.[mc]?[jt]sx?$/.test(specifier)) {
      for (const ext of [".ts", "/index.ts"]) {
        try {
          return await nextResolve(specifier + ext, context);
        } catch { /* try next */ }
      }
    }
    throw err;
  }
}
