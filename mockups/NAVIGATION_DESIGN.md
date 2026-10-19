# Navigation design: converging on the layout

The working notes behind `navigation.html`. Each surface lists the options considered, the one chosen and why. After that come the whole-system passes that changed earlier choices. The design is converged when a pass changes nothing.

## Design drivers (added in round 4)

The end product of the work is a deliverable: a manuscript in academia, or a process, recommendation or formulation in industry. Every feature has to serve at least one of these three drivers, or it's cut:

1. **Intuition without bias.** Help people quickly build a feel for what's happening, without letting outliers or results that aren't statistically significant push them away from the best protocol.
2. **Evolution you can share.** Make it easy to record how the work changed, and why, and to pass that on to others.
3. **Deliverables in one step.** When the experiments finish, everything gathered along the way (questions asked, insights, protocol changes) can be drafted into a report, or recalled by whoever is writing it. The writing itself is out of scope: Cooper already has a tool for that. This app only hands off structured, cited material to it, alongside literature-review MCPs.

| Feature | 1 Intuition | 2 Evolution | 3 Deliverable |
|---|---|---|---|
| Research thrusts and project pages (goal, what we know, open questions) | ✓ (open questions set what gets asked next) | ✓ | ✓ (goal and deliverable are named up front) |
| Experiment chart, with the project's other experiments faded in behind | ✓ | | |
| "How it ran" step tiles and per-step logs | ✓ | ✓ | ✓ (methods section) |
| Scoped Ask | ✓ | | ✓ (questions asked feed the draft) |
| New experiment (upload, write or copy an SOP) | | ✓ | ✓ (methods) |
| "Send to report draft" (future) | | | ✓ |
| Lab view and instrument panel | ✓ (provenance) | ✓ | |
| Outliers lens | ✓, only if it doesn't bias. Still an open question; see below. | | |

## Objectives

1. **Legible in about 10 seconds.** Navigation screens show only what you need to choose where to go. Information screens show only what you need for the next action.
2. **Few clicks for frequent jobs.** Rare and admin-only actions live behind a menu.
3. **Show the team's search, and its gaps.** Outliers and SOP deviations are *visible*, never *announced*. The person decides what to look at.
4. **Connect the bench to the work.** A trial and the instruments it used are one step apart, in both directions.
5. **People and credit are visible.** Person colors are used only for people.
6. **Cheap to build** in the existing React app.

**"Visually harmonic"** means, specifically:

- **One spatial model.** The same kind of thing always appears in the same place.
- **Continuity.** Selecting something never moves or resizes what you were looking at.
- **One focal point** per screen.
- **Mirrored halves.** Projects and Lab are built from the same parts.
- **Shared visual language.** An instrument looks the same everywhere it appears.

## Round 1: surface by surface

### 1. Top-level navigation

