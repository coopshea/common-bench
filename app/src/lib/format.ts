// Formatting helpers. Formatting only: no numbers are invented here.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2025-04-22" → "22 Apr 2025" */
export function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "2025-04-22" → "Apr 2025" */
export function fmtMonth(iso: string): string {
  const [y, m] = iso.slice(0, 7).split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** "2025-04-22T16:40:00" → "16:40" */
export function fmtTime(iso: string): string {
  return iso.slice(11, 16);
}

/** Fixed decimals without trailing noise. */
export function num(v: number, digits = 2): string {
  return v.toFixed(digits);
}

/** Trim trailing zeros: 1.0 → "1", 1.70 → "1.7". */
export function trim(v: number, maxDigits = 2): string {
  return String(Number(v.toFixed(maxDigits)));
}

export function pct(v: number, digits = 0): string {
  return `${(v * 100).toFixed(digits)}%`;
}

export function hoursBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / 3_600_000;
}

/** Whole months between two ISO dates (rounded). */
export function monthsBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / (30.44 * 86_400_000));
}
