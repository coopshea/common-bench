// Speech, the parts that are the same live and afterwards: cutting sound into sentences, and how Whisper is asked.
// server/glasses.ts uses them on the stream as it arrives; server/glasses-reprocess.ts on a finished video.
import type { GlassesContext } from "../src/shared/glasses.ts";

/** How the Whisper server is started: the model stays in memory, so each sentence takes a fraction of a second. */
export const WHISPER_ARGS = (model: string, port: number) => ["-m", model, "--host", "127.0.0.1", "--port", String(port), "-l", "en", "-nt", "-sns", "-nf"];
/** Words the model should expect: the SOP's own, and the units values are said in. */
export const speechHint = (ctx: GlassesContext | null) =>
  `Lab bench notes${ctx ? `: ${ctx.sop}; ${ctx.steps.map((x) => x.title).join(", ")}` : ""}. Grams, milligrams, milliliters, centimeters, rpm, minutes, seconds, degrees Celsius, percent.`;

/** 16 kHz, 16-bit, one channel, as a WAV file. */
export const wav = (pcm: Buffer) => {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
};
// What a speech model writes for sound that isn't speech: "[BLANK_AUDIO]", "(clinking)", a lone "Thank you."
export const NOT_SPEECH = /^(\[.*\]|\(.*\)|thank you\.?|thanks for watching[.!]?|you\.?|\.+)$/i;

/** Cuts 16 kHz sound into sentences by loudness: a sentence starts on three loud slices and ends on 0.6 s of quiet. */
export function sentences(onSentence: (pcm: Buffer, endByte: number) => void) {
  const SLICE = 960; // 30 ms of 16-bit mono
  let rest: Buffer = Buffer.alloc(0), floor = 200, loudRun = 0, quietRun = 0, on = false;
  let before: Buffer[] = [], speech: Buffer[] = [], taken = 0; // taken: bytes of sound cut into slices so far
  return (chunk: Buffer) => {
    rest = rest.length ? Buffer.concat([rest, chunk]) : chunk;
    while (rest.length >= SLICE) {
      const f = Buffer.from(rest.subarray(0, SLICE));
      rest = rest.subarray(SLICE);
      taken += SLICE;
      let sum = 0;
      for (let i = 0; i < SLICE; i += 2) { const v = f.readInt16LE(i); sum += v * v; }
      const level = Math.sqrt(sum / (SLICE / 2));
      const loud = level > Math.max(350, floor * 3);
      if (!loud) floor = floor * 0.98 + level * 0.02; // the room's own level, followed only while it's quiet
      if (!on) {
        before.push(f); if (before.length > 10) before.shift(); // keep the 0.3 s before the first word
        loudRun = loud ? loudRun + 1 : 0;
        if (loudRun >= 3) { on = true; speech = before; before = []; quietRun = 0; }
      } else {
        speech.push(f);
        quietRun = loud ? 0 : quietRun + 1;
        if (quietRun >= 20 || speech.length >= 667) { // 0.6 s of quiet, or 20 s, whichever comes first
          const pcm = Buffer.concat(speech);
          on = false; loudRun = 0; speech = [];
          if (pcm.length >= 16000) onSentence(pcm, taken); // half a second at least
        }
      }
    }
  };
}


// ---------- Our own replies, heard back ----------
// The glasses' microphone hears what is said back, a second or two late. Going deaf for that long also swallows
// the person's next words, so instead what was said is remembered: something heard while a reply was playing (or
// within a few seconds after) that is mostly the reply's own words is its echo, and is dropped.
export const ECHO_TAIL_MS = 4000;
export const wordsOf = (t: string) => t.toLowerCase().replace(/%/g, " percent ").replace(/[^a-z0-9.]+/g, " ").replace(/\.(?!\d)/g, " ").split(/\s+/).filter(Boolean);
/** How many of a's words appear in b in the same order. */
export function inOrder(a: string[], b: string[]) {
  const row: number[] = new Array(b.length + 1).fill(0);
  for (const x of a) {
    let diag = 0;
    for (let k = 1; k <= b.length; k++) { const up = row[k]; row[k] = x === b[k - 1] ? diag + 1 : Math.max(row[k], row[k - 1]); diag = up; }
  }
  return row[b.length];
}
/** Words that are a whole instruction to the trial on their own. */
export const COMMAND = /^(?:start|stop|done|next|photo|skip|confirm|confirmed|accept|accepted|accept it|keep it|yes|no|redo|skip (?:the )?timer|no timer|take (?:a |the )?photo)\W*$/i;
/**
 * Is this sentence (heard from `from` to `to`, ms) one of our own replies coming back through the microphone?
 * Its words have to be the reply's words in the reply's order: all of them for a few words, three in four for more.
 * Sharing loose words is not enough ("Salt, 5 grams" after "Step 1 of 5. Weigh the salt: 4.5 grams" is the person).
 *
 * A bare command is the person ("Say start for the 1 minute timer." … "Start."), even said over the end of the
 * reply: a word from the middle of a spoken sentence never comes back as a sentence of its own. Only a reply that
 * has that word as a whole sentence ("Next: Photo.") can echo it, and only while it plays or just after: said a
 * moment later, it is the person doing what the reply asked.
 */
export function isEchoOf(text: string, from: number, replies: { text: string; start: number; end: number }[], to = from) {
  const said = wordsOf(text);
  if (!said.length) return false;
  const command = COMMAND.test(text.trim());
  return replies.some((r) => {
    if (to < r.start - 500 || from > r.end + ECHO_TAIL_MS) return false;
    if (command && (from > r.end + 1500 || !r.text.split(/[.!?:]+/).some((part) => wordsOf(part).join(" ") === said.join(" ")))) return false;
    const share = inOrder(said, wordsOf(r.text)) / said.length;
    return said.length >= 4 ? share >= 0.75 : share === 1;
  });
}
