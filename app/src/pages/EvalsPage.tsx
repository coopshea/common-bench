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
        <div className="eyebrow" style={{ marginTop: 10 }}>Under the hood</div>
        <h2>What reading the notebook through tools buys</h2>
        <p className="lede">
          {results?.question_count ?? ""} questions, three setups, same rules. Graded in code: cited IDs exist, numbers match the data,
          it declines when the notebook doesn't say, and the hero answer names the degassing confound and T09.
        </p>
        {results && <Takeaways r={results} />}
        {results ? <ResultsTable r={results} /> : (
          <div className="placeholder">
            <div style={{ fontWeight: 650, color: "var(--ink-2)", marginBottom: 4 }}>Eval not run yet</div>
            The table appears here when <span className="mono">evals/results.json</span> exists.
          </div>
        )}
        <StressSection />
      </div>
    </div>
  );
}

// Three findings, computed from the results so they can't drift from the table.
function Takeaways({ r }: { r: EvalResults }) {
  const ran = r.configs.filter((c) => c.n > 0);
  const A = ran.find((c) => c.id === "A");
  if (!A || ran.length < 2) return null;
  const accs = ran.map((c) => c.accuracy);
  const sameAcc = Math.max(...accs) - Math.min(...accs) < 0.005;
  const best = ran.filter((c) => c.accuracy === Math.max(...accs)).sort((a, b) => a.cost_per_q_usd - b.cost_per_q_usd)[0];
  const priciest = Math.max(...ran.map((c) => c.cost_per_q_usd));
  const tiles = [
    {
      k: "Accuracy",
      v: sameAcc ? `All ${pct(A.accuracy)}` : `${pct(Math.min(...accs))}–${pct(Math.max(...accs))}`,
      d: sameAcc
        ? "At 14 trials the whole notebook fits in context, so every setup gets the answers right."
        : "Accuracy differs by setup; see the table.",
    },
    {
      k: "Cost",
      v: `${Math.round(priciest / best.cost_per_q_usd)}× cheaper`,
      d: `${best.label}: $${best.cost_per_q_usd.toFixed(4)} a question at ${pct(best.accuracy)} accuracy. Route lookups to the small model.`,
    },
    {
      k: "Why tools anyway",
      v: "It scales",
      d: "Numbers are computed in code and every citation comes from a tool result. Years of trials and live device logs won't fit in context.",
    },
  ];
  return (
    <div className="takeaways">
      {tiles.map((t) => (
        <div className="tile" key={t.k}>
          <div className="eyebrow">{t.k}</div>
          <div className="tv">{t.v}</div>
          <div className="td">{t.d}</div>
        </div>
      ))}
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
        <div className="muted" style={{ fontSize: 12 }}>
          {r.question_count} questions · run {fmtDate(r.generated_at)} · bold = best in column
        </div>
        {r.notes.length > 0 && (
          <ul style={{ paddingLeft: 18, marginTop: 8 }}>
            {r.notes.slice(0, 3).map((n, i) => <li key={i} style={{ marginBottom: 3 }}>{n}</li>)}
          </ul>
        )}
        {r.notes.length > 3 && (
          <details style={{ marginTop: 6 }}>
            <summary style={{ cursor: "pointer", color: "var(--ink-2)" }}>More notes from the run ({r.notes.length - 3})</summary>
            <ul style={{ paddingLeft: 18, marginTop: 6 }}>
              {r.notes.slice(3).map((n, i) => <li key={i} style={{ marginBottom: 3 }}>{n}</li>)}
            </ul>
          </details>
        )}
        {r.per_question.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer", color: "var(--ink-2)" }}>Per question ({r.per_question.length} rows)</summary>
            <table className="etable" style={{ marginTop: 8, fontSize: 12 }}>
              <thead>
                <tr><th>Question</th><th>Config</th><th>Correct</th><th>Citations valid</th><th>Abstained</th><th>Cost</th><th>Latency</th><th style={{ textAlign: "left" }}>Notes</th></tr>
              </thead>
              <tbody>
                {r.per_question.map((q, i) => (
                  <tr key={i}>
                    <td className="mono">{q.qid}</td>
                    <td>{q.config}</td>
                    <td>{q.correct ? "✓" : "✗"}</td>
                    <td>{q.citations_valid ? "✓" : "✗"}</td>
                    <td>{q.abstained ? "yes" : ""}</td>
                    <td>${q.cost_usd.toFixed(3)}</td>
                    <td>{q.latency_s.toFixed(1)} s</td>
                    <td style={{ textAlign: "left", color: "var(--ink-2)" }}>{q.notes ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </div>
    </>
  );
}
