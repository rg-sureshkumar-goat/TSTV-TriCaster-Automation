# TriCaster simulator

A fake TC1 that runs on your own laptop, so every phase can be built, tested and practiced without the real switcher. It's set up like TSTV's real TC1, as recorded by the probe at the studio on Oct 28, 2026 (see [docs/TC1-FINDINGS.md](../../docs/TC1-FINDINGS.md)).

```bash
npm install        # once, from the repo folder
npm run simulator
```

It opens the simulator page at <http://127.0.0.1:8080/sim/>. Press Ctrl+C in the terminal to stop it.

## What it pretends to be

It answers the way TSTV's TC1 does, so the show app's real TC1 code is what gets tested:

| TriCaster interface | Real TC1 | Simulator |
| --- | --- | --- |
| Web API: `/v1/version`, `/v1/dictionary?key=…`, `/v1/shortcut?name=…&value=…` | port 80 | port 8080 |
| Change notifications: WebSocket `/v1/change_notifications` | port 80 | port 8080 |
| State stream: `<register name="NTK_states"/>`, `<shortcut … />` | port 5951 | port 5951 |

It also copies the real TC1's quirks:

- Notifications end with a null character, and some name a single state (`state.ddr2_play`).
- Asking for a data name it doesn't have drops the connection.
- States use the TC1's own names, values and source numbers (`main_a_row_named_input = V1`, `ddr2_select_clips = 3|`, and so on).

It identifies itself as **TSTV Simulator**, both in `/v1/version` and in an `X-TSTV-Simulator` header. The show app's live-mode lock uses this to tell the simulator and the real TC1 apart.

## How it's set up, like TSTV's TC1

- **Program runs through M/E 1.** Cameras switch on M/E 1's A row.
  - Camera 1 (prompter) and Camera 2 (prompter) are inputs 1 and 2.
  - Camera 3 (wide) is input 3.
- **The green screen is M/E 2:** a camera keyed over GFX 1. Any of the three cameras can be keyed. Taking it to air switches program to M/E 2.
- **DSK 2 shows DDR 2 ("B") with AutoPlay:**
  - Taking DSK 2 on plays the cued clip.
  - Taking it off stops the clip and cues the next one.
  - Pressing Play takes DSK 2 on.
  - When a clip ends by itself, it stops and **DSK 2 stays on**.
- **The DDR 2 practice playlist** starts each block with the break clip "TSTV Ident 2022 News", then the block's graphics and clips.
- **Other sources:** GFX 1 holds the green-screen backgrounds, DSK 3 is the bug (buffer 11), and DDR 1 ("A") is empty. There's also recording, tally, and the "what's on air" summary (`program_tally`).

## The simulator page

The page shows only what TSTV uses. The fake TC1 behind it has all 16 inputs, 4 M/Es, 4 DSKs and every player.

- **Program monitor and On air now** show:
  - the camera, or the green screen with its keyed camera,
  - DSK 2 with its clip time,
  - recording,
  - whether a show app is connected.
- **Buttons** act like the TD at the panel:
  - Camera 1–3
  - Green screen, with a choice of which camera is keyed
  - DSK 2 on and off
  - the DDR 2 playlist, with Play and Stop
  - Record
- **What the show app sent** lists, newest first and in plain English, every command that arrived over the network, with the raw command name underneath. Your own clicks don't appear here.
- **Practice problems** is folded away at the bottom. It fakes trouble on demand: cable unplugged, ignored commands, slow replies, a LivePanel password, and making the DDR 2 clip end early.

## Names that are still guesses

The probe only reads, so **command** names on the real TC1 are confirmed in live mode during Phase 5. The state names are real. The commands the simulator accepts follow Bitfocus Companion where it has them (`main_a_row`, `v1_a_row`, `main_dsk2_take`, `ddr2_play`, `record_toggle`).

A few are the simulator's own guesses, listed in `GUESSED_NAMES` in [`src/profile.ts`](src/profile.ts):

- `ddr2_select_index` and `ddr2_select_clips`, which cue a playlist item counting from 0
- `main_dsk2_select`
- `record_start` and `record_stop`

The page tags these **name not confirmed on the TC1 yet**.
