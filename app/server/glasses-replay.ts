// Replay of a finished glasses recording: the video, the frames the camera log kept, and the log itself, lined up
// on one clock. The page is server/replay.html; it is opened at /api/glasses/replay/<recording id> (or /replay for
// the latest one).
//
// The video's own clock starts when its file was created (checked against real recordings: within about 0.2 s), so a
// log line stamped 22:30:24 belongs at (22:30:24 − the file's creation time) seconds into that video part.
// Recordings are written in pieces that survive a crash; the first replay rewrites each part once as an ordinary
// MP4 (replay-NNN.mp4, same pictures and sound, nothing re-encoded) so a browser can jump around in it.

import { spawn } from "node:child_process";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { evaluate, evaluateAll } from "../src/shared/calc.ts";
import { predict, type Prediction } from "../src/shared/chem.ts";
import type { GlassesContext, GlassesEvent } from "../src/shared/glasses.ts";

const PAGE = fileURLToPath(new URL("./replay.html", import.meta.url));

export interface ReplayData {
  id: string;
  started: string;
  ended: string | null;
  context: GlassesContext | null;
  parts: { n: number; t0: number }[]; // t0: when the part's first picture was taken in, ms since 1970
  events: GlassesEvent[];
  derived: boolean; // the events are the ones rebuilt from the video, not the live log
  calc: { label: string; unit: string; value: number; note?: string; group?: string; kind?: string }[]; // worked out from this trial's recorded values (the SOP's `calc`)
  series: { id: string; trial: string; values: Record<string, number> }[]; // this SOP's trials recorded within a day of this one, this one included
  predict: (Prediction & { soda_g: number; vinegar_g: number; weighed: boolean }) | null; // what the weighed amounts can make (SOPs with `reaction`)
  readings: { step: number; said: number; readable: boolean; value: number | null; seen_unit: string; agrees: boolean | null; crop: string | null; why: string }[]; // what the display showed (npm run read-scale)
}

/** The four forms a replay's data comes in (?derived=1, ?extra=1): the file names a published copy keeps them under. */
export const dataFile = (derived: boolean, extra: boolean) => `data${derived ? "-derived" : ""}${extra ? "-extra" : ""}.json`;

/**
 * `published`: the folder holds copies sent from the bench (server/glasses-publish.ts), each under an unguessable
 * name. Such a copy is only what the page needs, worked out before it was sent: the data as JSON, the browser-ready
 * video, the pictures. Nothing is worked out or converted here, no folder is read for its neighbours, and there is
 * no "latest", so knowing one link shows nothing of the others.
 */
