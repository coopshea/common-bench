// The one-line key for the calendar's drawn states. Separate from LabDay so it doesn't load the calendar library.
import { INSTRUMENT_COLOR } from "./instrumentColors.ts";

/** The drawn states, for a one-line key under an instrument's calendar. */
export const LabDayKey = ({ inst }: { inst: string }) => (
  <div className="labday-key" style={{ "--ic": INSTRUMENT_COLOR[inst] ?? "#69655c" } as React.CSSProperties}>
    <span><i className="use" />In use</span><span><i className="booked" />Booked</span><span><i className="idle" />Booked, idle</span><span><i className="free" />Free</span>
  </div>
);
