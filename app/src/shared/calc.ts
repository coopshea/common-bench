// The protocol's calculator: arithmetic over named values ("batch_g * diluent_pct / 100").
// A tiny recursive-descent parser, no eval. Shared by the generator (checks) and the app (live recalculation).

export type Scope = Record<string, number>;

/** Evaluate one formula. Throws on a syntax error or an unknown name. */
export function evaluate(formula: string, scope: Scope): number {
  const toks = formula.match(/\d*\.\d+|\d+|[A-Za-z_]\w*|[-+*/^()]/g) ?? [];
  if (toks.join("") !== formula.replace(/\s+/g, "")) throw new Error("Unexpected character");
  let i = 0;
  const peek = () => toks[i];
  const take = (t?: string) => {
    if (t && toks[i] !== t) throw new Error(`Expected ${t}`);
    return toks[i++];
  };
  const atom = (): number => {
    const t = take();
    if (t === undefined) throw new Error("Unexpected end");
    if (t === "(") { const v = sum(); take(")"); return v; }
    if (t === "-") return -atom();
    if (/^[\d.]/.test(t)) return Number(t);
    if (t in scope) return scope[t];
    throw new Error(`Unknown name ${t}`);
  };
  const power = (): number => { const b = atom(); return peek() === "^" ? (take(), b ** power()) : b; };
  const product = (): number => {
    let v = power();
    while (peek() === "*" || peek() === "/") v = take() === "*" ? v * power() : v / power();
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (peek() === "+" || peek() === "-") v = take() === "+" ? v + product() : v - product();
    return v;
  };
  const v = sum();
  if (i < toks.length) throw new Error(`Unexpected ${toks[i]}`);
  return v;
}

/** Evaluate every formula in order; later formulas can use earlier ids. Bad formulas come back as errors. */
export function evaluateAll(formulas: { id: string; formula: string }[], scope: Scope): { values: Scope; errors: Record<string, string> } {
  const values: Scope = { ...scope };
  const errors: Record<string, string> = {};
  for (const f of formulas) {
    try { values[f.id] = evaluate(f.formula, values); } catch (e) { errors[f.id] = (e as Error).message; }
  }
  return { values, errors };
}

// ---------- Typesetting: formula → LaTeX, so math reads as math (fractions, ×, −), not one line of code ----------

type Node = { k: "num"; v: string } | { k: "name"; v: string } | { k: "neg"; a: Node } | { k: "bin"; op: string; a: Node; b: Node };

/** Parse a formula into a tree (same grammar as evaluate). Throws on a syntax error. */
export function parse(formula: string): Node {
  const toks = formula.match(/\d*\.\d+|\d+|[A-Za-z_]\w*|[-+*/^()]/g) ?? [];
  let i = 0;
  const peek = () => toks[i];
  const atom = (): Node => {
    const t = toks[i++];
    if (t === undefined) throw new Error("Unexpected end");
    if (t === "(") { const v = sum(); if (toks[i++] !== ")") throw new Error("Expected )"); return v; }
    if (t === "-") return { k: "neg", a: atom() };
    if (/^[\d.]/.test(t)) return { k: "num", v: t };
    if (/^[A-Za-z_]/.test(t)) return { k: "name", v: t };
    throw new Error(`Unexpected ${t}`);
  };
  const power = (): Node => { const a = atom(); return peek() === "^" ? (i++, { k: "bin", op: "^", a, b: power() }) : a; };
  const product = (): Node => { let a = power(); while (peek() === "*" || peek() === "/") { const op = toks[i++]; a = { k: "bin", op, a, b: power() }; } return a; };
  const sum = (): Node => { let a = product(); while (peek() === "+" || peek() === "-") { const op = toks[i++]; a = { k: "bin", op, a, b: product() }; } return a; };
  const n = sum();
  if (i < toks.length) throw new Error(`Unexpected ${toks[i]}`);
  return n;
}

const isSum = (n: Node) => n.k === "bin" && (n.op === "+" || n.op === "-");
const paren = (s: string) => `\\left(${s}\\right)`;

/** A formula as LaTeX. `name` renders each variable: its label, its value, or a blank to write in. */
export function toTex(formula: string, name: (id: string) => string): string {
  const go = (n: Node): string => {
    switch (n.k) {
      case "num": return n.v;
      case "name": return name(n.v);
      case "neg": return `-${isSum(n.a) ? paren(go(n.a)) : go(n.a)}`;
      case "bin": {
        if (n.op === "/") return `\\dfrac{${go(n.a)}}{${go(n.b)}}`;
        if (n.op === "^") return `{${n.a.k === "bin" ? paren(go(n.a)) : go(n.a)}}^{${go(n.b)}}`;
        if (n.op === "*") return `${isSum(n.a) ? paren(go(n.a)) : go(n.a)} \\times ${isSum(n.b) ? paren(go(n.b)) : go(n.b)}`;
        const b = n.op === "-" && isSum(n.b) ? paren(go(n.b)) : go(n.b);
        return `${go(n.a)} ${n.op === "-" ? "-" : "+"} ${b}`;
      }
    }
  };
  return go(parse(formula));
}

/** True when the formula is just one variable (a setting copied straight through): no math to show. */
export const isPlain = (formula: string) => /^\s*[A-Za-z_]\w*\s*$/.test(formula);
