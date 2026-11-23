// A finished recording, published: a copy of its replay sent from the bench computer to a hosted copy of the app,
// so the replay opens on the web.
//
// What is sent is only what the replay page needs, worked out on the bench computer first: the page's data as JSON,
// the browser-ready video, and the pictures (camera frames, moments, display cut-outs). The hosted copy stores the
// files and hands them back. It runs no ffmpeg, no browser and no model.
//
// Who can do what:
//   sending, listing and removing need the publish key (PUBLISH_KEY on both sides, sent as x-publish-key);
//   watching needs the link, which ends in a name nobody can guess (128 random bits). There is no list of links,
//   and one copy says nothing about another. Removing the copy ends the link.
//
// The two halves live here: publishedRoutes() is the hosted side, publishRecording() is the bench side
// (npm run publish-trial, server/glasses-publish-cli.ts).

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { dataFile, replayRoutes, type ReplayData } from "./glasses-replay.ts";

const MB = 1024 * 1024;
export const CHUNK = 8 * MB; // one request's worth; a video goes up in pieces so no request is long or large
const CHUNK_MAX = 32 * MB;
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

/** The only files a published copy may hold, and how large each may be. Anything else is refused. */
const PLACES: { re: RegExp; max: number }[] = [
  { re: /^data(-derived)?(-extra)?\.json$/, max: 8 * MB },
  { re: /^replay-\d{3}\.mp4$/, max: 4096 * MB },
  { re: /^frames\/\d+\.jpg$/, max: 8 * MB },
  { re: /^derived\/moments\/[\w-]+\.jpg$/, max: 8 * MB },
  { re: /^derived\/readings\/[\w-]+\.jpg$/, max: 8 * MB },
];
export const placeOf = (rel: string) => PLACES.find((p) => p.re.test(rel)) ?? null;

const digest = (s: string) => createHash("sha256").update(s).digest();
const sameKey = (given: string | undefined, key: string) => typeof given === "string" && timingSafeEqual(digest(given), digest(key));

/** Every finished file under a folder, as "frames/000012.jpg" → bytes. Half-sent files (.part) are left out. */
function filesIn(dir: string, under = ""): Record<string, number> {
  const out: Record<string, number> = {};
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = under ? `${under}/${e.name}` : e.name;
    if (e.isDirectory()) Object.assign(out, filesIn(join(dir, e.name), rel));
    else if (!e.name.endsWith(".part")) out[rel] = statSync(join(dir, e.name)).size;
  }
  return out;
}
const bytesIn = (dir: string): number => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? bytesIn(join(dir, e.name)) : statSync(join(dir, e.name)).size), 0) : 0);

/**
 * The hosted side, mounted under /api/glasses.
 *   PUT    /publish/<name>/<file>?offset=N[&last=1]   one piece of one file (key)
 *   GET    /publish/<name>                            what has arrived (key)
 *   DELETE /publish/<name>                            remove the copy (key)
 *   GET    /replay/<name>, /recordings/<name>/...     the replay itself (the link is the permission)
 * With no key set, nothing can be sent and the sending routes answer as if they were not there.
 */
