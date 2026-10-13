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
      <h3 className="ev-h">Stress test · {stress.sizes.map((s) => s.toLocaleString()).join(" / ")} trials</h3>
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
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>One run per question · total spend ${stress.spend_usd.toFixed(2)}</div>
    </section>
  );
}
