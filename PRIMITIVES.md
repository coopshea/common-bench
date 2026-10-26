# Primitives: how Common Bench turns runs into a lab that keeps improving

Draft, 2026-10-24. This replaces "a team notebook with many screens" as the core idea.

## The idea in one paragraph

Scientists hate data entry and love paper because paper never makes them switch context. So the product starts at the bench: paste a protocol, and it becomes a hands-free lab mate that reads steps aloud, keeps the arithmetic live and records what you say. Every run leaves a structured record of planned vs. actual as a byproduct. Pool those records and the lab gets insight (collisions, technique differences, DoE) without anyone doing extra work. Connect instruments one at a time and steps move from human to machine. The same protocol carries the lab from 0% to 100% automated.

## The three primitives

### 1. Protocol: a recipe that is data

- **What it is:** ordered steps with typed fields: material, amount, unit, instrument, setpoint, duration, and a free note.
- **Where it comes from:** a pasted paper, an SOP or a past run.
- **The rule:** when the source is ambiguous ("stir overnight"), it flags the field and asks. It never guesses.
- **Each step has an executor:** `human` or `machine`. This tag is how automation grows (below).

### 2. Run: one execution of a protocol

- **What it is:** a protocol plus what actually happened, step by step: planned value, actual value, who, when, photos.
- **How it's made:** in the bench view, hands-free. Nobody fills it in afterwards.
- **What it replaces:** the paper printout, the calculator, the transcription afterwards, and today's hand-entered trial row.

### 3. Registry: what exists and where

- **What it is:** instruments, consumables, bottles and lots, each with a location and an owner.
- **How things get in:** first mention in a protocol, a photo of a label or nameplate, or the Lab page (below). A person confirms each entry.
- **Instruments have three levels:**
  - **Registered:** the lab knows it exists and where it is. Target: under 5 minutes.
  - **Logged:** its data flows in by itself (file export, serial port, API).
  - **Controlled:** a run can send it a setpoint or program.

## The capture device (bench kit)

A placeholder for whatever hardware wins. It only needs four things:

| Part | Job |
|---|---|
| Audio in | "Next step", "I added 0.4 g", "check my work" |
| Audio out | Reads the step aloud and confirms each value |
| Screen | The current step, the live calculator, the next two steps |
| Camera | Takes photos, guesses what's in them from the current step, then labels, timestamps and files them under the person and project |

**The bench kit is the driver for every dumb device.** The vacuum chamber has no data port, but the degas step asks "how long?" and the person answers. The person is the sensor until the device is connected.

## The loop: every run makes the next one better

```
paste protocol ─► run it at the bench ─► run record lands
      ▲                                        │
      │                                        ▼
  propose next run ◄── pooled runs ◄── registry updated
  (DoE, collisions,                    (stock used, lot,
   technique diffs)                     instrument time)
```

Nothing in the loop asks for extra effort. Joining the network means running a protocol from the bench kit.

## What each primitive unlocks

| You get | Needs | Extra cost to the user |
|---|---|---|
| Printable or bench guidebook from a paper | Protocol | none |
| Live calculator (0.5 instead of 0.6 → remaining amounts update) | Protocol + Run | none (deterministic code, not the model) |
| "You're missing X; Building 4 has one" | Protocol + Registry | none |
| Pre-run stock check and a reorder approval card | Protocol + Registry | one approval |
| Collision alert ("95% like T09, two years ago") | Protocol + past Runs | none |
| Deviations from the SOP | Run | none |
| Hidden technique differences (the degassing story) | Run | none |
| Lot numbers on every trial | Run + Registry | one scan or photo |
| Lot effects, instrument drift | pooled Runs + Registry | none, later |
| Search map, next-experiment proposals | pooled Runs | none |
| Methods sections, progress reports | Runs | none |
| Automation, step by step | Run steps tagged `human` / `machine` + controlled instruments | one integration per instrument |

## Inflection points

1. **Run 1, one person.** The bench kit has to beat paper alone. If it doesn't, nothing else happens.
2. **About 5 runs of a protocol.** Personal history: "last time step 4 went cloudy."
3. **A second person runs the same protocol.** Comparison, technique differences and collision alerts switch on. Network effects start at **two people per protocol**, not a whole department.
4. **Enough varied runs to fit a model.** A quadratic model in *k* factors needs (k+1)(k+2)/2 runs: 10 runs for 3 factors. DoE switches on, and the tool can say "3 more runs and I can propose the next one."
5. **Stock tracked.** Reorders become one approval.
6. **Instruments logged, then controlled, one at a time.** Steps move from `human` to `machine`.
7. **Many labs.** "Someone a building away has one." Comes with scale; don't lead with it.

