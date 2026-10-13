// Citation tokens in answer text: [T08], [T09-L07], [L2], [T15a], or comma lists like [T08, T13].
import type { Citation } from "../shared/types.ts";

const ID = String.raw`(?:T\d{2}[a-z]?(?:-L\d{2})?|L\d+)`;
const TOKEN = new RegExp(String.raw`\[(${ID}(?:\s*,\s*${ID})*)\]`, "g");

export type Segment = { kind: "text"; text: string } | { kind: "cite"; ids: string[] };

export function tokenize(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ kind: "text", text: text.slice(last, i) });
    out.push({ kind: "cite", ids: m[1].split(",").map((s) => s.trim()) });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

export function citationKind(id: string): Citation["kind"] {
  if (/^L\d+$/.test(id)) return "ledger";
  if (/-L\d{2}$/.test(id)) return "log";
  return "trial";
}
