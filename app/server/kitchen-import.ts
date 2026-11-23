// The kitchen SOPs (src/data/chickenRub.ts), added to whichever browser opens /api/glasses/import/<id>.
// They are not seeded with the lab's own SOPs; this page puts one into the browser's SOP list and opens it.
// Its own file so a hosted copy of the app can offer it without starting the glasses server (server/glasses.ts).
import { Hono } from "hono";
import { KITCHEN } from "../src/data/chickenRub.ts";

export const importPage = (id: string): { status: 200 | 404; body: string } => {
  const sop = KITCHEN[id];
  if (!sop) return { status: 404, body: `No such SOP to add. There are: ${Object.keys(KITCHEN).join(", ")}` };
  return { status: 200, body: `<!doctype html><meta charset="utf-8"><title>Adding ${sop.title}…</title><script>
  const p = ${JSON.stringify(sop).replace(/</g, "\\u003c")};
  const KEY = "common-bench:sops:v1";
  let list = [];
  try { const v = JSON.parse(localStorage.getItem(KEY) || "[]"); if (Array.isArray(v)) list = v; } catch (e) {}
  const d = new Date();
  p.uploaded = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  localStorage.setItem(KEY, JSON.stringify([...list.filter((x) => x && x.id !== p.id), p]));
  location.replace("/sops/" + p.id);
</script>` };
};

/** What a hosted copy serves under /api/glasses: the SOP import, and a plain "not here" for the rest. */
export const hostedGlasses = new Hono();
hostedGlasses.get("/import/:id", (c) => { const r = importPage(c.req.param("id")); return r.status === 200 ? c.html(r.body) : c.text(r.body, 404); });
hostedGlasses.all("*", (c) => c.json({ error: "The glasses run on a computer at the bench, not on this hosted copy." }, 404));
