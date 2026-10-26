// The SOP editor's blocks (BlockNote, as in Scratch): ordinary text and bullets, plus three protocol blocks.
// - Setting: a named number the run can change (batch_g = 50 g).
// - Step: a numbered heading tied to an instrument in the lab.
// - Amount: a formula over settings and earlier amounts, typeset as math with its live value.
// The document converts to and from a BenchProtocol, so View, Print and Run read exactly what was written.
import { createContext, useContext } from "react";
import { BlockNoteSchema, defaultBlockSpecs, filterSuggestionItems } from "@blocknote/core";
import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { createReactBlockSpec, getDefaultReactSlashMenuItems } from "@blocknote/react";
import type { BenchField, BenchProtocol, BenchStep, StepId } from "../shared/types.ts";
import { isPlain, toTex } from "../shared/calc.ts";
import { lab } from "../lib/org.ts";
import { fmt } from "../lib/benchRun.ts";
import { MathTex, texText } from "../components/MathTex.tsx";

/** Instruments a step can use, and the bench model each one draws. */
export const STATION: Record<string, StepId> = {
  balance: "weigh", mixer: "mix", degasser: "degas", viscometer: "viscosity", "printer-1": "print", "printer-2": "print", "uv-oven": "postcure", "test-frame": "test",
};
const INSTRUMENTS = lab.instruments.filter((i) => STATION[i.id]);

/** Live values and labels for the Amount blocks, recomputed by the editor on every change. */
export const SopScope = createContext<{ values: Record<string, number>; labels: Record<string, string>; errors: Record<string, string> }>({ values: {}, labels: {}, errors: {} });

// Typing inside a block's own inputs belongs to the input, not the document.
const own = { onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation(), onPaste: (e: React.ClipboardEvent) => e.stopPropagation() };

const Setting = createReactBlockSpec(
  { type: "setting", propSchema: { pid: { default: "" }, label: { default: "" }, value: { default: "" }, unit: { default: "" } }, content: "none" },
  {
    render: ({ block, editor }) => {
      const set = (k: string, v: string) => editor.updateBlock(block, { props: { [k]: v } });
      const p = block.props;
      return (
        <div className="sop-setting" contentEditable={false}>
          <input className="sop-in label" value={p.label} placeholder="Name" onChange={(e) => set("label", e.target.value)} {...own} />
          <input className="sop-in mono num" value={p.value} placeholder="0" inputMode="decimal" onChange={(e) => set("value", e.target.value)} {...own} />
          <input className="sop-in mono unit" value={p.unit} placeholder="unit" onChange={(e) => set("unit", e.target.value)} {...own} />
          <input className="sop-in mono id" value={p.pid} placeholder="variable" onChange={(e) => set("pid", e.target.value.replace(/\W/g, "_"))} {...own} />
        </div>
      );
    },
  },
);

const Step = createReactBlockSpec(
  { type: "step", propSchema: { sid: { default: "" }, instrument: { default: "balance" }, get: { default: "" }, put: { default: "" }, photo: { default: false }, timer: { default: "" } }, content: "inline" },
  {
    render: ({ block, editor, contentRef }) => (
      <div className="sop-step">
        <span className="sop-step-num" contentEditable={false} />
        <h2 className="sop-step-title" ref={contentRef} />
        <input className="sop-in mono sop-timer" contentEditable={false} value={block.props.timer} placeholder="timer" aria-label="Timer, minutes"
          onChange={(e) => editor.updateBlock(block, { props: { timer: e.target.value.replace(/[^\d.]/g, "") } })} {...own} />
        <select className="sop-in sop-inst" contentEditable={false} value={block.props.instrument} aria-label="Instrument"
          onChange={(e) => editor.updateBlock(block, { props: { instrument: e.target.value } })}>
          {INSTRUMENTS.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </div>
    ),
  },
);

function AmountView({ props, set }: { props: { fid: string; label: string; unit: string; formula: string }; set: (k: string, v: string) => void }) {
  const scope = useContext(SopScope);
  const err = scope.errors[props.fid];
  let tex = "";
  try {
    tex = isPlain(props.formula)
      ? `\\text{${texText(props.label || "Amount")}} = ${fmt(scope.values[props.fid], props.unit)}\\ \\text{${texText(props.unit)}}`
      : `\\text{${texText(props.label || "Amount")}} = ${toTex(props.formula, (id) => `\\text{${texText(scope.labels[id] ?? id)}}`)} = ${fmt(scope.values[props.fid], props.unit)}\\ \\text{${texText(props.unit)}}`;
  } catch { tex = ""; }
  return (
    <div className="sop-amount" contentEditable={false}>
      <div className="sop-amount-row">
        <input className="sop-in label" value={props.label} placeholder="Amount" onChange={(e) => set("label", e.target.value)} {...own} />
        <input className={`sop-in mono formula ${err ? "bad" : ""}`} value={props.formula} placeholder="batch_g * 0.38" spellCheck={false} title={err}
          onChange={(e) => set("formula", e.target.value)} {...own} />
        <input className="sop-in mono unit" value={props.unit} placeholder="unit" onChange={(e) => set("unit", e.target.value)} {...own} />
        <input className="sop-in mono id" value={props.fid} placeholder="variable" onChange={(e) => set("fid", e.target.value.replace(/\W/g, "_"))} {...own} />
      </div>
      {tex && !err && <MathTex tex={tex} />}
    </div>
  );
}

const Amount = createReactBlockSpec(
  { type: "amount", propSchema: { fid: { default: "" }, label: { default: "" }, unit: { default: "" }, formula: { default: "" }, scales: { default: false } }, content: "none" },
  { render: ({ block, editor }) => <AmountView props={block.props} set={(k, v) => editor.updateBlock(block, { props: { [k]: v } })} /> },
);

export const sopSchema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, setting: Setting(), step: Step(), amount: Amount() },
});
export type SopEditor = typeof sopSchema.BlockNoteEditor;
type SopBlock = typeof sopSchema.Block;
type SopPartial = typeof sopSchema.PartialBlock;