export function replayRoutes(root: string, ffmpeg: string | undefined, isLive: (id: string) => boolean, opts: { published?: boolean } = {}) {
  const app = new Hono();
  const published = opts.published === true;
  const dirOf = (id: string) => (/^[\w-]+$/.test(id) && existsSync(join(root, id, published ? "data.json" : "log.jsonl")) ? join(root, id) : null);
  if (published) app.use("*", async (c, next) => { await next(); c.header("X-Robots-Tag", "noindex, nofollow"); c.header("Referrer-Policy", "no-referrer"); });
  const partsOf = (dir: string) => readdirSync(dir).filter((f) => /^video-\d+\.mp4$/.test(f)).sort();
  const latest = () => readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && dirOf(d.name)).map((d) => d.name).sort().pop();

  app.get("/recordings/:id/data", (c) => {
    const id = c.req.param("id"), dir = dirOf(id);
    if (!dir) return c.json({ error: "no such recording" }, 404);
    if (published) {
      const asked = join(dir, dataFile(c.req.query("derived") === "1", c.req.query("extra") === "1"));
      return new Response(readFileSync(existsSync(asked) ? asked : join(dir, "data.json")), { headers: { "Content-Type": "application/json", "Cache-Control": "private, no-cache" } });
    }
    const read = (f: string) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as GlassesEvent) : []);
    const live = read(join(dir, "log.jsonl")), rebuilt = read(join(dir, "derived", "log.jsonl"));
    // ?derived=1: the log rebuilt from the video alone (npm run reprocess). An imported video has no other.
    const derived = rebuilt.length > 0 && (c.req.query("derived") === "1" || !live.some((e) => e.source === "voice" || e.source === "value"));
    // ?extra=1: with the lines added afterwards (extra.jsonl), each marked as added.
    const extra = c.req.query("extra") === "1" ? read(join(dir, "extra.jsonl")).map((e) => ({ ...e, added: true })) : [];
    const events = [...(derived ? rebuilt : live), ...extra];
    const meta = existsSync(join(dir, "session.json")) ? (JSON.parse(readFileSync(join(dir, "session.json"), "utf8")) as { started: string; ended?: string; parts?: { n: number; t0: number }[]; context: GlassesContext | null }) : null;
    const data: ReplayData = {
      id,
      started: meta?.started ?? events[0]?.at ?? new Date().toISOString(),
      ended: meta?.ended ?? null,
      context: meta?.context ?? null,
      // The clock written down when the recording stopped; older recordings fall back to the files' creation times.
      parts: partsOf(dir).map((f) => { const n = Number(f.match(/\d+/)![0]); return { n, t0: meta?.parts?.find((x) => x.n === n)?.t0 ?? statSync(join(dir, f)).birthtimeMs }; }),
      events,
      derived,
      calc: [],
      series: [],
      readings: [],
      predict: null,
    };
    try { const f = join(dir, "derived", "readings.json"); if (existsSync(f)) data.readings = JSON.parse(readFileSync(f, "utf8")) as ReplayData["readings"]; } catch { /* a half-written file: no readings */ }
    // What the SOP works out from the recorded values, and the same SOP's other trials from the same session.
    type Saved = { started?: string; context?: GlassesContext | null };
    const valuesOf = (d: string): Record<string, number> => {
      try { const t = JSON.parse(readFileSync(join(d, derived && existsSync(join(d, "derived", "trial.json")) ? "derived/trial.json" : "trial.json"), "utf8")) as { entries?: Record<string, { value: number }> }; return Object.fromEntries(Object.entries(t.entries ?? {}).map(([k, v]) => [k, v.value])); } catch { return {}; }
    };
    const proto = data.context?.protocol;
    // A recording made before aims were written down (or a video brought in afterwards): the SOP's aims at its settings.
    if (proto && data.context && !data.context.plan) {
      const params = { ...Object.fromEntries(proto.params.map((x) => [x.id, x.value])), ...(data.context.params ?? {}) };
      const fields = proto.steps.flatMap((st) => st.fields);
      const worked = evaluateAll(fields.map((f) => ({ id: f.id, formula: f.formula })), params).values;
      data.context = { ...data.context, plan: Object.fromEntries(fields.map((f) => [f.id, f.result || !Number.isFinite(worked[f.id]) ? null : worked[f.id]])) };
    }
    if (proto) {
      const mine = valuesOf(dir);
      if (proto.reaction) {
        const plan = data.context?.plan ?? {};
        const soda_g = mine[proto.reaction.base] ?? plan[proto.reaction.base] ?? NaN, vinegar_g = mine[proto.reaction.acid] ?? plan[proto.reaction.acid] ?? NaN;
        if (Number.isFinite(soda_g) && Number.isFinite(vinegar_g)) data.predict = { ...predict(soda_g, vinegar_g, proto.reaction.acid_frac), soda_g, vinegar_g, weighed: proto.reaction.base in mine && proto.reaction.acid in mine };
      }
      for (const k of proto.calc ?? []) { try { const value = evaluate(k.formula, mine); if (Number.isFinite(value)) data.calc.push({ label: k.label, unit: k.unit, value, note: k.note, group: k.group, kind: k.kind }); } catch { /* a value it needs wasn't recorded */ } }
      const at = Date.parse(data.started);
      for (const other of readdirSync(root).sort()) {
        const od = dirOf(other);
        if (!od || !existsSync(join(od, "session.json"))) continue;
        try {
          const m = JSON.parse(readFileSync(join(od, "session.json"), "utf8")) as Saved;
          if (m.context?.protocol?.id !== proto.id || Math.abs(Date.parse(m.started ?? "") - at) > 24 * 3600_000 || Date.parse(m.started ?? "") > at) continue;
          const values = other === id ? mine : valuesOf(od);
          if (Object.keys(values).length) data.series.push({ id: other, trial: m.context?.trial ?? "", values });
        } catch { /* not a finished recording */ }
      }
    }
    return c.json(data);
  });

  app.get("/recordings/:id/moments/:name", (c) => {
    const dir = dirOf(c.req.param("id")), name = c.req.param("name");
    const file = dir && /^[\w-]+\.jpg$/.test(name) ? join(dir, "derived", "moments", name) : null;
    if (!file || !existsSync(file)) return c.notFound();
    return new Response(new Uint8Array(readFileSync(file)), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=60" } });
  });

  app.get("/recordings/:id/readings/:name", (c) => {
    const dir = dirOf(c.req.param("id")), name = c.req.param("name");
    const file = dir && /^[\w-]+\.jpg$/.test(name) ? join(dir, "derived", "readings", name) : null;
    if (!file || !existsSync(file)) return c.notFound();
    return new Response(new Uint8Array(readFileSync(file)), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=60" } });
  });

  app.get("/recordings/:id/frames/:name", (c) => {
    const dir = dirOf(c.req.param("id")), name = c.req.param("name");
    const file = dir && /^\d+\.jpg$/.test(name) ? join(dir, "frames", name) : null;
    if (!file || !existsSync(file)) return c.notFound();
    return new Response(new Uint8Array(readFileSync(file)), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" } });
  });

  // One part of the video, with byte ranges so the browser can seek.
  const making = new Map<string, Promise<boolean>>();
  const playable = (dir: string, n: string): Promise<boolean> => {
    const src = join(dir, `video-${n}.mp4`), out = join(dir, `replay-${n}.mp4`);
    if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) return Promise.resolve(true);
    if (!ffmpeg) return Promise.resolve(false);
    if (!making.has(out)) {
      making.set(out, new Promise<boolean>((res) => {
        const p = spawn(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-c", "copy", "-movflags", "+faststart", out], { stdio: "ignore" });
        p.once("exit", (code) => { making.delete(out); res(code === 0); });
        p.once("error", () => { making.delete(out); res(false); });
      }));
    }
    return making.get(out)!;
  };
  app.get("/recordings/:id/video/:n", async (c) => {
    const id = c.req.param("id"), dir = dirOf(id), n = c.req.param("n");
    if (!dir || !/^\d{3}$/.test(n) || !existsSync(join(dir, `${published ? "replay" : "video"}-${n}.mp4`))) return c.notFound();
    if (isLive(id)) return c.text("This recording is still running. Stop it first.", 409);
    const file = published || (await playable(dir, n)) ? join(dir, `replay-${n}.mp4`) : join(dir, `video-${n}.mp4`);
    const size = statSync(file).size;
    const range = c.req.header("range")?.match(/^bytes=(\d*)-(\d*)$/);
    const base = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600" };
    if (!range) return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: { ...base, "Content-Length": String(size) } });
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
      status: 206, headers: { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  });

  app.get("/replay/:id?", (c) => {
    const id = c.req.param("id") ?? (published ? undefined : latest());
    if (!id || !dirOf(id)) return c.text("No recording to replay yet.", 404);
    if (!c.req.param("id")) return c.redirect(`/api/glasses/replay/${id}`);
    return c.html(readFileSync(PAGE, "utf8"));
  });

  return app;
}
