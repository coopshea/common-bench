// The room: every instrument, how it's logged, and who's using it. The right panel follows the selected instrument,
// and its Ask books time ("Book the degasser 2–4 pm") through an approval card.
import { Fragment, useMemo, useState } from "react";
import type { Instrument } from "../shared/types.ts";
import { people, personById, trials } from "../data/notebook.ts";
import { ME, company, experimentOfTrial, instrumentById, lab, pathOf, recentTrialsAt } from "../lib/org.ts";
import { useGo } from "../lib/nav.tsx";
import { parseBooking, type BookingDraft } from "../lib/booking.ts";
import { useStore } from "../state/store.tsx";
import { Avatar, LogSquare, SOURCE_TEXT } from "../ds/index.tsx";
import { FloorPlan } from "../components/FloorPlan.tsx";
import { ScopedAsk } from "../components/ScopedAsk.tsx";
import { LabTwin, instrumentNumber } from "../figures/LabTwin.tsx";
import { InstrumentFigure } from "../figures/bench/InstrumentFigure.tsx";
import { runsOf, stationAt } from "../figures/bench/timeline.ts";
import type { StepId } from "../shared/types.ts";

const STEP_OF: Record<string, StepId> = {
  balance: "weigh", mixer: "mix", degasser: "degas", viscometer: "viscosity", "printer-1": "print", "printer-2": "print", "uv-oven": "postcure", "test-frame": "test",
};
const inside = (i: Instrument, b: { x: number; y: number; w: number; h: number }) =>
  i.x + i.w / 2 >= b.x && i.x + i.w / 2 <= b.x + b.w && i.y + i.h / 2 >= b.y && i.y + i.h / 2 <= b.y + b.h;
export const benchOf = (i: Instrument) => lab.benches.find((b) => inside(i, b))?.name ?? "";

