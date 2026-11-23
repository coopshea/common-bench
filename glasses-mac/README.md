# Bench Glasses (Mac)

A small Mac app that drives Mentra Live glasses directly over Bluetooth, with no phone. It is the remote control
for the glasses; Common Bench (`../app`) does the rest.

```
glasses ◀──Bluetooth──▶ Bench Glasses (this app) ──asks every 2 s──▶ Common Bench server (:8787)
glasses ──Wi-Fi, RTMP──▶ this Mac (:1935) ──▶ live view, recording, camera log, speech (see ../app/server/glasses.ts)
```

## Run

```bash
bash run.sh
```

The first run fetches Mentra's Bluetooth SDK source (only that folder of their repository, `dev` branch, where
native macOS support lives) into `vendor/`, builds, and opens `build/Bench Glasses.app`. Quit the app before rebuilding.

## First time

1. Allow Bluetooth when macOS asks.
2. Turn the glasses on, with no phone connected to them. **Scan**, choose them, **Pair**. After that the app
   reconnects to them by itself each time it opens.
3. **Find networks**, choose the network this Mac is on, type its password, **Join**. The glasses send video over
   Wi-Fi, so they need to reach this Mac.

Then open a trial in Common Bench (SOPs → a protocol → Start trial). The Glasses card in the corner shows Ready;
**Record** starts the camera. The glasses' own button does the same: short press to start or stop, long press to
mark the moment.

## Afterwards

Each recording is a folder under `../app/recordings/`: the video, the frames the camera log kept, and `log.jsonl`
(what was seen, said, answered and recorded, each with its time). **Replay** in the Glasses card, or
`http://localhost:5173/api/glasses/replay` for the latest one, plays the video with the steps and the log filling in
at the moments they happened.

## Before a shoot

```bash
cd ../app && npm run glasses:check
```

Says what's missing: the tools, the speech model, the glasses' connection and battery, whether they share a network
with this Mac. It starts nothing. To have a trial ready, open `http://localhost:5173/api/glasses/import/fizz-foam`
(or `chicken-rub`, `rub-1lb-chicken`) in the browser you'll run the trial in: it adds that SOP to that browser.

## Working through a recording again

```bash
cd ../app
npm run reprocess                      # the latest recording
npm run reprocess -- <recording id>
npm run reprocess -- --video clip.mov --sop fizz-foam --started 2026-11-22T19:30:00   # any video, a phone's included
```

From the video alone it works out the clock, what was said (the same sentence cutting and Whisper settings as live),
the values, when each step ran, and a frame for every measurement, then prints a check for each stage and how it
compares with the live log. Everything goes in `recordings/<id>/derived/`; the live log is never changed. Nothing in
it uses the network. Stages and their code:

| Stage | What it does | Where |
|---|---|---|
| Clock | video time ↔ time of day, kept in `session.json` | `server/glasses-reprocess.ts` |
| Speech | sound → sentences → text | `server/glasses-speech.ts` (shared with live) |
| Values | a sentence → amounts, notes, timers, done | `src/lib/benchApply.ts`, `src/lib/benchSpeech.ts` |
| Steps | start, end, waiting and doing for each step | `derived/segments.json` |
| Frames | the picture as each value was said | `derived/moments/` |
| Replay | the record drawn on the video | `server/replay.html` |

Replay options, added to the replay's address: `?overlay` draws the record on the video (for a screen recording),
`&cut` plays only the seconds around each measurement, note, timer and photo, then holds on the closing card
(`&cut=6,3` sets the seconds before and after), `&derived` uses the rebuilt log, `&camera=0` hides what was seen.
Space plays, the arrow keys jump five seconds, M mutes.

`npm run test:phrases` includes two whole spoken trials (the chicken rub as it was really said, and a fizz foam trial
with a timer, a note and a photo) run through the same rules, with no glasses.

Not done yet: looking at a video's pictures again afterwards (an imported video has no camera log), cropping a frame
to the scale's display, comparing two trials step by step, and a result on a chart. `src/lib/benchApply.ts` is a
second copy of the trial view's rules for what a sentence does; the trial view still uses its own.

## What it needs from Common Bench

- The server running on this Mac (`npm run dev` in `../app`). The app reads the key the server keeps at
  `../app/recordings/.key`.
- On this Mac: `mediamtx` and `ffmpeg` (video), and for speech `whisper-server` (Homebrew `whisper-cpp`) plus a
  model file named in `GLASSES_WHISPER_MODEL` in `../app/.env.local`.

## Limits

- Bluetooth range: the glasses follow this Mac's commands, so they need to stay within Bluetooth reach of it
  (roughly the same room). To roam further, use the phone app in `../glasses` instead: same Common Bench side.
- A sleeping Mac drops the link; it reconnects after wake.
- Mentra's macOS support is unreleased source, so expect rough edges. `rm -rf vendor && bash run.sh` updates it.

## After a recording: nothing to do

When a recording stops, the server finishes it by itself (`server/glasses-finish.ts`). About a minute later Finder opens `app/recordings/<id>/export/` with:

- `key-moments.mp4`: only the seconds around each recorded value, timer, note and photo, with the record drawn on the footage, ending on the closing card. This is the one to share.
- `full.mp4`: the whole recording with the same overlay.
- `card.png`: the closing card on its own.
- `finish.log`: the second pass over the sound and its checks. If that pass disagrees with the live log about what was recorded, `key-moments-rebuilt.mp4` is made from it as well.

The closing card shows what was measured, what the SOP works out from it (the SOP's `calc`), aim against made, and one row for each trial of the same SOP recorded in the last day.

By hand: `npm run finish -- <id> --open`, or `npm run export -- <id> --cut=8,4` for more seconds around each moment. Set `GLASSES_AUTOFINISH=0` to turn the automatic run off. The app has to be running (`npm run dev`); the export draws the overlay in a windowless Chrome and lays it on with ffmpeg, so nothing is screen-recorded.

## Rehearsing without the glasses

A video file can stand in for the glasses: with a trial open, something has to report in as the phone (`POST /api/glasses/device/poll` with the bench key every 2 s), then press Record and send the file to the address the poll returns, e.g. `ffmpeg -re -i clip.mov -c:v libx264 -tune zerolatency -c:a aac -f flv rtmp://127.0.0.1:1935/live/<key>`. Everything after the glasses runs as it would live. This is how the path was tested on 2026-11-22; real glasses add their own start-up delay and microphone echo, which a file does not.
