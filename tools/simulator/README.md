# TriCaster simulator

A fake TC1 that runs on your own laptop, so every phase can be built, tested and practiced without the real switcher.

```bash
npm install        # once, from the repo folder
npm run simulator
```

It opens the simulator page at <http://127.0.0.1:8080/sim/>. Press Ctrl+C in the terminal to stop it.

## What it pretends to be

It answers the same way a TriCaster does, so the show app's real TC1 code is what gets tested:

| TriCaster interface | Real TC1 | Simulator |
| --- | --- | --- |
| Web API: `/v1/version`, `/v1/dictionary?key=…`, `/v1/shortcut?name=…&value=…` | port 80 | port 8080 |
| Change notifications: WebSocket `/v1/change_notifications` | port 80 | port 8080 |
| State stream: `<register name="NTK_states"/>`, `<shortcut … />` | port 5951 | port 5951 |

It identifies itself as **TSTV Simulator**, both in `/v1/version` and in an `X-TSTV-Simulator` header. The show app's live-mode lock uses this to tell the simulator and the real TC1 apart.

## What it simulates

- Program and preview, with take and auto (transitions show as cuts)
- 8 inputs, with cameras 1–3 named
- DSK 1–4: source, on air and off air. DSK 2 starts with DDR 2 as its source.
- M/E 1–4. M/E 2 is the green screen: Camera 3 keyed over GFX 1.
- DDR 1 and DDR 2 playlists that play in real time and stop at the end of a clip; GFX 1 and GFX 2 stills
- Recording start and stop, and macros run by name
- A tally that shows what's really on program, including DSK and M/E layers

## The simulator page

The page shows only what TSTV uses. The fake TC1 behind it still has every input, M/E and player listed above, so the show app gets tested against a full switcher.

- **Program monitor and On air now** show what's on air: the camera or green screen, DSK 2 with its clip time, recording, and whether a show app is connected.
- **Buttons** act like the TD at the panel:
  - Camera 1–3
  - Green screen (M/E 2 to air)
  - DSK 2 on and off
  - the DDR 2 playlist, with Play and Stop
  - Record
- **What the show app sent** lists, newest first and in plain English, every command that arrived over the network, with the raw command name underneath. Your own clicks don't appear here.
- **Practice problems** is folded away at the bottom. It fakes trouble on demand: cable unplugged, ignored commands, slow replies, a LivePanel password, and making the DDR 2 clip end early.

## Names that are still guesses

The names for program, preview, DSK, DDR play and record come from Bitfocus Companion and node-tricaster. Bitfocus tested those on other TriCaster models, not a TC1.

A few names are the simulator's own guesses, listed in `GUESSED_NAMES` in [`src/profile.ts`](src/profile.ts):

- `ddr2_select_index`, which jumps to a playlist item counting from 0
- `ddr2_clip_name`
- `record_start`

The page tags them **guessed name**. Once the probe results from the real TC1 are in, the simulator gets updated to match.
