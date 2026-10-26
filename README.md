# Common Bench

A shared bench for small research labs: see who's using which instrument and when they'll be done, run your SOPs on paper or on a tablet, and keep a history of what everyone has tried.

> **This is an early prototype.** Some of it works well, some of it barely works, and none of it has been used in a real lab yet. I've tried to be clear below about which is which. If you're here to borrow ideas or code, welcome. Take what's useful.

## Why I made this

In school I worked in a chemical engineering lab, and later I did wet lab work at a battery company. The same few things drove me up the wall in both places.

**I never knew who was using the equipment, or when they'd be done.** You'd book a slot, walk over, and find someone who started late and still had an hour to go. Or they'd finished and left a mess, and there was no telling who.

**SOPs on paper are a pain.** I'd write up a protocol for myself, print it, carry it around the lab, write on it (and sometimes spill on it), then scan or type it back in. Electronic lab notebooks exist, but they ask you to stop and type at a computer, which is the one thing you can't do with gloves on.

**On a team, nobody knows what everyone else has tried.** Who's on this grant? What resources do we have? Is that part in stock? Has anyone run this experiment before, and who should I talk to about it? That knowledge lives in people's heads and old notebooks, and it leaves when they do.

Common Bench is my attempt at a simple tool for those three problems, one tab each.

## The three tabs

### Lab: who's using what

The room in 3D, with every instrument where it sits.

- **Who has it right now:** each instrument in use shows a small token with the person's initials.
- **A calendar per instrument:** see at a glance what's in use, booked, booked but sitting idle, or free.
- **Book by dragging** across free time. If you overlap someone, it tells you before you confirm.

*Not there yet:* the schedule and "in use" status are made-up data. Nothing reads from real instruments yet, so "when will they be done?" is only as good as the booking. Tracking who cleaned up after themselves isn't built.

### SOPs: protocols you can use at the bench

A protocol here is a small program, not a static document. Settings sit at the top (batch size, percentages, times), and every amount below is a formula, shown as proper math and worked through with your numbers. Change the batch from 50 g to 100 g and everything updates.

- **Print SOP** gives you a fill-in-the-blank paper copy. The computed amounts are printed faintly in each blank, so you only write over them if something changed. Every blank is labelled, so a scan could later be read back in.
- **Start trial** is for an iPad or lab computer: half the screen shows the lab (which instrument, what to grab, where to put it back), half shows the steps. You can type values or say them out loud. Overshoot an amount and everything after it rescales. Timers count down the waiting steps and chime when they're done, and every value is timestamped.
- **Edit SOP** is a block editor (a bit like Notion). You can also just ask it: "Set batch to 100" or "Add step: preheat oven before step 1." Every change becomes a version showing who made it, and a trial in progress stays on the version it started with.

*Not there yet:*
- **Voice transcription is the shakiest part.** It leans on the browser's speech recognition, and I haven't proven it holds up in a noisy lab with gloves on. I'm still figuring out whether it can work.
- **Scanning a filled-in paper copy back in isn't built.** The sheet is designed for it, but nothing reads it yet.
- **Trials and versions are saved only in your browser,** not on a server and not shared with your labmates.

### Projects: the team's memory

Where the shared history lives: research areas and what funds them, projects with their goals, the people involved, documents, what the team already knows, and open questions. Each experiment has a chart of everyone's trials, so you can see a few years of someone else's work in a minute.

There's an agent you can ask things like **"Has anyone tried this?"** It searches the team's trials, compares how people ran the same protocol, and answers with citations to specific trials. It can also propose the next experiment, but nothing is saved until a person approves it.

*Not there yet:* there's no real inventory, so "do we have this in stock?" only works on the made-up data. The agent needs your own Anthropic API key, and without one it can only replay a single recorded answer. I haven't narrowed this tab down to the few features that would really earn their place, and I'd rather say that than oversell it.

## Try it

```bash
cd app
npm install
npm run dev
```

Then open http://localhost:5173.

- **Data:** everything you see is synthetic, made by one seeded generator (`app/data/generate.ts`). It tells a small story about a dental resin team. Cooper searched for a better resin two years ago and gave up on one approach too early. Shreya joined later, and her few trials did better because of a degassing habit nobody wrote down. The app is built to help her find that out.
- **The agent:** for live answers, put `ANTHROPIC_API_KEY=...` in `app/.env.local`. Without it, the suggested question under Ask in the *Mid-diluent, high photoinitiator* experiment replays a recorded answer, so the main path works offline.
- **Running an SOP:** SOPs → Resin batch → Start trial. Add `?script` to the address to play a scripted voice run instead of using your microphone.

## What works and what doesn't

| Works today | Partly works | Not built yet |
|---|---|---|
| Instrument calendars, booking, clash warnings | Voice entry (browser speech recognition, untested in a real lab) | Real instrument data and "done" alerts from the instruments themselves |
| Formula-based SOPs, print copies, timers, timestamps | The agent (needs your key; one offline answer) | Scanning paper copies back in |
| SOP editor with versions and authorship | Saving (your browser only) | Inventory and stock levels |
| Charts of everyone's trials; cited answers | | Shared, multi-user storage; logins |

## How it's built

- **App:** React and Vite, with drop-in libraries for the hard parts: BlockNote (editor), KaTeX (math) and react-big-calendar (calendars).
- **Server:** a small Hono server that also serves the app.
- **The agent:** the Claude Agent SDK, with tools that search trials, read instrument logs and diff protocols. The two tools that change anything wait for a person to approve.
- **Numbers always come from code,** never from the model. Quick things (SOP edits, bookings, spoken values) are parsed locally, so they're instant, free and work offline.
- **Measured:** `app/evals/` has the evaluations I ran, including how the agent holds up as the number of trials grows.

More detail: `PRIMITIVES.md` (the ideas underneath), `ROADMAP.md` (how I'd pilot it with real labs), and `app/DATA_NOTES.md` (the synthetic data).

## Where it could go

Open ideas are tracked as GitHub issues:
- **#9:** save SOPs and trials to a server, with real version control and authorship.
- **#10:** let connected instruments drive the timers, and make availability live for the whole lab.
- **#7:** schedule a run, book its instruments, and send calendar invites.
- **#8:** rearrange a protocol so no one stands idle while an instrument runs.

If you work in a lab and any of this rings true (or sounds useless), I'd love to hear which parts. That's the part I haven't figured out yet.

MIT licensed.
