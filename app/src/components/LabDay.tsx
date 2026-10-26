// Today in the lab as a day calendar (react-big-calendar). Blocks are colored by instrument; who holds each is a
// person-colored token inside it. States are drawn, not written: solid = in use now, tint = booked, hatched = booked
// but idle right now, faded = past, empty = free. With `inst` it shows one instrument and drag-selecting a free span
// proposes a booking (approval card, as in the Ask).
import { useMemo } from "react";
import { Calendar, dateFnsLocalizer, type Event } from "react-big-calendar";
import { format, getDay, parse, startOfWeek } from "date-fns";
import { enUS } from "date-fns/locale";
import "react-big-calendar/lib/css/react-big-calendar.css";
import type { PersonId } from "../shared/types.ts";
import { colorOf, firstNameOf, personById, project } from "../data/notebook.ts";
import { instrumentById, lab } from "../lib/org.ts";
import { useStore } from "../state/store.tsx";

const localizer = dateFnsLocalizer({ format, parse, startOfWeek: (d: Date) => startOfWeek(d, { weekStartsOn: 1 }), getDay, locales: { "en-US": enUS } });
const NOW = new Date(project.now);
const today = project.now.slice(0, 10);
const at = (hhmm: string) => new Date(`${today}T${hhmm}:00`);
const hhmm = (d: Date) => format(d, "HH:mm");

/** One color per instrument: earthy hues kept clear of the two person colors and the three status colors. */
export const INSTRUMENT_COLOR: Record<string, string> = {
  balance: "#9a7b2f", mixer: "#2f6b5a", degasser: "#55606e", viscometer: "#6b7a3a",
  "printer-1": "#9c4f2e", "printer-2": "#b07a5a", "uv-oven": "#8a4b5c", "test-frame": "#6a5a4a",
  imaging: "#4b6470", "plate-reader": "#7d6b8f", "hot-plate": "#8f6a3a",
};
const colorOfInst = (id: string) => INSTRUMENT_COLOR[id] ?? "#69655c";

type State = "use" | "booked" | "idle" | "past";
interface Block extends Event { inst: string; by: PersonId; state: State }

export function LabDay({ onSelect, inst, onBook, height = 560 }: {
  onSelect?: (id: string) => void;
  inst?: string; // one instrument's calendar
  onBook?: (from: string, to: string) => void; // drag-select a free span
  height?: number;
}) {
  const { state } = useStore();
  const events = useMemo<Block[]>(() => {
    const reserved = [
      ...lab.schedule.map((s) => ({ inst: s.inst, by: s.by, from: s.from, to: s.to })),
      ...state.bookings.filter((b) => b.day === "Today").map((b) => ({ inst: b.inst, by: b.by, from: b.from, to: b.to })),
    ];
    const inUse = lab.instruments.filter((i) => i.in_use).map((i) => ({ inst: i.id, by: i.in_use!.by, from: i.in_use!.from, to: i.in_use!.until }));
    const block = (r: { inst: string; by: PersonId; from: string; to: string }, s: State): Block =>
      ({ inst: r.inst, by: r.by, state: s, title: instrumentById(r.inst)?.name ?? r.inst, start: at(r.from), end: at(r.to) });
    return [
      ...inUse.map((r) => block(r, "use")),
      ...reserved.map((r) => {
        const s: State = at(r.to) <= NOW ? "past" : at(r.from) <= NOW && !lab.instruments.find((i) => i.id === r.inst)?.in_use ? "idle" : "booked";
        return block(r, s);
      }),
    ].filter((e) => !inst || e.inst === inst);
  }, [state.bookings, inst]);

  return (
    <div className={`labday ${inst ? "one" : ""}`}>
      <Calendar<Block>
        localizer={localizer}
        events={events}
        defaultView="day"
        views={["day"]}
        date={NOW}
        onNavigate={() => {}}
        getNow={() => NOW}
        toolbar={false}
        min={at("08:00")}
        max={at("18:00")}
        scrollToTime={at("08:00")}
        step={15}
        timeslots={4}
        style={{ height }}
        selectable={!!onBook}
        onSelectSlot={({ start, end }) => { if (onBook && end > NOW) onBook(hhmm(start < NOW ? NOW : start), hhmm(end)); }}
        onSelectEvent={(e) => onSelect?.(e.inst)}
        tooltipAccessor={(e) => `${e.title} · ${firstNameOf(e.by)} · ${hhmm(e.start!)}–${hhmm(e.end!)}`}
        eventPropGetter={(e) => ({ className: e.state, style: { "--ic": colorOfInst(e.inst) } as React.CSSProperties })}
        components={{
          event: ({ event }) => (
            <span className="labday-ev">
              <i className="labday-who" style={{ background: colorOf(event.by) }}>{personById(event.by).initials}</i>
              {!inst && <b>{event.title}</b>}
            </span>
          ),
        }}
      />
    </div>
  );
}

/** The drawn states, for a one-line key under an instrument's calendar. */
export const LabDayKey = ({ inst }: { inst: string }) => (
  <div className="labday-key" style={{ "--ic": colorOfInst(inst) } as React.CSSProperties}>
    <span><i className="use" />In use</span><span><i className="booked" />Booked</span><span><i className="idle" />Booked, idle</span><span><i className="free" />Free</span>
  </div>
);
