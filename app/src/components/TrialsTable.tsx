// The scorecard: every trial, its overall state, and each check tinted pass / not yet / fail.
// Clicking a check's header puts it in focus on the chart. Hover links to the chart; click opens the trial.
import { useState } from "react";
import { inkOf, personById } from "../data/notebook.ts";
import { fmtDate } from "../lib/format.ts";
import { METRICS, STATUS_LABEL, checkStatus, fmtMetric, guardrailFails, statusOf, type Row } from "../lib/metrics.ts";
import { useHighlight } from "../lib/rows.ts";
import { useStore } from "../state/store.tsx";
import { Avatar } from "./bits.tsx";

const ICON = { goal: "✓", close: "○", fail: "✕" } as const;
const SHORT: Record<string, string> = { viscosity_pa_s: "Viscosity", uts_mpa: "Tensile", flex_strength_mpa: "Bend", porosity_pct: "Bubbles", viability_pct: "Cells alive" };

export function TrialsTable({ rows }: { rows: Row[] }) {
  const { state, dispatch } = useStore();
  const hl = useHighlight();
  const [sort, setSort] = useState<{ k: "date" | "owner"; dir: 1 | -1 }>({ k: "date", dir: 1 });
  const sorted = [...rows].sort((a, b) => {
    const va = sort.k === "date" ? a.date + a.id : a.owner + a.date + a.id;
    const vb = sort.k === "date" ? b.date + b.id : b.owner + b.date + b.id;
    return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
  });
  const sortTh = (k: "date" | "owner", label: string) => (
    <th aria-sort={sort.k === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button onClick={() => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : 1 }))}>
        {label}{sort.k === k ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );

  return (
    <div className="table-wrap">
      <table className="trials">
        <thead>
          <tr>
            <th>Trial</th>
            {sortTh("owner", "Who")}
            {sortTh("date", "Date")}
            <th>Status</th>
            <th className="num">Diluent %</th>
            <th className="num">Photoinit. %</th>
            {METRICS.map((m) => (
              <th key={m.key} className={`num metric ${state.metric === m.key ? "focus" : ""}`}>
                <button onClick={() => dispatch({ type: "metric", key: m.key })} title={`Show ${m.label.toLowerCase()} on the chart`}>{SHORT[m.key]}</button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody onMouseLeave={() => dispatch({ type: "hover", id: null })}>
          {sorted.map((r) => {
            const excluded = !!r.trial?.excluded;
            const est = !!r.arm;
            const st = statusOf(r);
            const nFail = guardrailFails(r).length;
            return (
              <tr key={r.id} className={`${r.id === hl ? "on" : ""} ${est ? "est" : ""}`}
                onMouseEnter={() => dispatch({ type: "hover", id: r.id })} onMouseLeave={() => dispatch({ type: "hover", id: null })}
                onClick={() => r.trial && dispatch({ type: "select", sel: { trial: r.trial.id } })}>
                <td className="id">
                  <span className="mono">{r.id}</span>
                  {excluded && <span className="tag">excluded</span>}
                  {est && <span className="tag est">estimate</span>}
                </td>
                <td><span className="who"><Avatar id={r.owner} size="sm" /> <span style={{ color: inkOf(r.owner) }}>{personById(r.owner).name.split(" ")[0]}</span></span></td>
                <td className="muted">{est ? "draft" : fmtDate(r.date)}</td>
                <td><span className={`st ${st}`}>{ICON[st]} {st === "fail" ? `${STATUS_LABEL.fail} ${nFail}` : STATUS_LABEL[st]}</span></td>
                <td className="num">{r.diluent}</td>
                <td className="num">{r.photoinit}</td>
                {METRICS.map((m) => {
                  const v = r.values[m.key];
                  const cs = checkStatus(m, v);
                  return <td key={m.key} className={`num cell ${cs} ${state.metric === m.key ? "focus" : ""}`}>{fmtMetric(m, v)}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
