// Small shared pieces: avatars, source badges, citation chips, cited text.
import type { LogSource, PersonId } from "../shared/types.ts";
import { colorOf, inkOf, logById, personById, trialById } from "../data/notebook.ts";
import { citationKind, tokenize } from "../lib/citations.ts";
import { useStore } from "../state/store.tsx";

export function Avatar({ id, size = "md", former }: { id: PersonId; size?: "sm" | "md"; former?: boolean }) {
  const p = personById(id);
  return (
    <span
      className={`avatar ${size === "sm" ? "sm" : ""} ${former ? "former" : ""}`}
      style={{ background: p.color }}
      title={`${p.name} · ${p.role}`}
    >
      {p.initials}
    </span>
  );
}

export function PersonName({ id }: { id: PersonId }) {
  const p = personById(id);
  return <span style={{ color: inkOf(id), fontWeight: 600 }}>{p.name}</span>;
}

const SRC_LABEL: Record<LogSource, string> = { mhs: "MHS", camera: "camera", manual: "manual" };
const SRC_TITLE: Record<LogSource, string> = {
  mhs: "Logs itself (MHS-style device driver)",
  camera: "Imaged by a camera",
  manual: "Written by hand: no data interface",
};

export function SourceBadge({ source }: { source: LogSource }) {
  return (
    <span className={`src-badge ${source}`} title={SRC_TITLE[source]}>
      {SRC_LABEL[source]}
    </span>
  );
}

/** A clickable citation chip. Trials focus the map; log ids open the trial's log; ledger ids flash the ledger. */
export function Cite({ id, mini }: { id: string; mini?: boolean }) {
  const { dispatch, state } = useStore();
  const kind = citationKind(id);
  const trialId = kind === "log" ? id.split("-")[0] : kind === "trial" ? id : null;
  const t = trialId ? trialById(trialId) : undefined;
  const draftArm = !t && kind === "trial" ? state.drafts.flatMap((d) => d.arms.map((a) => ({ a, d }))).find((x) => x.a.id === id) : undefined;
  const owner = t?.owners[0] ?? draftArm?.d.owner;
  const isT09 = !!t?.excluded;
  const title =
    kind === "log"
      ? (() => {
          const l = logById(id);
          return l ? `${l.entry.t.replace("T", " ")} · ${l.entry.event}` : id;
        })()
      : kind === "ledger"
        ? state.ledger.find((l) => l.id === id)?.text ?? id
        : t
          ? `${t.id} · ${personById(t.owners[0]).name} · ${t.date}`
          : id;
  const onClick = () => {
    if (kind === "log" && t) dispatch({ type: "drawer", trialId: t.id, logId: id });
    else dispatch({ type: "focus", id });
  };
  return (
    <button className={`cite ${kind} ${isT09 ? "t09" : ""} ${mini ? "mini" : ""}`} onClick={onClick} title={title} type="button">
      {owner && !mini && <span className="cd" style={{ background: colorOf(owner) }} />}
      {id}
    </button>
  );
}

/** Inline text with [T08]-style tokens as chips. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {tokenize(text).map((seg, j) =>
        seg.kind === "text" ? <span key={j}>{seg.text}</span> : seg.ids.map((id) => <Cite key={`${j}-${id}`} id={id} />),
      )}
    </>
  );
}

const LABELED = /^(Hypothesis|Uncertain|Proposal):\s*/i;
const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

/**
 * Renders an answer: paragraphs, one markdown evidence table, and "Hypothesis: / Uncertain: / Proposal:" lines,
 * each kept visually apart so evidence and conclusions don't blur. Paragraphs split on blank lines.
 */
export function CitedText({ text, caret }: { text: string; caret?: boolean }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <>
      {blocks.map((b, i) => {
        const last = i === blocks.length - 1;
        const lines = b.split("\n").filter((l) => l.trim());
        if (lines.length >= 2 && lines.every((l) => l.trim().startsWith("|"))) {
          const [head, ...rest] = lines;
          const body = rest.filter((l) => !/^\s*\|[\s|:-]+\|?\s*$/.test(l));
          return (
            <table className="ev-table" key={i}>
              <thead><tr>{cells(head).map((c, k) => <th key={k}>{c}</th>)}</tr></thead>
              <tbody>{body.map((l, r) => <tr key={r}>{cells(l).map((c, k) => <td key={k}><Inline text={c} /></td>)}</tr>)}</tbody>
            </table>
          );
        }
        const m = b.match(LABELED);
        if (m) {
          return (
            <p className={`labeled ${m[1].toLowerCase()}`} key={i}>
              <span className="lbl">{m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()}</span>
              <span><Inline text={b.slice(m[0].length).replace(/^./, (c) => c.toUpperCase())} />{caret && last && <span className="caret" />}</span>
            </p>
          );
        }
        return (
          <p key={i} className={i === 0 ? "lead" : ""}>
            <Inline text={b} />
            {caret && last && <span className="caret" />}
          </p>
        );
      })}
    </>
  );
}

export function Check({ ok }: { ok: boolean }) {
  return ok ? <span className="check" aria-label="passes">✓</span> : <span className="cross" aria-label="fails">✗</span>;
}
