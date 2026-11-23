/**
 * Production build script — two-output bundle.
 *
 * Two-layer miniapps ship TWO bundles in one zip:
 *   - dist/background/index.js     — JSContext entry, no DOM
 *   - dist/ui/index.html + assets  — WebView entry, full DOM
 *
 * Bun.build() handles both. The background bundle uses `format: "iife"`
 * because JSC + Zipline/QuickJS evaluate it as a classic script — any
 * top-level ESM `export` is a SyntaxError there. `@mentra/miniapp/background`
 * is bundled in (not external) because the JSContext has no module
 * resolver; the host's polyfill installs `__dispatch`/`__deliver` but
 * does NOT provide the SDK surface. The UI bundle uses target: "browser"
 * with no externals.
 *
 * Build-time env vars: any `MENTRA_PUBLIC_*` key in your shell or
 * miniapp-local `.env` gets inlined into both bundles via define.
 * Anything inlined into the UI bundle is visible in WebView network
 * requests and source maps — secrets MUST live behind your own backend
 * rather than in MENTRA_PUBLIC_*.
 *
 * Add bundler plugins (Tailwind, Vue, etc.) by pushing them into the
 * matching `plugins` array. For example, with Tailwind v4 (UI side only):
 *
 *     const tailwind = (await import("bun-plugin-tailwind")).default
 *     uiBuild.plugins.push(tailwind)
 *
 * Output goes to ./dist with the shape `mentra-miniapp release` expects.
 */

import {rm} from "fs/promises"
import {existsSync, readFileSync} from "fs"
import os from "os"
import {reactSingletonPlugin} from "@mentra/miniapp-cli/build-helpers"

// Common Bench runs on this computer. The phone reaches it at this machine's network address (the same one the
// dev server's QR code uses), and shows it the key Common Bench made (app/recordings/.key, written when its
// server first starts). Set MENTRA_PUBLIC_BENCH_URL in .env to point somewhere else.
const lanIp = (): string | null => {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) if (i.family === "IPv4" && !i.internal) return i.address
  }
  return null
}
const keyFile = new URL("../app/recordings/.key", import.meta.url).pathname
process.env.MENTRA_PUBLIC_BENCH_URL ??= `http://${lanIp() ?? "localhost"}:8787`
process.env.MENTRA_PUBLIC_BENCH_KEY ??= existsSync(keyFile) ? readFileSync(keyFile, "utf8").trim() : ""
if (!process.env.MENTRA_PUBLIC_BENCH_KEY) {
  console.warn("No bench key yet: start Common Bench once (npm run dev in ../app), then save any file here to rebuild.")
}

const distDir = "./dist"

// Wipe dist/ so old chunks don't accumulate across builds.
await rm(distDir, {recursive: true, force: true})

// Pick up MENTRA_PUBLIC_* env vars from the shell / .env. Bun loads .env
// from cwd automatically; we just need to forward the keys to define.
const define: Record<string, string> = {}
for (const [k, v] of Object.entries(process.env)) {
  if (k.startsWith("MENTRA_PUBLIC_") && typeof v === "string") {
    define[`process.env.${k}`] = JSON.stringify(v)
  }
}

const backgroundResult = await Bun.build({
  entrypoints: ["./src/background/index.ts"],
  outdir: `${distDir}/background`,
  target: "browser",
  format: "iife",
  minify: false,
  define,
})

if (!backgroundResult.success) {
  console.error("Background build failed:")
  for (const log of backgroundResult.logs) console.error(log)
  process.exit(1)
}

const uiResult = await Bun.build({
  entrypoints: ["./src/ui/index.html"],
  outdir: `${distDir}/ui`,
  target: "browser",
  plugins: [reactSingletonPlugin(import.meta.url)],
  minify: true,
  define,
})

if (!uiResult.success) {
  console.error("UI build failed:")
  for (const log of uiResult.logs) console.error(log)
  process.exit(1)
}

// Silence on success — the dev-server's `reload →` line is the
// developer-facing confirmation. Failures already print via the
// .success branches above.
