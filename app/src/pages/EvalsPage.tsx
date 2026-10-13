// Scene 7: one table, rendered from evals/results.json (written by the Eval agent's runner).
// Loaded with import.meta.glob so a missing file shows a placeholder instead of breaking the build.
import type { EvalConfigResult, EvalResults } from "../shared/types.ts";
import { fmtDate } from "../lib/format.ts";
import { navigate } from "../lib/hooks.ts";
import { StressSection } from "./StressSection.tsx";

const found = import.meta.glob("../../evals/results.json", { eager: true, import: "default" }) as Record<string, EvalResults>;
const results: EvalResults | null = Object.values(found)[0] ?? null;

type Col = {
  key: keyof EvalConfigResult;
  label: string;
  better: "high" | "low" | null;
  fmt: (r: EvalConfigResult) => string;
  bar?: boolean;
};

const pct = (v: number) => `${Math.round(v * 100)}%`;
const COLS: Col[] = [
  { key: "accuracy", label: "Accuracy", better: "high", fmt: (r) => pct(r.accuracy), bar: true },
  { key: "citation_validity", label: "Citation validity", better: "high", fmt: (r) => pct(r.citation_validity), bar: true },
  { key: "abstention", label: "Abstention", better: "high", fmt: (r) => pct(r.abstention), bar: true },
  { key: "wrong_numbers", label: "Wrong numbers", better: "low", fmt: (r) => String(r.wrong_numbers) },
  { key: "hero_pass", label: "Hero answer", better: null, fmt: (r) => (r.hero_pass ? "✓ pass" : "✗ miss") },
  { key: "cost_per_q_usd", label: "Cost / question", better: "low", fmt: (r) => `$${r.cost_per_q_usd.toFixed(3)}` },
  { key: "p50_latency_s", label: "p50 latency", better: "low", fmt: (r) => `${r.p50_latency_s.toFixed(1)} s` },
];

function bestOf(rows: EvalConfigResult[], c: Col): number | null {
  if (!c.better || rows.length < 2) return null;
  const vals = rows.map((r) => Number(r[c.key]));
  return c.better === "high" ? Math.max(...vals) : Math.min(...vals);
}

export function EvalsPage() {
  return (
    <div className="evals">
      <div className="evals-inner">
        <button className="navlink" style={{ paddingLeft: 0 }} onClick={() => navigate("/")}>← Back to the project</button>
        <h2 style={{ marginTop: 10 }}>Evals</h2>

        <h3 className="ev-h">Demo notebook · 14 trials</h3>
        {results ? <ResultsTable r={results} /> : <div className="placeholder">Eval not run yet.</div>}

        <StressSection />

        <h3 className="ev-h">Method</h3>
        <ul className="method">
          <li><b>Three setups, same answer rules:</b> A, the whole notebook in context (Sonnet); B, an agent reading it through tools (Sonnet); C, the same agent on Haiku.</li>
          <li><b>Questions come from code:</b> every expected answer is computed from the seeded data. They cover lookups, aggregations, log timing, multi-step chains, contradictions, and questions the notebook can't answer.</li>
          <li><b>Graded in code:</b> cited IDs must exist, numbers must match the data within tolerance, and it must decline when the notebook doesn't say. The demo question must name the degassing confound and T09, and propose a control arm.</li>
          <li><b>Stress test:</b> seeded notebooks of 50, 250 and 1,000 trials with planted needles, lookalikes and traps. Scored on the same core questions in every cell.</li>
          <li>One run per question. Cost from the API usage at published prices.</li>
        </ul>
      </div>
    </div>
  );
}

function ResultsTable({ r }: { r: EvalResults }) {
  return (
    <>
      <div className="panel" style={{ overflowX: "auto" }}>
        <table className="etable">
          <thead>
            <tr>
              <th>Configuration</th>
              <th>Model</th>
              <th>Questions</th>
              {COLS.map((c) => <th key={c.key}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {r.configs.map((row) => (
              <tr key={row.id}>
                <td className="cfg"><span className="mono" style={{ color: "var(--ink-3)", marginRight: 6 }}>{row.id}</span>{row.label}</td>
                <td className="mono" style={{ textAlign: "right", color: "var(--ink-2)" }}>{row.model}</td>
                <td>{row.n}</td>
                {COLS.map((c) => {
                  const best = bestOf(r.configs, c);
                  const v = Number(row[c.key]);
                  return (
                    <td key={c.key} className={best !== null && v === best ? "best" : ""}>
                      {c.fmt(row)}
                      {c.bar && (
                        <span className="bar-track"><span className="bar" style={{ width: `${Math.round(v * 100)}%` }} /></span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="evals notes" style={{ padding: 0, overflow: "visible" }}>
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          {r.question_count} questions · run {fmtDate(r.generated_at)} · bold = best in column
        </div>
      </div>
    </>
  );
}