export function publishedRoutes(root: string, key: string | undefined, maxBytes = Number(process.env.PUBLISH_MAX_GB ?? 4) * 1024 * MB) {
  const app = new Hono();
  mkdirSync(root, { recursive: true });

  const gate = new Hono();
  gate.use("*", async (c, next) => {
    if (!key) return c.json({ error: "Publishing is not set up on this copy." }, 404);
    if (!sameKey(c.req.header("x-publish-key"), key)) return c.json({ error: "publish key required" }, 401);
    return next();
  });

  gate.put("/:token/:rest{.+}", bodyLimit({ maxSize: CHUNK_MAX, onError: (c) => c.json({ error: "piece too large" }, 413) }), async (c) => {
    const token = c.req.param("token"), rel = c.req.param("rest"), place = placeOf(rel);
    if (!TOKEN.test(token)) return c.json({ error: "bad name" }, 400);
    if (!place) return c.json({ error: "not a file a replay uses" }, 400);
    const offset = Number(c.req.query("offset") ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0) return c.json({ error: "bad offset" }, 400);
    const file = join(root, token, rel), part = `${file}.part`;
    // Pieces go on the end, in order. A piece for the wrong place is told how much has arrived, so sending can pick up there.
    const have = offset === 0 ? 0 : existsSync(part) ? statSync(part).size : 0;
    if (offset !== have) return c.json({ error: "out of order", have }, 409);
    const piece = Buffer.from(await c.req.arrayBuffer());
    if (offset + piece.length > place.max) { rmSync(part, { force: true }); return c.json({ error: "file too large" }, 413); }
    if (offset === 0 && bytesIn(root) + piece.length > maxBytes) return c.json({ error: "The published recordings are at their size limit. Remove one first." }, 507);
    mkdirSync(dirname(file), { recursive: true });
    if (offset === 0) writeFileSync(part, piece); else appendFileSync(part, piece);
    if (c.req.query("last") === "1") renameSync(part, file);
    return c.json({ ok: true, have: offset + piece.length });
  });

  gate.get("/:token", (c) => {
    const token = c.req.param("token");
    if (!TOKEN.test(token)) return c.json({ error: "bad name" }, 400);
    return c.json({ files: filesIn(join(root, token)) });
  });

  gate.delete("/:token", (c) => {
    const token = c.req.param("token");
    if (!TOKEN.test(token) || !existsSync(join(root, token))) return c.json({ error: "no such copy" }, 404);
    rmSync(join(root, token), { recursive: true, force: true });
    return c.json({ ok: true });
  });

  app.route("/publish", gate);
  app.route("/", replayRoutes(root, undefined, () => false, { published: true }));
  return app;
}

// ---------- the bench side ----------

type Send = (path: string, init?: RequestInit) => Promise<Response>;
export interface Published { id: string; token: string; url: string; sent: number; skipped: number; bytes: number }

/** The names given out so far, kept beside the recordings (never inside one): publishing again keeps the same link. */
const bookOf = (root: string) => join(root, ".published.json");
type Book = Record<string, { token: string; at: string }>;
const readBook = (root: string): Book => { try { return JSON.parse(readFileSync(bookOf(root), "utf8")) as Book; } catch { return {}; } };
const entryOf = (id: string, to: string) => `${to} ${id}`;

/**
 * Send one finished recording's replay to a hosted copy. `send` reaches the hosted copy's /api/glasses (a test hands
 * in the routes themselves). Files already there at the same size are not sent again, so a second run is quick and a
 * broken one picks up where it stopped. The data goes last: the link shows nothing until everything is in place.
 */
