// Scene 6: every write is an approval card. Nothing changes until a person approves it.
import type { DraftTrial, LedgerChange, Proposal } from "../shared/types.ts";
import { inkOf, landscape, notebook, personById } from "../data/notebook.ts";
import { estimateRecipe } from "../shared/surrogate.ts";
import { METRICS, fmtMetric, passes } from "../lib/metrics.ts";
import { pct, trim } from "../lib/format.ts";
import { useStore } from "../state/store.tsx";
import { Avatar, Cite, PersonName } from "./bits.tsx";

// Arms often share a basis ("fitted to 14 trials") and one adds detail; show the most specific once.
const basisNote = (bases: string[]) => {
  const uniq = [...new Set(bases.map((b) => b.trim()).filter(Boolean))];
  const kept = uniq.filter((b) => !uniq.some((o) => o !== b && o.includes(b)));
  return kept.map((b) => b.charAt(0).toUpperCase() + b.slice(1).replace(/\.?$/, ".")).join(" ");
};

const APPROVER = "shreya" as const;

function Decision({ proposal }: { proposal: Proposal<unknown> }) {
  const { decide } = useStore();
  if (proposal.status === "pending") {
    return (
      <div className="actions">
        <button className="btn primary" onClick={() => decide(proposal.id, "approve")}>
          Approve as {personById(APPROVER).name.split(" ")[0]}
        </button>
        <button className="btn" onClick={() => decide(proposal.id, "reject")}>Reject</button>
      </div>
    );
  }
  return (
    <div className="decided">
      <Avatar id={APPROVER} size="sm" />
      {proposal.status === "approved" ? <span><span className="check">✓</span> Approved by <PersonName id={APPROVER} /></span> : <span>Rejected by <PersonName id={APPROVER} /></span>}
    </div>
  );
}

export function LedgerApproval({ proposal }: { proposal: Proposal<LedgerChange[]> }) {
  const { state } = useStore();
  return (
    <div className={`approval ${proposal.status}`}>
      <div className="ah"><span className="at">Findings</span></div>
      {proposal.payload.map((c, i) => {
        if (c.op === "update") {
          const before = notebook.ledger.find((l) => l.id === c.id) ?? state.ledger.find((l) => l.id === c.id);
          const why = (c.patch.status_note ?? "").replace(/^reason disputed:\s*/i, "").replace(/\s*\(see[^)]*\)/i, "");
          return (
            <div className="change" key={i}>
              <div className="ch">
                {before && <PersonName id={before.owner} />}
                <span className="muted">{before ? before.kind.replace("_", " ") : ""}</span>
                <span className="q">“{before?.text.replace(/^Dead end:\s*/i, "")}”</span>
              </div>
              {c.patch.status && (
                <div className="ch to">
                  <span className="arrow">→</span>
                  <span className={`status ${c.patch.status}`}>{c.patch.status}</span>
                  {why && <span>{why}</span>}
                </div>
              )}
            </div>
          );
        }
        const it = c.item;
        return (
          <div className="change" key={i}>
            <div className="ch">
              <span className="status new">new</span>
              <PersonName id={it.owner} />
              <span className="muted">{it.kind.replace("_", " ")}</span>
              {it.pending_on && <span className="muted">· pending {it.pending_on}</span>}
            </div>
            <div className="q">“{it.text}”</div>
          </div>
        );
      })}
      <Decision proposal={proposal} />
    </div>
  );
}

export function DraftApproval({ proposal }: { proposal: Proposal<DraftTrial> }) {
  const d = proposal.payload;
  return (
    <div className={`approval ${proposal.status}`}>
      <div className="ah">
        <span className="at">Draft <span className="mono">{d.id}</span></span>
        {d.nothing_to_order && <span className="badge-order">Nothing to order</span>}
      </div>
      <table className="arms">
        <thead>
          <tr>
            <th />
            <th>Degas</th>
            {METRICS.slice(0, 3).map((m) => <th key={m.key} style={{ textAlign: "right" }}>{m.label}</th>)}
            <th style={{ textAlign: "right" }}>Pass chance</th>
          </tr>
        </thead>
        <tbody>
          {d.arms.map((a) => {
            const e = estimateRecipe(landscape.models, a.recipe);
            return (
              <tr key={a.id}>
                <td><span className="mono" style={{ fontWeight: 700, color: inkOf(d.owner) }}>{a.id}</span> <span className="muted">{a.role === "control" ? "control" : ""}</span></td>
                <td>{a.recipe.degas_min ? `${a.recipe.degas_min} min` : "none"}</td>
                {METRICS.slice(0, 3).map((m) => {
                  const v = e[m.key as keyof typeof e] as number;
                  return <td key={m.key} className={passes(m, v) ? "" : "bad"} style={{ textAlign: "right" }}>{fmtMetric(m, v)}</td>;
                })}
                <td style={{ textAlign: "right" }}>{pct(e.p_pass)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="est-note">
        <span className="tag est">estimate</span> {d.arms[0] ? `${trim(d.arms[0].recipe.diluent_wt)}% diluent, ${trim(d.arms[0].recipe.photoinit_wt)}% photoinitiator. ` : ""}
        Fitted to the trials in code, not written by the model.
      </div>
      <Decision proposal={proposal} />
    </div>
  );
}