export function LabPage() {
  const { state, dispatch } = useStore();
  const [plan, setPlan] = useState(false);
  const sel = state.sel.inst ? instrumentById(state.sel.inst) : undefined;
  const select = (id: string) => dispatch({ type: "select", sel: { inst: state.sel.inst === id ? null : id } });
  const booked = useMemo(() => new Set(state.bookings.map((b) => b.inst)), [state.bookings]);
  return (
    <div className="pg-split">
      <div className="pg-main lab">
        <div className="pg-titlerow">
          <div className="pg-title"><span className="cb-label">{company}</span><h1 className="h1">{lab.room}</h1></div>
          <div className="seg sm" role="group" aria-label="View">
            <button className={plan ? "" : "on"} aria-pressed={!plan} onClick={() => setPlan(false)}>Twin</button>
            <button className={plan ? "on" : ""} aria-pressed={plan} onClick={() => setPlan(true)}>Floor plan</button>
          </div>
        </div>
        <div className="legend">
          <span><LogSquare source="mhs" />Logs itself</span>
          <span><LogSquare source="manual" />By hand</span>
          <span><LogSquare source="none" />Not logged</span>
          <span><svg width="22" height="12" aria-hidden="true"><ellipse cx="11" cy="6" rx="10" ry="5" fill="none" stroke="var(--person-greeshma)" strokeWidth="2" /></svg>In use now</span>
        </div>
        <section className="twinbox" aria-label={`${lab.room} view`}>
          {plan ? <FloorPlan selected={sel?.id ?? null} onSelect={select} /> : <LabTwin selected={sel?.id ?? null} onSelect={select} booked={booked} />}
        </section>
        <section className="keys" aria-label="Instruments">
          {lab.benches.map((b) => {
            const list = lab.instruments.filter((i) => inside(i, b));
            if (!list.length) return null;
            return (
              <div key={b.name}>
                <h2 className="cb-label">{b.name}</h2>
                <ol>
                  {list.map((i) => {
                    const bk = state.bookings.filter((x) => x.inst === i.id);
                    return (
                      <li key={i.id}>
                        <button className={sel?.id === i.id ? "sel" : ""} aria-current={sel?.id === i.id} onClick={() => select(i.id)}>
                          <span className="n">{instrumentNumber(i.id)}</span>
                          <span className="nm">{i.name}
                            {i.in_use && <span className="use"><i className="dot" style={{ background: `var(--person-${i.in_use.by})` }} />until {i.in_use.until}</span>}
                            {bk.map((x) => <span key={x.id} className="use"><i className="dot hollow" style={{ borderColor: `var(--person-${x.by})` }} />{x.day.toLowerCase()} {x.from}–{x.to}</span>)}
                          </span>
                          <LogSquare source={i.source} />
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </div>
            );
          })}
        </section>
      </div>
      <aside className="pg-panel" aria-label={sel ? sel.name : "Lab"}>
        {sel ? <InstrumentPanel key={sel.id} i={sel} /> : <LabSummary onSelect={select} />}
      </aside>
    </div>
  );
}

/** Booking requests in the Ask become an approval card under it. Nothing is booked until approved. */
function useBooking(context?: Instrument) {
  const { dispatch, state } = useStore();
  const [draft, setDraft] = useState<BookingDraft | null>(null);
  const [miss, setMiss] = useState(false);
  const intercept = (q: string) => {
    if (!/\b(book|reserve|hold)\b/i.test(q)) return false;
    const d = parseBooking(q, context);
    setDraft(d);
    setMiss(!d);
    return true;
  };
  const card = draft ? (
    <div className="approve" role="group" aria-label="Booking to approve">
      <span className="cb-label">Book</span>
      <p className="approve-what"><b>{draft.inst.name}</b> · {draft.day} {draft.from}–{draft.to}</p>
      <div className="pn-row start"><Avatar id={ME} size="sm" /><span className="muted">{personById(ME).name.split(" ")[0]}</span></div>
      <div className="pn-row end">
        <button className="cb-btn ghost" onClick={() => setDraft(null)}>Cancel</button>
        <button className="cb-btn primary" onClick={() => {
          dispatch({ type: "book", booking: { id: `B${state.bookings.length + 1}`, inst: draft.inst.id, by: ME, day: draft.day, from: draft.from, to: draft.to } });
          setDraft(null);
        }}>Approve</button>
      </div>
    </div>
  ) : miss ? <p className="cb-label">Which instrument? Try “Book the degasser 2–4 pm”.</p> : null;
  return { intercept, card };
}

function LabSummary({ onSelect }: { onSelect: (id: string) => void }) {
  const { state } = useStore();
  const { intercept, card } = useBooking();
  const busy = lab.instruments.filter((i) => i.in_use);
  return (
    <ScopedAsk scope={lab.room} placeholder="Book the degasser 2–4 pm…" intercept={intercept}>
      {card}
      <section className="pn-sect">
        <h3 className="h3">In use now</h3>
        {busy.map((i) => (
          <button key={i.id} className="line-btn" onClick={() => onSelect(i.id)}>
            <Avatar id={i.in_use!.by} size="sm" /><span className="grow">{i.name}</span><span className="cb-label">until {i.in_use!.until}</span>
          </button>
        ))}
      </section>
      {state.bookings.length > 0 && (
        <section className="pn-sect">
          <h3 className="h3">Booked</h3>
          {state.bookings.map((b) => (
            <button key={b.id} className="line-btn" onClick={() => onSelect(b.inst)}>
              <Avatar id={b.by} size="sm" /><span className="grow">{instrumentById(b.inst)?.name}</span><span className="cb-label">{b.day.toLowerCase()} {b.from}–{b.to}</span>
            </button>
          ))}
        </section>
      )}
    </ScopedAsk>
  );
}

function InstrumentPanel({ i }: { i: Instrument }) {
  const { state, dispatch } = useStore();
  const go = useGo();
  const { intercept, card } = useBooking(i);
  const [draft, setDraft] = useState<{ text: string; nonce: number } | null>(null);
  const recent = recentTrialsAt(i);
  const owners = [...new Set(recent.map((t) => t.owners[0]))];
  const step = STEP_OF[i.id];
  const ref = useMemo(() => [...trials].reverse().find((t) => t.log.some((e) => e.device === i.device)) ?? trials.at(-1)!, [i.device]);
  const bookings = state.bookings.filter((b) => b.inst === i.id);
  // Who has never used it, across every trial (not just the recent ones).
  const usedBy = new Set(trials.filter((t) => t.log.some((e) => e.device === i.device)).flatMap((t) => t.owners));
  const neverUsedBy = i.device ? people.map((p) => p.id).filter((p) => !usedBy.has(p)) : [];
  return (
    <ScopedAsk scope={i.name} wideScope={lab.room} placeholder="How does it work? Book it 2–4 pm…" intercept={intercept} draft={draft}>
      {card}
      <header className="pn-head">
        <div className="pn-title"><span className="cb-label">{instrumentNumber(i.id)} · {benchOf(i)}</span><h2 className="pn-name">{i.name}</h2></div>
        <button className="cb-round sm" aria-label="Close instrument" onClick={() => dispatch({ type: "select", sel: { inst: null } })}>×</button>
      </header>
      {step && (
        <div className="pn-fig">
          <InstrumentFigure step={step} state={stationAt(ref, runsOf(ref), step, Infinity)} t={0.6} width={300} height={260} label={i.name} />
        </div>
      )}
      <dl className="facts">
        <dt>Logged</dt><dd><LogSquare source={i.source} />{SOURCE_TEXT[i.source]}</dd>
        <dt>Calibration</dt><dd>{i.calibrated ?? "None on record"}</dd>
        <dt>Now</dt><dd>{i.in_use ? <><Avatar id={i.in_use.by} size="sm" />until {i.in_use.until}</> : "Free"}</dd>
        {bookings.map((b) => <Fragment key={b.id}><dt>Booked</dt><dd><Avatar id={b.by} size="sm" />{b.day} {b.from}–{b.to}</dd></Fragment>)}
      </dl>
      <section className="pn-sect">
        <div className="pn-row"><h3 className="h3">Recent trials</h3><span className="cb-people">{owners.map((o) => <Avatar key={o} id={o} size="sm" />)}</span></div>
        {recent.length ? (
          <div className="chips">
            {recent.map((t) => {
              const x = experimentOfTrial(t)!;
              return (
                <button key={t.id} onClick={() => go(pathOf.experiment(x.project, x.id), { trial: t.id }, i.name)}>
                  <i className="dot" style={{ background: `var(--person-${t.owners[0]})` }} />{t.id}
                </button>
              );
            })}
          </div>
        ) : <p className="cb-label">None recorded</p>}
        {recent.length > 0 && neverUsedBy.length > 0 && (
          <p>{neverUsedBy.map((p) => personById(p).name.split(" ")[0]).join(" and ")}'s trials never used it.</p>
        )}
      </section>
      <section className="pn-sect row-start">
        <button className="cb-btn" onClick={() => setDraft({ text: `Book the ${i.name.toLowerCase()} today 14:00–16:00`, nonce: Date.now() })}>Book</button>
      </section>
    </ScopedAsk>
  );
}