export async function publishRecording(o: { root: string; id: string; to: string; key: string; ffmpeg?: string; send?: Send; say?: (s: string) => void; chunk?: number }): Promise<Published> {
  const { root, id, key } = o, to = o.to.replace(/\/+$/, ""), say = o.say ?? (() => {}), chunk = o.chunk ?? CHUNK;
  const dir = join(root, id);
  if (!/^[\w-]+$/.test(id) || !existsSync(join(dir, "log.jsonl"))) throw new Error("No such recording.");
  const send: Send = o.send ?? ((path, init) => fetch(`${to}/api/glasses${path}`, init));
  const headers = { "x-publish-key": key };

  // The page's data, in each form the page can ask for, from the same routes the replay on this computer uses.
  const local = replayRoutes(root, o.ffmpeg, () => false);
  const datas: { rel: string; body: Buffer }[] = [];
  let parts: ReplayData["parts"] = [];
  for (const [derived, extra] of [[false, false], [true, false], [false, true], [true, true]] as const) {
    const r = await local.request(`/recordings/${id}/data?${derived ? "derived=1&" : ""}${extra ? "extra=1" : ""}`);
    if (!r.ok) throw new Error("This recording's replay could not be read.");
    const data = (await r.json()) as ReplayData;
    if (!derived && !extra) parts = data.parts;
    datas.push({ rel: dataFile(derived, extra), body: Buffer.from(JSON.stringify(data)) });
  }

  // The video as a browser plays it. Asking this computer's replay for one byte makes that file if it is missing.
  const media: { rel: string; file: string }[] = [];
  for (const p of parts) {
    const n = String(p.n).padStart(3, "0"), ready = join(dir, `replay-${n}.mp4`);
    await (await local.request(`/recordings/${id}/video/${n}`, { headers: { range: "bytes=0-0" } })).arrayBuffer();
    if (!existsSync(ready)) say(`Part ${n}: no browser-ready copy could be made (is ffmpeg installed?). Sending the recording as it was written; jumping around in it may be slow.`);
    media.push({ rel: `replay-${n}.mp4`, file: existsSync(ready) ? ready : join(dir, `video-${n}.mp4`) });
  }
  for (const folder of ["frames", "derived/moments", "derived/readings"]) {
    if (!existsSync(join(dir, folder))) continue;
    for (const name of readdirSync(join(dir, folder)).sort()) if (placeOf(`${folder}/${name}`)) media.push({ rel: `${folder}/${name}`, file: join(dir, folder, name) });
  }

  const book = readBook(root), entry = entryOf(id, to);
  const token = book[entry]?.token ?? randomBytes(16).toString("base64url");
  const there = await send(`/publish/${token}`, { headers });
  if (there.status === 401) throw new Error("The hosted copy refused the publish key.");
  if (there.status === 404) throw new Error("Publishing is not set up on the hosted copy (it has no PUBLISH_KEY).");
  if (!there.ok) throw new Error(`The hosted copy answered ${there.status}.`);
  const already = ((await there.json()) as { files: Record<string, number> }).files;

  const put = async (rel: string, size: number, read: (from: number, to: number) => Buffer) => {
    let at = 0, tries = 0;
    do {
      const end = Math.min(size, at + chunk), last = end >= size;
      const r = await send(`/publish/${token}/${rel}?offset=${at}${last ? "&last=1" : ""}`, { method: "PUT", headers: { ...headers, "content-type": "application/octet-stream" }, body: new Uint8Array(read(at, end)) });
      if (r.status === 409 && tries++ < 3) { at = 0; continue; } // the other side holds a different half-sent file: start this one again
      if (!r.ok) throw new Error(`${rel}: ${((await r.json().catch(() => ({}))) as { error?: string }).error ?? r.status}`);
      at = end;
    } while (at < size);
  };

  let sent = 0, skipped = 0, bytes = 0;
  for (const m of media) {
    const size = statSync(m.file).size;
    if (already[m.rel] === size) { skipped += 1; continue; }
    if (size > 20 * MB) say(`Sending ${m.rel} (${Math.round(size / MB)} MB)…`);
    const fd = openSync(m.file, "r");
    try { await put(m.rel, size, (from, end) => { const b = Buffer.alloc(end - from); readSync(fd, b, 0, b.length, from); return b; }); } finally { closeSync(fd); }
    sent += 1; bytes += size;
  }
  // The plain data.json is what makes the link answer, so it goes after its other forms.
  for (const d of [...datas.slice(1), datas[0]]) { await put(d.rel, d.body.length, (from, end) => d.body.subarray(from, end)); sent += 1; bytes += d.body.length; }

  writeFileSync(bookOf(root), JSON.stringify({ ...readBook(root), [entry]: { token, at: new Date().toISOString() } }, null, 2));
  return { id, token, url: `${to}/api/glasses/replay/${token}`, sent, skipped, bytes };
}

/** Take a published copy down. The link stops working; the recording on this computer is untouched. */
export async function unpublishRecording(o: { root: string; id: string; to: string; key: string; send?: Send }): Promise<boolean> {
  const to = o.to.replace(/\/+$/, ""), book = readBook(o.root), entry = entryOf(o.id, to), token = book[entry]?.token;
  if (!token) return false;
  const send: Send = o.send ?? ((path, init) => fetch(`${to}/api/glasses${path}`, init));
  const r = await send(`/publish/${token}`, { method: "DELETE", headers: { "x-publish-key": o.key } });
  if (!r.ok && r.status !== 404) throw new Error(r.status === 401 ? "The hosted copy refused the publish key." : `The hosted copy answered ${r.status}.`);
  delete book[entry];
  writeFileSync(bookOf(o.root), JSON.stringify(book, null, 2));
  return true;
}

/** The links given out from this computer: which recording, where, and its address. */
export const publishedLinks = (root: string) => Object.entries(readBook(root)).map(([entry, v]) => { const [to, id] = entry.split(" "); return { id, to, url: `${to}/api/glasses/replay/${v.token}`, at: v.at }; });
