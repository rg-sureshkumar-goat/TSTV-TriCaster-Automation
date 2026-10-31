# Phase 5: the real TC1

Phase 5 connects the show app to TSTV's real TriCaster TC1. Decisions (RG, Oct 30, 2026):

- **Graphics go to the TC1 over NDI from the laptop.** The graphics drive stays on the laptop, nothing is copied to the TC1, and the TC1 needs no Windows login. The app plays each graphic and sends it to the TC1's **input 4** as a live NDI source, **TSTV Show App**, and the TC1 keys it with **DSK 2**.
- **Music comes from the laptop too**, mixed with the graphics' sound, through the one Sound fader. The TC1's Sound player isn't used.
- **In live mode the Program box shows the TC1's real program**, and the camera boxes its camera feeds.
- **Record saves the program, picture and sound, on the laptop.**

## What's new

- **Live mode, with three safety locks:**
  - The app always opens on the **simulator**, and never remembers live mode.
  - **Run the real TC1…** (next to the SIMULATOR badge) asks for a confirmation. Then a red **LIVE: TC1** bar stays across the top, with **Back to the simulator**.
  - In live mode the app talks only to a switcher that says it's a **TriCaster TC1**; on the simulator, only to the simulator.
- **Live mode needs the laptop on the TC1's cable.** The app finds the TC1 at its last address (169.254.193.52), or by the NDI feeds it announces on the cable. It keeps NDI on cable connections only, never on campus Wi-Fi.
- **The playout** (in the background) plays each graphic at the TC1's size (1280×720, 29.97 frames a second), with its see-through parts and sound, and sends it to input 4. It works like DDR 2 for the cue rules: the cue engine cues a clip, plays it, stops it, and hears when it ends. When one clip replaces another, it cuts straight from one to the next (so back-to-back teases may finally work). When DSK 2 goes off, input 4 is cleared. A clip that ends holds its last frame.
- **Cameras and DSK 2** are commands to the TC1, as on the simulator: cameras on M/E 1's A row, DSK 2 on and off.
- **The TC1's feeds in the app:** the camera boxes show feeds (1)–(3), and the Program box the program (MIX 1), picture only.
- **Record** (under Pause automation, live mode only) asks where to save, then records the program as `Show_Episode_Date.mp4`; click again to stop. The file is written in pieces, so it plays even if the laptop stops partway.
- **The Sound strip** in live mode shows the level of the sound going to the TC1, and its fader sets it.
- **The app is called RiGster (RG, Oct 30, 2026)**, in its window and at the top left, and on the website (the episode's button is now **RiGster key**). Its NDI sources keep their names, so the TC1 needs no changes.
- **Camera cues (RG, Oct 30, 2026):** the script editor has a **Cameras** row (one amber button per camera) that drops a **Take Camera 2** chip on a line of its own. When it reaches the prompter's reading line, the TC1 takes that camera, in the middle of the section. One at the very top of a script takes its camera as the section starts. Nothing happens in manual mode or with the cameras by hand. Works on the simulator too.
- **Music with every tease (RG, Oct 30, 2026):** the show app's **Music in** is now **Whenever a Tease fires** by default. Each TEASE graphic starts the music. **Music out** then defaults to **Whenever a Tease ends**: the music plays on through back-to-back teases and stops when the last one comes off. Picking a point in **Music out** (like just before the Show Intro) keeps the teases before it playing until that point instead. Picking a single point in **Music in** turns tease music off, and Music out goes back to defaulting to just before the Show Intro.
- **Green screen (RG, Oct 30, 2026):** in live mode, the background dropped on the Green screen box goes to the TC1 as a second source, **TSTV Show App Background**: a still sent steadily, or a clip on a loop, filling the picture. If its file can't be read, the app's small copy goes instead. The Green screen box shows the background: the picture, or the clip playing on a loop without its sound (RG, Oct 30, 2026).

## What the TC1 needs

In the TSTV session, once (after it works, save the session so it stays):

1. **Input 4's source: TSTV Show App** (in input 4's drop-down, under the laptop's coded NDI name, like `NDI_E29C…`). It appears once live mode is on.
2. **DSK 2's source: input 4** (instead of player B).
3. **Input 4's sound on** in the **AUDIO MIXER** tab (not muted, and not following video, so the music plays under the cameras).
4. **The green-screen background:** a spare input (like **input 5**) set to **TSTV Show App Background** (under the same coded NDI name), and M/E 1's background (where media player A's PrimeTime Main BG or GFX 1 is today) set to that input.

