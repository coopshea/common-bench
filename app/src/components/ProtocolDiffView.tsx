// Scene 5: two trials aligned by pipeline step. Intended differences are neutral; unintended ones are amber.
// Identical steps fold away so the one unintended difference is the first thing you read.
import { useState } from "react";
import type { DiffRow, ProtocolDiff } from "../shared/types.ts";
import { inkOf, personById, project, trialById } from "../data/notebook.ts";
import { trim } from "../lib/format.ts";
import { restGap } from "../lib/derive.ts";
import { Cite } from "./bits.tsx";

const stepLabel = (id: string) => project.sop.stations.find((s) => s.id === id)?.label ?? id;
const ORDER: DiffRow["kind"][] = ["unintended", "intended", "same"];

function fmt(v: DiffRow["a"]) {
  if (v === null || v === undefined) return <span className="absent">not done</span>;
  return typeof v === "number" ? trim(v) : v;
}

function Row({ r }: { r: DiffRow }) {
  return (
    <tr className={r.kind}>
      <td className="step">{stepLabel(r.step)}</td>
      <td>
        {r.label}
        {r.kind === "unintended" && r.log_ids && r.log_ids.length > 0 && (
          <div className="row-cites">{r.log_ids.map((id) => <Cite key={id} id={id} />)}</div>
        )}
      </td>
      <td className="val">{fmt(r.a)}</td>
      <td className="val">{fmt(r.b)}</td>
      <td className="kind-cell">{r.kind !== "same" && <span className={`dk ${r.kind}`}>{r.kind}</span>}</td>
    </tr>
  );
}

export function ProtocolDiffView({ diff }: { diff: ProtocolDiff }) {
  const [showSame, setShowSame] = useState(false);
  const ta = trialById(diff.a);
  const tb = trialById(diff.b);
  const pa = ta ? personById(ta.owners[0]) : null;
  const pb = tb ? personById(tb.owners[0]) : null;
  const rows = [...diff.rows].sort((x, y) => ORDER.indexOf(x.kind) - ORDER.indexOf(y.kind));
  const changed = rows.filter((r) => r.kind !== "same");
  const same = rows.filter((r) => r.kind === "same");
  const unintended = changed.filter((r) => r.kind === "unintended").length;
  const sameSteps = [...new Set(same.map((r) => stepLabel(r.step).toLowerCase()))].join(", ");
  return (
    <div className="diff">
      <table>
        <thead>
          <tr>
            <th style={{ width: 74 }}>Step</th>
            <th>What</th>
            <th className="who">
              <span className="mono" style={{ color: pa ? inkOf(pa.id) : undefined }}>{diff.a}</span> <span style={{ color: pa ? inkOf(pa.id) : undefined }}>{pa ? pa.name.split(" ")[0] : ""}</span>
            </th>
            <th className="who">
              <span className="mono" style={{ color: pb ? inkOf(pb.id) : undefined }}>{diff.b}</span> <span style={{ color: pb ? inkOf(pb.id) : undefined }}>{pb ? pb.name.split(" ")[0] : ""}</span>
            </th>
            <th style={{ width: 86 }} />
          </tr>
        </thead>
        <tbody>
          {changed.map((r) => <Row key={`${r.step}-${r.field}`} r={r} />)}
          {showSame && same.map((r) => <Row key={`${r.step}-${r.field}`} r={r} />)}
          {same.length > 0 && (
            <tr className="same-toggle">
              <td colSpan={5}>
                <button className="linkbtn" onClick={() => setShowSame((v) => !v)} aria-expanded={showSame}>
                  {showSame ? "Hide identical rows" : `${same.length} identical rows: ${sameSteps}`}
                </button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {diff.related.map((rel) => {
        const t = trialById(rel.trial);
        const gap = t ? restGap(t) : null;
        return (
          <div className="related" key={rel.trial}>
            <span className="facts">
              <Cite id={rel.trial} />
              <span>same recipe as <Cite id={diff.a} /></span>
              {gap && gap.hours > 2 && <span><b>{gap.hours.toFixed(1)} h</b> between mixing and printing</span>}
              {t && <span>{t.pass_all ? "passed every check" : "failed a check"}</span>}
              {t?.excluded && <span>excluded</span>}
              {rel.log_ids.map((id) => <Cite key={id} id={id} />)}
            </span>
          </div>
        );
      })}
      <div className="sr-only" aria-live="polite">{unintended} unintended difference(s)</div>
    </div>
  );
}
