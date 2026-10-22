// tokens.json (the design system's tokens, same file as the Design System artifact) → tokens.css. Run: npm run tokens
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Themed = string | { light: string; dark?: string };
interface Tok { name: string; value: Themed }
interface Style { name: string; family?: string; fontSize: string; lineHeight: string; fontWeight: number; letterSpacing?: string }
interface Tokens {
  color: { tokens: Tok[] };
  shadow: { tokens: Tok[] };
  spacing: { tokens: Tok[] };
  radius: { tokens: Tok[] };
  type: { families: Record<string, string>; groups: { family: string; styles: Style[] }[] };
}

const here = dirname(fileURLToPath(import.meta.url));
const t: Tokens = JSON.parse(readFileSync(join(here, "tokens.json"), "utf8"));
const light = (v: Themed) => (typeof v === "string" ? v : v.light);
const dark = (v: Themed) => (typeof v === "string" ? undefined : v.dark !== v.light ? v.dark : undefined);

const out = ["/* Common Bench — generated from tokens.json (the design system). Regenerate: npm run tokens */", ":root {"];
for (const c of [...t.color.tokens, ...t.shadow.tokens]) out.push(`  --${c.name}: ${light(c.value)};`);
for (const c of [...t.spacing.tokens, ...t.radius.tokens]) out.push(`  --${c.name}: ${light(c.value)};`);
for (const [k, v] of Object.entries(t.type.families)) out.push(`  --font-${k}: ${v};`);
out.push("}", "/* Dark is opt-in (data-theme) until every legacy panel reads tokens instead of literals. */", '[data-theme="dark"] {');
for (const c of [...t.color.tokens, ...t.shadow.tokens]) {
  const d = dark(c.value);
  if (d) out.push(`  --${c.name}: ${d};`);
}
out.push("  color-scheme: dark;", "}");
for (const g of t.type.groups) {
  for (const s of g.styles) {
    const parts = [`font-family: var(--font-${s.family ?? g.family})`, `font-size: ${s.fontSize}`, `line-height: ${s.lineHeight}`, `font-weight: ${s.fontWeight}`];
    if (s.letterSpacing) parts.push(`letter-spacing: ${s.letterSpacing}`);
    if (s.name === "eyebrow") parts.push("color: var(--ink-3)");
    out.push(`.t-${s.name} { ${parts.join("; ")}; }`);
  }
}
writeFileSync(join(here, "tokens.css"), out.join("\n") + "\n");
console.log(`tokens.css: ${t.color.tokens.length} colors, ${t.spacing.tokens.length + t.radius.tokens.length} lengths`);
