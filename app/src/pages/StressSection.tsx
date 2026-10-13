// The stress eval: where each setup breaks as the notebook grows (evals/stress/results.json).
// Scores are on the same core questions in every cell, so cells compare directly.

interface Cell {
  size: number;
  config: "A" | "B" | "C";
  status: "ran" | "doesnt_fit" | "skipped_cost" | "not_run";
  context_tokens?: number;
  core: { n: number; correct: number };
  wrong_answers: number;
  declined: number;
  cost_per_q_usd: number;
}
interface StressResults {
  sizes: number[];
  configs: { id: "A" | "B" | "C"; label: string }[];
  cells: Cell[];
  spend_usd: number;
}

const found = import.meta.glob("../../evals/stress/results.json", { eager: true, import: "default" }) as Record<string, StressResults>;
const stress: StressResults | null = Object.values(found)[0] ?? null;

const tone = (c: Cell) => {
  if (c.status !== "ran" || !c.core.n) return "na";
  const f = c.core.correct / c.core.n;
  return f >= 0.9 ? "good" : f >= 0.7 ? "mid" : "bad";
};

export function StressSection() {
  if (!stress) return null;
  const cell = (size: number, cfg: string) => stress.cells.find((c) => c.size === size && c.config === cfg);
  return (
    <section className="stress">
      <div className="eyebrow" style={{ marginTop: 28 }}>Stress test</div>
      <h2>Where it breaks as the notebook grows</h2>
      <p className="lede">
        Seeded notebooks of {stress.sizes.join(", ")} trials with planted needles, lookalikes, multi-step questions and traps.
        Same core questions in every cell.
      </p>
      <div className="panel" style={{ overflowX: "auto" }}>
        <table className="stress-grid">
          <thead>
            <tr><th>Trials</th>{stress.configs.map((c) => <th key={c.id}><span className="mono">{c.id}</span> {c.label}</th>)}</tr>
          </thead>
          <tbody>
            {stress.sizes.map((s) => (
              <tr key={s}>
                <td className="size">{s.toLocaleString()}</td>
                {stress.configs.map((cfg) => {
                  const c = cell(s, cfg.id);
                  if (!c) return <td key={cfg.id} className="na">–</td>;
                  if (c.status === "doesnt_fit")
                    return <td key={cfg.id} className="na"><b>Doesn't fit</b><div className="sub">{((c.context_tokens ?? 0) / 1e6).toFixed(2)}M tokens</div></td>;
                  return (
                    <td key={cfg.id} className={tone(c)}>
                      <b>{c.core.correct}/{c.core.n}</b>
                      <div className="sub">${c.cost_per_q_usd.toFixed(3)}/q{c.wrong_answers ? ` · ${c.wrong_answers} wrong` : ""}{c.declined ? ` · ${c.declined} declined` : ""}</div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="stress-notes">
        <li><b>Long context is perfect until it doesn't fit.</b> Then it can't answer at all.</li>
        <li><b>The tools, not the model, limit the agents.</b> Search results too large to return, filters frozen to the demo's people, logs that need one call per trial. Sonnet did no better than Haiku.</li>
        <li><b>They fail safely.</b> Most misses say "can't answer" rather than guess. The fixes are in the roadmap: exhaustive scan and aggregate tools.</li>
      </ul>
      <div className="muted" style={{ fontSize: 12 }}>One run per question · total spend ${stress.spend_usd.toFixed(2)}</div>
    </section>
  );
}
