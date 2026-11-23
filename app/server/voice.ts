// The voice the app answers in. With an ElevenLabs key (ELEVENLABS_API_KEY in .env.local) each answer is made there
// and kept on disk, so the same sentence is only ever made once; without a key, or when the service is slow or
// down, the computer's own voice is used instead (server/glasses.ts and server/glasses-export.ts fall back to `say`).
//
//   ELEVENLABS_VOICE   a voice id (default: Matilda)       ELEVENLABS_MODEL   default eleven_turbo_v2_5
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const KEY = process.env.ELEVENLABS_API_KEY ?? "";
const VOICE = process.env.ELEVENLABS_VOICE ?? "XrExE9yKIg1WjnnlVkGX";
const MODEL = process.env.ELEVENLABS_MODEL ?? "eleven_turbo_v2_5";
const CACHE = fileURLToPath(new URL("../recordings/.voice/", import.meta.url));
let down = 0; // when the service last failed: it is left alone for a minute after that, so answers aren't kept waiting

export const voiceName = () => (KEY ? `ElevenLabs (${VOICE.slice(0, 6)}…, ${MODEL})` : "this computer's voice");

/** The sentence as an MP3 file on disk, or null when it can't be made (no key, slow, refused): use the computer's voice then. */
export async function voiceFile(text: string, timeoutMs = 5000, voice = VOICE): Promise<string | null> {
  if (!KEY || !text.trim()) return null;
  const file = join(CACHE, `${createHash("sha1").update(`${voice}|${MODEL}|${text}`).digest("hex")}.mp3`);
  if (existsSync(file)) return file;
  if (Date.now() - down < 60_000) return null;
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: MODEL }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) { down = Date.now(); console.error(`[voice] ElevenLabs ${res.status}: ${(await res.text()).slice(0, 160)}`); return null; }
    const audio = Buffer.from(await res.arrayBuffer());
    if (audio.length < 500) return null;
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(file, audio);
    return file;
  } catch (e) {
    down = Date.now();
    console.error(`[voice] ElevenLabs: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
