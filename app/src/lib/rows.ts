// The rows every view draws from: trials visible at the replay date, plus approved draft arms.
import { trials } from "../data/notebook.ts";
import { useStore, visibleAt } from "../state/store.tsx";
import { project } from "../data/notebook.ts";
import { rowOfTrial, rowsOfDraft, type Row } from "./metrics.ts";

export function useRows(): Row[] {
  const { state, replayDate } = useStore();
  const rows = trials.filter((t) => visibleAt(t.date, replayDate)).map(rowOfTrial);
  if (replayDate === null) for (const d of state.drafts) rows.push(...rowsOfDraft(d, project.now.slice(0, 10)));
  return rows;
}

/** The id to emphasize: what's under the pointer, else what was last clicked. */
export function useHighlight(): string | null {
  const { state } = useStore();
  return state.hover ?? state.focus?.id ?? null;
}