| Option | Notes |
|---|---|
| **A. Centered Projects/Lab toggle, plus a round search button** | Two destinations, both always one click away. Big target (Fitts's law). |
| B. Left sidebar (the Linear/Notion style) | Built for 5+ destinations. With two, it wastes width the chart and panel need. |
| C. One zoomable canvas, from the lab down to a project | Visually striking, but it hides where you are, and it's expensive to build. |

**Chosen: A.**

### 2. Projects home

| Option | Notes |
|---|---|
| A. Card grid for everything | Easy to recognize, but titles in a grid read in a zigzag, and it gets noisy past about 12 cards. |
| B. Rows for everything | Scans well and scales, but your own projects stop standing out. |
| **C. Cards for "Yours", rows for "Rest of the lab"** | The two sections do different jobs: *resume* (recognize your own work quickly) and *browse* (scan many titles). |

**Chosen: C.** Archived projects stay behind a link.

### 3. Card click: overview panel, or open directly?

| Option | Notes |
|---|---|
| A. Click opens an overview panel, → opens the project | Two ways to do the same thing, and most visits are "resume my work," which pays for the extra click every time. |
| **B. Click opens the project; the overview lives in the project's right panel** | Removes a layer and the duplicated information. Browsing someone else's project costs one Back. |
| C. Preview on hover | Doesn't work on touch, and flickers as the mouse crosses the grid. |

**Chosen: B.**

### 4. Project view layout

| Option | Notes |
|---|---|
| A. Chart and table, an Ask column, and a trial panel that covers the Ask column | Ask disappears whenever a trial is open. Two detail patterns compete for the same space. |
| **B. Chart and table on the left; one fixed right panel showing whatever is selected** | Nothing selected: the project overview plus "Ask about this project." Trial selected: the trial plus "Ask about T09." The chart never resizes. Ask is one component, scoped to the selection. |
| C. Chat bar at the bottom, trial in a popup | Chat becomes the focal point and competes with the chart. |

**Chosen: B.** The scope shows as a chip, "Asking about: T09 ✕". Clearing it widens the question to the whole project. Questions like "has anyone…" widen further on their own, through a search tool.

### 5. Trial detail

| Option | Notes |
|---|---|
| A. Tabs: Results, SOP, Logs | Hides the most important part (the deviations) behind a tab. |
| B. One scrolling panel with sections | Better, but the SOP table is still a wall of text. |
| **C. One scrolling panel, with the SOP drawn as a row of process steps** | One small tile per step, using the same instrument tiles as the Lab view. Steps that differ from the SOP get a dashed outline. Clicking a step shows its log lines and where that instrument is in the room. |

**Chosen: C.** Logs are no longer a separate tab; each step carries its own log lines. The instrument visuals match across both halves of the app.

### 6. Marking outliers on the chart

| Option | Notes |
|---|---|
| **A. A dashed ring around the point** | Visible without any text. The reason appears when you select the trial. |
| B. Ring plus an "outlier" label on the chart | Adds reading to the chart. |
| C. A shaded trend band | Hard to read on a two-axis trade-off chart. |

**Chosen: A.**

### 7. Lab view

| Option | Notes |
|---|---|
| **A. Floor plan by default, with a 3D toggle** | The floor plan is easy to read and easy to click. |
| B. 3D by default, with a floor-plan minimap | Engaging, but small instruments hide behind each other, so it's harder to click. |
| C. A list view | Search already finds instruments by name. |

**Chosen: A.**

### 8. Linking a trial to an instrument

| Option | Notes |
|---|---|
| A. Always jump to the Lab view, with a back chip | You lose your place every time you only wanted to look. |
| **B. Show a preview in the panel: a small floor plan with the instrument highlighted, plus "Open in lab"** | Looking doesn't move you. You only change views when you choose to, and then the back chip brings you back. |
| C. A split screen | Too cramped at laptop width. |

**Chosen: B.** Going the other way (instrument to trial) stays a jump, because you're deliberately switching to the Projects side.

### 9. Search

**Chosen:** the overlay you open from the round button or ⌘K, as now. It's the standard pattern (Linear, Raycast), so there's nothing new to learn.

### 10. Admin tools

| Option | Notes |
|---|---|
| A. A gear icon in the Lab header | Puts admin chrome on a daily-use screen, and Projects will need settings too (members, grants). |
| **B. The avatar menu at the top right** | Holds Lab settings, People and Connections. It's where people expect settings to be, and it applies to both halves. |

**Chosen: B.**

## Round 2: whole-system pass

- **Every information screen uses the same layout: main view plus right panel.** The project view is chart and table plus panel. The Lab view is floor plan plus panel. **Changes:** the Lab view gets the same panel even when nothing is selected (lab summary plus "Ask about the lab"), and every panel ends with the same scoped Ask box. The Projects home has no panel; it's a navigation screen.
- **One selection model.** Clicking selects something and the panel follows. Esc clears the selection. A selection never resizes the main view.
- **Color conflict found.** Amber was being used for both "○ passes checks, too thick" and "unusual" (outliers, SOP deviations). **Change:** "unusual" is now a *dashed ink outline*, never a color. That leaves color with three jobs: people, ✓/○/✕ status, and how an instrument is logged.
- **Click counts after the changes:**

| Job | Before | After |
|---|---|---|
| New member orientation | 2 | 2 |
| Has anyone tried this? | 3 | 3 |
| Inspect an outlier | 7 | 3 (open the project, click T09, click the dashed step) |
| Is the printer free? | 3 | 3 |
| Add an instrument | 3 | 3 (avatar, Lab settings, Add) |

## Round 3: check

- Do the Yours cards and Rest rows clash visually? No. They use the same title style and avatar stack; only the container differs.
- Does the always-on panel squeeze the chart? At laptop width, the chart keeps about 720 px. On a phone, the panel becomes a sheet that slides up from the bottom.
- Is there any duplicated way to reach something? The trial panel can be reached from the chart, the table and search. All three set the same selection, so the result is identical.

Nothing changed in round 3. **The design has converged.**

## Round 4: Cooper's review (2026-10-18)

- **Cards were too low-level.** **New hierarchy:** thrust → project → experiment → trial, modeled on academic lab websites, which are organized around a few large research thrusts.
  - **Home:** your projects as cards, then each research thrust as a section listing its projects as rows. Closed thrusts sit behind a link.
  - **Project page (new middle layer):** the goal and what it delivers, then *What we know* and *Open questions* (each pointing to the trials or ledger entries behind it), then the experiments. The known and unknown items limit which questions are worth asking next. The right panel holds why the project exists, people, documents, recent activity, "Send to report draft" and Ask.
  - **Experiment view:** the existing chart and table. The chart draws all of the project's trials, with this experiment solid and the others faded, so a single experiment is never shown out of context.
- **New experiment card** in the first slot of the Experiments grid: upload an SOP, write one step by step, or copy a protocol the lab already runs.
- **Outliers are now off by default.** An "Outliers" toggle on the chart shows them, so the person has to ask to see them. This is still unresolved: whether to show outliers at all, and how, given driver 1. Options to test:
  - (a) Only when asked: the toggle, or a question in Ask.
  - (b) Show significance, not outliers: draw uncertainty (error bars, replicate spread) so a single result *looks* like a single result.
  - (c) Replicate prompts: a trial that is both alone and decisive suggests repeating it, rather than being flagged.

  Option (b) serves driver 1 most directly.
- **SOP deviations keep the dashed outline.** They're a factual comparison against the written SOP, and they only appear inside an opened trial.

### Flags (not solved, by choice)

- **The resin example still isn't landing.** Inside its thrust it has siblings now, but it still reads as an isolated example with a single chart. Revisit after the high-fidelity pass.
- **How "unusual" is displayed** (above).

## Deferred

- **Design-system pass:** logging-source colors, how "not logged" is styled, and the instrument tile shapes.
- **GitHub issues:** booking; importing a scan and adding instruments; lab-wide Ask; an "About" history for each project linked to grant reports.