## The Phase 5 test: a rehearsal on the TC1, outside a show

You need: the laptop on the TC1's cable, NDI Tools on the laptop (already installed), an episode with graphics imported, and the prompter on another computer or window.

1. **Start the show app** (the simulator isn't needed):

   ```bash
   cd "/Users/rg_sureshkumar/AI Apps/TSTV Automated Technical Director" && npm run show-app
   ```

2. **Connect to the episode** with its key, as before. Check the graphics are imported and have files (no **missing**, no **can't read file**).
3. **Turn on live mode:** click **Run the real TC1…**, read the confirmation, and click **Turn on live mode**. Check:
   - the red **LIVE: TC1** bar, and the **TC1** light green
   - the camera boxes show the real cameras, and the Program box the real program
4. **Set up the TC1** (see "What the TC1 needs" above). Check the red bar then says input 4 is taking the laptop's graphics.
5. **Try it by hand** (before going live on the website, the app does only what you do):
   - click each camera box: the TC1 takes that camera
   - **Fire next** (Space): the graphic plays on the TC1 through DSK 2, with its see-through parts over the camera, and its sound; the Sound meter moves
   - fire two teases one after the other: they cut straight from one to the next
   - **Pause automation**, then **↓**: the graphic comes off
6. **Run the show from the prompter:** press **Start live broadcast** on the website, then run the prompter. Check the cameras switch by section and at each camera cue, the graphics fire at their cues, the music plays with each tease (stopping before the Show Intro at the top of the show, and when the teases end later on), and the Commercial Break holds through the break.
7. **Record:** click **Record**, pick a folder, run a minute, click **Stop recording**, and play the file.
8. **Back to the simulator:** click **Back to the simulator** in the red bar. The app stops sending anything to the TC1.
9. **Tell me** what didn't work or felt wrong, and whether Phase 5 is approved.

## Checked so far

- **Oct 30, 2026, at the studio** (see `docs/TC1-FINDINGS.md`): NDI works both ways over the cable; the TC1 keys the laptop's source with its see-through parts and gets its sound; the TC1's feeds play live on the laptop at 60 frames a second.
- **At home, automatically:** the playout over NDI on the laptop (see-through parts, last frame held, clip ended, straight cuts, sound, fader, input 4 cleared, music); live mode's driver against a simulator calling itself the TC1 (commands to the right place, the identity lock).
- **On the real TC1's feeds, receiving only:** the camera boxes' feeds and a 6-second recording.
- **Oct 30, 2026: the full run-through on the TC1 went smoothly (RG).** Live mode on, the prompter on another computer, Start live broadcast on the website: cameras switched by section, graphics fired at their cues through DSK 2 from the laptop, with the green screen and music from the laptop too.
- **Fixed during that session:** the Mac sending the TC1's traffic over Wi-Fi (live mode now sends from the cable's address); a crash on starting live mode (NDI frames are now copied, which Electron allows); camera boxes stuck on No picture; graphics not reaching the playout while the TC1's DSK 2 was already on (and a warning when DSK 2 isn't on input 4); a dead website connection (the app now reconnects by itself); and the camera command (the TC1 takes `v1_a_row_named_input`).

## Not yet

- **TD fallback sheet** (a one-page printout of each section's camera and graphics), if still wanted with graphics over NDI.
- **Back-to-back teases** to revisit at the rehearsal (the straight cut may fix them on the real TC1).
