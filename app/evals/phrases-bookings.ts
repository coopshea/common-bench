// Phrases a person would actually say or type, run through the local parsers. Run: npm run test:phrases
import { parseBooking } from "../src/lib/booking.ts";
const T: [string, string | null][] = [
  ["Book the degasser 2–4 pm", "degasser Today 14:00–16:00"], ["book the mixer from 2 to 3:30", "mixer Today 14:00–15:30"],
  ["reserve the oven at 3 for 30 minutes", "uv-oven Today 15:00–15:30"], ["I need the mixer from 2 to 3", "mixer Today 14:00–15:00"],
  ["can I get the balance at 1pm for half an hour", "balance Today 13:00–13:30"], ["book printer 2 tomorrow 9-11", "printer-2 Tomorrow 09:00–11:00"],
  ["book the test frame for 90 min at 10am", "test-frame Today 10:00–11:30"], ["mixer 2-3pm", "mixer Today 14:00–15:00"],
  ["book the oven 11 to 1", "uv-oven Today 11:00–13:00"], ["hold the viscometer at 4:15 for 45 minutes", "viscometer Today 16:15–17:00"],
  ["is the degasser free at 2?", null], ["who used the mixer at 3?", null], ["book the centrifuge 2-3", null],
];
let bad = 0;
for (const [q, want] of T) { const d = parseBooking(q); const got = d ? `${d.inst.id} ${d.day} ${d.from}–${d.to}` : null; if (got !== want) { bad++; console.log("FAIL", q, "=>", got, "want", want); } }
console.log(T.length - bad, "/", T.length, "booking requests pass");
if (bad) process.exit(1);