## The automation gradient

The protocol never gets rewritten. Only the executor of each step changes:

| Furnace step | Instrument level | What the person does |
|---|---|---|
| Set 180 °C for 2 h, say the reading at the end | registered | sets it, reads it aloud |
| Same | logged | sets it; the curve logs itself |
| Load sample, say its ID | controlled | loads it; the run pushes the program |

## North-star metric

**The share of a run's values captured without anyone typing.** Voice gets it off zero. Scans and photos push it up. Each connected instrument pushes it up again. At 100% the lab is automated. The same number measures adoption today and progress toward the long-term vision.

## Evals

**Make or break (measure first):**
- **Voice to field:** right value, right field, right unit, in noisy lab audio. Latency under about 2 s, or people go back to paper.
- **Paper to protocol:** step and quantity accuracy against hand-built gold protocols, and **ambiguity recall** (did it flag "overnight" instead of guessing).
- **Photo labelling:** the right step, person and project on a first guess; fully wrong labels are counted separately, because a wrong label is worse than none.
- **Registering an instrument:** minutes from photo to entry.

**Insight (once runs exist):**
- **Collision alerts:** precision over recall. A false alarm costs more than a miss.
- **Next-experiment proposals:** regret against random and one-factor-at-a-time baselines on synthetic landscapes. The seeded generator is this benchmark.

**Automation:**
- **Mid-run deviations:** does it continue, ask or stop correctly.

## Where it lives in the app

- **Bench view (new):** the protocol/SOP view. Paste a protocol, then run it hands-free. This is the minimal addition.
- **Lab page (existing 3D room):** registering instruments. Photograph or pick a bench, confirm the entry, set its level (registered, logged, controlled). Registered instruments appear on the bench models; connected ones animate.
- **Desk view (existing screens):** the map, trials and agent. They now read run records instead of hand-entered trials.

## Is the bench view really the minimal addition?

Mostly. It needs two thin supports:
- **A registry stub:** whatever a protocol names gets an entry on first mention. The full Lab-page onboarding can come later.
- **The run record as the trial schema:** today's trial rows have to become runs (planned vs. actual per step), so the desk view's insights come from bench data. In the demo, the seeded generator writes runs instead of trials.

## Drawbacks and risks

**Adoption**
- **It has to beat paper on day one.** One misheard value, a lag or a dead battery, and people go back to paper for good.
- **Device placement is a smaller risk than it looks.** Most labs already keep a laptop next to complex or hazardous instruments, so a screen at the bench is normal. Gloves and noise still matter for touch and audio.
- **Talking aloud in a shared room is awkward,** and several people talking at once is hard for the audio.

**Data quality**
- **Self-reported values aren't measurements.** "Twelve minutes" may be a guess. Each value should carry its source (spoken, scanned, instrument) so analysis can weight it.
- **Wrong auto-labels are worse than no labels.** The camera's guess has to be confirmed, at least until its accuracy is measured.
- **Paper to protocol can invent quantities.** The flag-don't-guess rule has to be tested, not assumed.

**Science**
- **Protocols as data can be too rigid.** Real work improvises. Every step needs a free note and an "off-script" path, or exploratory work moves back to paper.
- **Collision alerts can kill good ideas.** "95% similar, already tried" is how Cooper's high-diluent region got abandoned. Alerts should show what was learned and what's still uncertain, not say "don't."
- **Matching "the same protocol" is hard.** Labs fork protocols constantly, so per-protocol network effects depend on fuzzy matching.

**People**
- **Run records can feel like surveillance.** The data that gives credit can also assign blame, or let a PI monitor students by the minute. **Design rule: surveillance must be hard by construction.** Teammates see results and findings, not step timings or minute-by-minute activity. There's no per-person activity dashboard, and raw run detail stays with the person who ran it unless they share it.
- **Cameras capture labmates and confidential material.** Photos need a clear scope and an easy delete.

**Integration and cost**
- **"Under 5 minutes" holds for registering an instrument, not for connecting it.** Logging and control are still per-device work, from an afternoon to weeks depending on the interface.
- **Ordering hits procurement rules.** Universities and companies have approved vendors and purchase orders, so auto-reorder stays an approval card that drafts the request.
- **Always-on audio and vision costs money.** Cheap models for capture, the large model only for questions and analysis.
- **Regulated labs need validated electronic records** (Part 11-style controls in medical device work). That's a large barrier for industry pilots and should be a later phase. Cooper has no direct experience here, so it needs a discovery conversation with someone who runs a regulated lab before any claims.
- **Lab data leaving the building** raises IP and ownership questions, especially across labs.