export const sopSlashItems = (editor: SopEditor, query: string) =>
  filterSuggestionItems([
    { title: "Step", aliases: ["step", "stage"], group: "Protocol", subtext: "Numbered step at an instrument",
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "step" }) },
    { title: "Amount", aliases: ["amount", "formula", "calc", "math"], group: "Protocol", subtext: "Formula with a live value",
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "amount" }) },
    { title: "Setting", aliases: ["setting", "param", "variable"], group: "Protocol", subtext: "A number the run can change",
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "setting" }) },
    ...getDefaultReactSlashMenuItems(editor),
  ], query);

// ---------- Protocol ⇄ document ----------

export function toBlocks(p: BenchProtocol): SopPartial[] {
  const out: SopPartial[] = p.params.map((x) => ({ type: "setting", props: { pid: x.id, label: x.label, value: String(x.value), unit: x.unit } }));
  for (const st of p.steps) {
    out.push({ type: "step", props: { sid: st.id, instrument: st.instrument, get: st.get.join(","), put: st.put.join(","), photo: !!st.photo, timer: st.timer_min ? String(st.timer_min) : "" }, content: st.title });
    for (const d of st.detail) out.push({ type: "bulletListItem", content: d });
    for (const f of st.fields) out.push({ type: "amount", props: { fid: f.id, label: f.label, unit: f.unit, formula: f.formula, scales: !!f.scales } });
  }
  return out;
}

const textOf = (b: SopBlock) => (Array.isArray(b.content) ? b.content.map((c) => ("text" in c ? c.text : "")).join("") : "");
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

/** The document back into a protocol. Text outside the protocol blocks is kept out of the run; bullets become a step's instructions. */
export function fromBlocks(blocks: SopBlock[], base: BenchProtocol): BenchProtocol {
  const params: BenchProtocol["params"] = [];
  const steps: BenchStep[] = [];
  for (const b of blocks) {
    if (b.type === "setting" && b.props.pid) params.push({ id: b.props.pid, label: b.props.label || b.props.pid, value: Number(b.props.value) || 0, unit: b.props.unit });
    else if (b.type === "step") steps.push({
      id: b.props.sid || `step-${steps.length + 1}`, station: STATION[b.props.instrument] ?? "weigh", instrument: b.props.instrument,
      title: textOf(b) || `Step ${steps.length + 1}`, detail: [], fields: [], get: list(b.props.get), put: list(b.props.put), photo: b.props.photo || undefined, timer_min: Number(b.props.timer) || undefined,
    });
    else if (steps.length && (b.type === "bulletListItem" || b.type === "numberedListItem" || b.type === "checkListItem") && textOf(b)) steps[steps.length - 1].detail.push(textOf(b));
    else if (steps.length && b.type === "amount" && b.props.fid) {
      const f: BenchField = { id: b.props.fid, label: b.props.label || b.props.fid, unit: b.props.unit, formula: b.props.formula };
      if (b.props.scales) f.scales = true;
      steps[steps.length - 1].fields.push(f);
    }
  }
  return { ...base, params, steps };
}
