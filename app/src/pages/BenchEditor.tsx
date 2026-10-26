// The SOP editor: the protocol as a block document (type / for a Step, Amount or Setting), and on the right the same
// Ask as every panel: type or say an edit, approve the change card, and it becomes a version with its author.
// Done saves typed edits as a version too. Every change converts back to the protocol, so View, Print and Run read it at once.
import { useMemo, useRef, useState } from "react";
import { SuggestionMenuController, useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import type { BenchProtocol } from "../shared/types.ts";
import { evaluateAll } from "../shared/calc.ts";
import { personById } from "../data/notebook.ts";
import { ME } from "../lib/org.ts";
import { useGo } from "../lib/nav.tsx";
import { useBench, lastVersion, type SopVersion } from "../lib/benchRun.ts";
import { diffProtocols, parseSopEdit } from "../lib/sopEdit.ts";
import { listenOnce, speechAvailable } from "../lib/benchSpeech.ts";
import { AskBox, Avatar } from "../ds/index.tsx";
import { SopScope, fromBlocks, sopSchema, sopSlashItems, toBlocks } from "./sopBlocks.tsx";

const scopeOf = (p: BenchProtocol) => {
  const defaults = Object.fromEntries(p.params.map((x) => [x.id, x.value]));
  const r = evaluateAll(p.steps.flatMap((s) => s.fields), defaults);
  const labels = Object.fromEntries([...p.params.map((x) => [x.id, x.label]), ...p.steps.flatMap((s) => s.fields.map((f) => [f.id, f.label]))]);
  return { values: r.values, errors: r.errors, labels };
};
const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

const Author = ({ v }: { v: SopVersion }) => (
  <span className="ver-who">
    {v.by === "claude" ? <span className="cb-av sm claude">C</span> : <Avatar id={v.by} size="sm" />}
    {v.approvedBy && <span className="muted">✓ {personById(v.approvedBy).name.split(" ")[0]}</span>}
  </span>
);

export function BenchEditor({ base }: { base: BenchProtocol }) {
  const go = useGo();
  const { proto, sop, editSop, commit } = useBench(base);
  const start = useRef(proto).current;
  const editor = useCreateBlockNote({ schema: sopSchema, initialContent: toBlocks(start) });
  const [draft, setDraft] = useState(start);
  const scope = useMemo(() => scopeOf(draft), [draft]);
  const [proposal, setProposal] = useState<{ ask: string; next: BenchProtocol } | null>(null);
  const [miss, setMiss] = useState(false);
  const [listening, setListening] = useState(false);
  const current = lastVersion(sop);
  const unsaved = diffProtocols(current.proto, draft).length > 0;

  const load = (p: BenchProtocol) => { editor.replaceBlocks(editor.document, toBlocks(p)); setDraft(p); editSop((x) => ({ ...x, proto: p })); };
  const ask = (q: string) => {
    const next = parseSopEdit(q, draft);
    setProposal(next && diffProtocols(draft, next).length ? { ask: q, next } : null);
    setMiss(!next);
  };
  const talk = () => {
    if (listening) return;
    setListening(true);
    listenOnce({ interim: () => {}, final: ask, error: () => {}, end: () => setListening(false) });
  };

  return (
    <div className="bench-edit">
      <div className="edit-bar">
        <span className="h3">Editing protocol · v{current.n}{unsaved && " + edits"}</span>
        <button className="cb-btn primary sm" onClick={() => { commit(draft, ME); go(`/sops/${base.id}`); }}>Done</button>
      </div>
      <div className="edit-grid">
        <div className="bench-doc edit">
          <header className="doc-head"><h1 className="h1">{base.title}</h1></header>
          <SopScope.Provider value={scope}>
            <BlockNoteView editor={editor} theme="light" slashMenu={false} className="sop-editor"
              onChange={() => { const p = fromBlocks(editor.document, base); setDraft(p); editSop((x) => ({ ...x, proto: p })); }}>
              <SuggestionMenuController triggerCharacter="/" getItems={async (q) => sopSlashItems(editor, q)} />
            </BlockNoteView>
          </SopScope.Provider>
        </div>

        <aside className="edit-side">
          <div className="edit-ask">
            <AskBox scope={base.title} placeholder="Set batch to 100…" onAsk={ask}
              suggestions={[{ label: "Preheat the oven first", question: "Add step Preheat oven before step 1" }, { label: "Batch 100 g", question: "Set batch to 100" }]} />
            {speechAvailable() && (
              <button className={`cb-round sm edit-mic ${listening ? "on" : ""}`} aria-label="Say an edit" onClick={talk}>
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
              </button>
            )}
          </div>

          {proposal && (
            <div className="approve" role="group" aria-label="Edit to approve">
              <span className="cb-label">“{proposal.ask}”</span>
              <ul className="ver-changes">{diffProtocols(draft, proposal.next).map((c) => <li key={c}>{c}</li>)}</ul>
              <div className="pn-row end">
                <button className="cb-btn ghost" onClick={() => setProposal(null)}>Cancel</button>
                <button className="cb-btn primary" onClick={() => { load(proposal.next); commit(proposal.next, "claude", ME); setProposal(null); }}>Approve</button>
              </div>
            </div>
          )}
          {miss && <p className="cb-label">Try “Set batch to 100” or “Add step Rinse after print”.</p>}

          <section className="versions">
            <h3 className="h3">Versions</h3>
            {[...sop.versions].reverse().map((v) => (
              <div key={v.n} className={`ver ${v.n === current.n ? "now" : ""}`}>
                <div className="ver-head">
                  <b className="mono">v{v.n}</b><Author v={v} /><span className="mono muted">{day(v.at)}</span>
                  {v.n !== current.n && <button className="cb-link" onClick={() => { load(v.proto); commit(v.proto, ME); }}>Restore</button>}
                </div>
                <ul className="ver-changes">{v.changes.slice(0, 4).map((c) => <li key={c}>{c}</li>)}{v.changes.length > 4 && <li>+{v.changes.length - 4} more</li>}</ul>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}
