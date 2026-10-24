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
