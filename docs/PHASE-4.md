# Phase 4: show app on the simulator

Phase 4 adds the **show app**, the desktop app the producer runs during a show. It follows an episode on the website, hears the prompter's cues, and runs the switcher by the cue rules. In Phase 4 it only ever talks to the **simulator** (the fake TriCaster on your laptop). The real TC1 comes in Phase 5, behind a live mode you turn on yourself.

## What's new

### On the website

- **Start live broadcast** (RG, Oct 29, 2026). The producer who created the episode, or an admin, presses it on the episode's page when the show goes on air. From then on, the show app's automation follows the prompter. The button then reads **● Live · End live broadcast**, and pressing it again stops the automation. Everyone else sees a **● Live** badge.
  - Before the show is live (and after it ends), the show app ignores the prompter's cues. The camera buttons and Fire next still work by hand, for setting up and rehearsing.
  - It doesn't start recording; recording keeps its own button (Phase 5).
- **Show app key.** Each episode has a **Show app key** button at the top. It shows the episode's key, a long code starting `tstv-`. Paste it into the show app to connect the app to that episode. Only the producer who created the episode and admins can see it.
  - **Make a new key** cuts off any show app still using the old one.
  - Keep the key to the crew: anyone with it can follow the episode (but not change it).
- **Files in the rundown.** Once the show app has graphics for an episode, each graphic in the rundown shows **✓** when it has its file, and a red underline when it doesn't. Hover for the file's name and length.
- **Clip lengths in Est.** A section's estimated length now adds its SOTs' and packages' real lengths, measured by the show app.
- **Show settings:**
  - **TriCaster inputs:** which TC1 input each camera is (Camera 1 is input 1, and so on).
  - **Permanent graphics with their own audio:** tick the ones that are clips with sound, like the Show Intro, Station ID and Station Outro. The rest, like Social Media L3, are treated as lower thirds.
- The **Prompter** bar on the rundown page also shows whether the show app is connected, and whether automation is paused.

### The show app

The screen follows RG's sketch ([show-app-sketch.pdf](show-app-sketch.pdf), Oct 29, 2026):

| Top | | |
| --- | --- | --- |
| **Program**, with the **● LIVE** dot and **Cam 1 / Cam 2 / Cam 3** under it | **Playlist:** On air and Up next, with **Import graphics** | **Pause automation**, **Section**, **Elapsed**, **Time left on current GFX** |

| Bottom | | | |
| --- | --- | --- | --- |
| **Up next preview** | **Permanent graphics** drop box | **Green screen** drop box | **Music** |

- **Header:** at the far left, a switch between **light and dark mode** (RG, Oct 29, 2026). The app starts dark, like the control room, and remembers your choice on this laptop. The video boxes (Program, cameras, preview) stay black in both. Then the show and episode, a green **SIMULATOR** badge (Phase 4 can't drive the real TC1), and at the right the **Website / Prompter / Simulator** lights and the **Episode key** button. Click Episode key, paste the key from the website, and Connect. Click the Simulator light to change the simulator's address.
- **Program:** on the simulator, what's on air (RG, Oct 29, 2026, for mock shows): the camera on air, playing, with the clip on DSK 2 playing over it with its sound. Graphics keep their see-through parts, so an L3 sits over the camera, while a VO or SOT fills the screen. The caption names the camera and the graphic. The **● LIVE** dot is red once the producer presses Start live broadcast. The real TC1's own program video is a later upgrade.
- **Sound strip (RG, Oct 29, 2026):** down the right edge of the screen, one level meter and one fader for all of Program's sound, the clip on DSK 2 and the music together (RG wanted just one). The meter is green, amber near the top, red in the last few dB; the fader makes it quieter or louder, from silent up to +6 dB. Double-click it for 0 dB; the laptop remembers where it was left. On the simulator it sets the sound the app plays; on the real TC1 it will set the switcher's audio levels (Phase 5).
- **Music out loud (RG, Oct 29, 2026):** the simulator's Sound player only pretends to play, so on the simulator the app plays the music track itself, out loud, from the moment the Sound player starts until it stops (by default from the first tease to just before the Show Intro). It makes a sound-only copy of the track, like the graphics' copies.
- **Playable copies:** the app's window can't play ProRes, so the first time it sees a graphic or clip, the app makes a small copy it can play (WebM, about a second for a 20-second graphic), in the background. It keeps the copies on this laptop, in its own folder; nothing goes to the cloud. Once a file has its copy, it plays even after the drive it came from is unplugged. If a file's drive isn't plugged in and it has no copy yet, a banner says which drive, the Playlist marks the cue **not on this laptop**, and the Program box shows the graphic's still instead; plug the drive in and the app picks the files up by itself within about 10 seconds.
- **Cameras:** one box per camera from the show's settings, playing that camera's picture. Click one to take it; the one on air has a red frame. On the simulator each camera plays a moving test picture that looks nothing like the others (RG, Oct 29, 2026): **Camera 1 blue, Camera 2 green, Camera 3 orange**, each with its name in the middle and a clock at the top left. Getting the real cameras' video from the TC1 is still to be worked out at the station (see below).
- **Playlist:** what's on DSK 2 now, and the cues coming up. While the clip on air plays, a see-through red bar fills across it from left to right, with the time left at the right (RG, Oct 29, 2026). Next to each cue's section number is the file that will play (RG, Oct 29, 2026), or the music track for a music cue; hover over a long name to see all of it. Each upcoming cue has **Skip** (it won't fire; skipped cues can be put back) and **Play next** (it fires next, out of order). **Fire next** (or the **Space** bar) fires the next cue by hand.
- **Pause automation** (or **P**) switches to **manual mode** (RG, Oct 29, 2026): the prompter's cues fire nothing and take no cameras, and the producer runs the graphics. **Space** or **→** fires the next graphic, **←** puts the previous one up again, and **↓** takes the graphic off (the Playlist also has **← Back** and **Take off ↓** buttons). Click a camera to take it. A SOT, package or VO you fire still comes off when its clip ends. The button turns into **Continue automation**, which hands the show back to the prompter from its current place, without firing the cues it passed in manual mode. The arrow keys work only in manual mode.
- **Section, Elapsed** (since Start live broadcast) and **Time left on current GFX** (the clip playing on DSK 2). Under them, the last cue and how long it took from the reading line to the switcher: green under 0.3 s, amber up to 0.5 s.
- **Up next preview:** what the next cue will look like on air: the camera it plays over, playing, with the graphic on top (RG, Oct 29, 2026). Graphics keep their see-through parts, so an L3 or OTS sits over the camera, while a VO, SOT or package fills the screen. Thumbnails made before this change are remade by themselves when the app connects.
- **Banners:** "Not live yet" before the broadcast starts, "Manual mode" (with the keys) in manual mode, and "The prompter isn't connected" during a live show without a prompter.

### Graphics

- **Import graphics** (in the Playlist) picks files or a folder, like the graphics team's USB drive. Then a **Graphics** window shows which file went on which cue, with **Files to place by hand** at the top when there are any. **Edit graphics** opens that window again, to change, remove or place files by hand; you can also drop files on it. The button beside it (like **2 missing**) shows just the list of graphics that still need a file, with ways to load them in: **Import graphics**, **Choose file** on each one, or drop files on the list. Each graphic leaves the list once it has its file.
- Files are matched by name, like `B5_VO_Basketball.mov` going to B5's VO. The app also reads the real playlist's spellings: `OTS_L`, `OTS_R`, double underscores, copies ending in `(1)` or `copy`, and spaces. **NAMES** files are lower thirds and **RDR** files are OTS graphics.
- **When it isn't sure, it asks.** For example: a name that doesn't follow the pattern, a section that doesn't exist, two files of one type for one section, or a slug that doesn't look like its section's slug. Each shows under **Files to place by hand** with a menu of where it could go.
- It reads each clip's length and makes a thumbnail. **The files stay on the laptop.** Only names and lengths go to the website.
- **Permanent graphics** (Show Intro, Station ID…): drop their files on the **Permanent graphics** box once, and the app remembers them for every episode of that show. Each file goes to the graphic its name contains ("PrimeTime Show Intro.mov" → Show Intro); the app asks about the rest. **Choose** picks one by hand.
- **Green screen:** drop the show's background (a still or a clip) on the **Green screen** box. On the simulator, a still goes in GFX 1 and a clip in DDR 1. On the real TC1 this comes in Phase 5.
- **The simulator's DDR 2 loads itself** (RG, Oct 29, 2026): whenever the files change, the app fills it the way your TD does, with the break clip at the top of each block, then each element's file in rundown order. So every graphic with a file plays, with no Load button to remember. It waits while a clip is on air, so nothing is cut off. On the real TC1, **Send to TriCaster** does this in Phase 5, when the producer chooses.

### Music

- By default, the music starts when the first **Tease** section in block A starts, and stops just before the **Show Intro** fires (RG, Oct 29, 2026).
- The **Music** box changes both, for each show: **Music in** and **Music out** can be any section start or any cue, or **Never by itself**.
- **Which track plays:** drop the show's music track (a .wav, .mp3, .aif or .m4a) on the **Music** box, or click **Choose** (RG, Oct 29, 2026). The box shows the track's name and length, and **▶ Playing** while it plays. The app remembers it for the show.
  - On the simulator, the app puts the track in the Sound player for you.
  - On the real TC1, the track has to be in the Sound player already; the box warns **Not in the Sound player yet** if it isn't. Sending it there comes with Send to TriCaster in Phase 5.
  - With no track dropped, the app plays the Sound player track with the MUSIC element's name, like "PrimeTime Main".
- A MUSIC element's cue in the script also starts the music.

### The cue rules the app follows

| Element | Goes up | Comes off |
| --- | --- | --- |
| L3, NAMES, OTS, RDR, FSG, lower-third permanent graphics | Its cue | Its section ends |
| VO, TEASE, LITES | Its cue (the anchor reads over it) | The clip or the section ends, whichever is first. If the clip ends first, the section's L3 comes back |
| SOT, PKG, permanent graphics with their own audio | Its cue | The clip ends, then back to the anchors |
| Commercial break (the show's Commercial Break graphic, RG, Oct 29, 2026) | The prompter's **COMMERCIAL BREAK** line reaches the reading line | The next section starts: it stays up for the whole break, holding after its clip ends |
| MUSIC | Its cue, or the music-in point | The music-out point |

A cue at the very top of a section's script, above any words to read, fires as soon as the section starts (RG, Oct 29, 2026), instead of after the section's number, camera and talent lines scroll past. So back-to-back teases play one after another, with no camera in between. And when one clip replaces another (tease to tease, L3 to VO and back), DSK 2 stays on while DDR 2 switches to the next clip and plays it, so not even a few frames of camera show (RG, Oct 29, 2026).

When a section starts, the app takes its camera (the show's default camera when it doesn't name one) and cues its first clip in DDR 2.

## Set it up (one time)

1. Get the latest code and install the new parts. In Terminal:

   ```bash
   cd "/Users/rg_sureshkumar/AI Apps/TSTV Automated Technical Director" && git pull && npm install
   ```

   This downloads Electron (what the app is built on) and FFmpeg (which reads clip lengths), about 200 MB.
2. Deploy the website, which also updates its database:

   ```bash
   cd "/Users/rg_sureshkumar/AI Apps/TSTV Automated Technical Director/apps/web" && npm run deploy
   ```

3. On the website, open your show's **Show settings**. Check **TriCaster inputs** and **Permanent graphics with their own audio**, then click **Save settings**.

## The Phase 4 test: a full mock show on the simulator

You need: the October 26 episode (or another with graphics in its rundown and cues in its scripts), the graphics files for it (any `.mov` or `.mp4` files work for practice), and two windows or two computers for the prompter.

1. **Start the simulator** in one Terminal window:

   ```bash
   cd "/Users/rg_sureshkumar/AI Apps/TSTV Automated Technical Director" && npm run simulator
   ```

   Its page opens in your browser and shows the fake TC1: program, DSK 2, DDR 2's playlist and the Sound player. (If it's already running from before Oct 29's mock-show changes, stop it with **Ctrl+C** and start it again, so the cameras get their new pictures.)
2. **Start the show app** in a second Terminal window:

   ```bash
   cd "/Users/rg_sureshkumar/AI Apps/TSTV Automated Technical Director" && npm run show-app
   ```

   The Simulator light should be green.
3. **Connect:** on the website, open the episode, click **Show app key**, **Copy**. In the app, click **Episode key** at the top right, paste it, and Connect. Check that the Website light goes green, and that the rundown page's Prompter bar says the show app is on the simulator.
4. **Graphics:** drop the permanent graphics on their box, and the background on the Green screen box. Then click **Import graphics** and pick the folder of episode graphics. Check:
   - files named after sections land on the right elements, with lengths and thumbnails
   - anything it couldn't place is listed, and you can put it on the right element
   - the rundown on the website shows ✓ on the graphics that have files
   - the **missing** button lists only the graphics without a file, and you can load them in from there (Import graphics, Choose file, or drop files on it)
   - **Edit graphics** opens the full Graphics window
5. **DDR 2:** check the simulator page's DDR 2 lists the clips in rundown order (the app loads it by itself), and that no cue in the Playlist says "not in DDR 2".
6. **Run the show:** open the prompter on the episode (on another computer, or another window). Scroll a little first, and check the app does nothing yet ("Not live yet"). Then press **Start live broadcast** on the website and run the prompter from the top. Watch the simulator page and the app. Check:
   - each section's camera is taken when it starts, and the **Program** box shows that camera
   - the teases at the start of block A play back to back, with no camera between them
   - each cue goes up as it crosses the reading line, and plays in the Program box over the camera (or full screen), and the right ones come off (see the table above)
   - a VO over an L3 brings the L3 back when it ends first
   - SOTs and the Show Intro play to their end, then back to the anchors
   - at each **COMMERCIAL BREAK** line, the Commercial Break graphic plays (it shows in Up next as **★ Commercial Break** with **Break** beside it), stays up through the break, and comes off when the next section starts
   - the music starts with the tease and stops just before the Show Intro, and you hear it from the laptop
   - the latency stays green
   - the **Sound** meter moves with the clips' and the music's sound, and the fader makes them quieter or louder
7. **Producer controls:** try **Skip**, **Play next**, **Fire next** with the Space bar, and the camera buttons.
8. **Manual mode:** during the show, click **Pause automation**. Check:
   - the button turns green and says **Continue automation**, and a red banner lists the keys
   - the prompter's cues no longer change anything on the simulator page, and the cameras don't switch by themselves
   - before you pause, the arrow keys do nothing
   - **Space** or **→** puts the next graphic up, **←** puts the previous one back up, and **↓** takes it off
   - clicking a camera takes it
   - **Continue automation** hands back to the prompter: the next cue it reaches fires, and the next section takes its camera
9. **No prompter:** close the prompter. The banner should appear, and Space should keep the show going.
10. **Practice problems:** the simulator page can unplug the fake TC1 or end a clip early. Try both.
11. **End live broadcast** on the website, and check the app stops following the prompter.
12. **Tell me** what's missing or awkward, and whether Phase 4 is approved.

## Not yet

- **Back-to-back teases still don't cut cleanly (come back to this; RG, Oct 29, 2026).** In the mock show, the change from one tease to the next still isn't right, even after the top-of-section cues and the clip-to-clip cut. RG asked to set it aside and return to it later.

- **The real cameras' video.** At the studio on Oct 29 we found the TC1 sends 8 NDI video feeds over the cable, but they didn't play live on the laptop yet (see `docs/TC1-FINDINGS.md`). Working out which feed is which camera, and getting them to play, is part of Phase 5. Until then, the simulator's test pictures stand in.
- **The real TC1** (Phase 5): live mode with its three safety locks, Send to TriCaster, sending the green screen to the TC1, and the Record button.
- Installers for Mac and Windows (Phase 6). For now the app runs from Terminal with `npm run show-app`.

## Behind the scenes

- **Colors:** the app colors cues the way the rundown and the prompter do: graphics blue, video red, music purple, permanent graphics green.
- **Episode key.** The app reads the episode with its key (Bearer token) and joins the episode room read-only, so it can't change the rundown. It reports files and lengths with a message the room writes into the episode.
- **The cue engine** (`packages/shared/src/engine.ts`) is pure logic with automatic tests for every rule. The switcher driver (`apps/show-app/src/main/switcher.ts`) is the only code that talks to a switcher. It refuses anything that doesn't call itself the TSTV Simulator. In manual mode the engine ignores the prompter, so only the producer's keys and clicks send anything.
- **TC1 commands** used: `v1_a_row` (cameras on M/E 1), `ddr2_select_clips` (cue a clip), `ddr2_play` (play it, when it replaces another clip with DSK 2 still on), `main_dsk2_value` (DSK 2 on and off; DDR 2's AutoPlay plays and stops the clip), and `sound_select_clips` / `sound_play` / `sound_stop` (music). A clip's end is DDR 2 stopping by itself, with the seconds remaining at zero. The DDR and Sound player command names get confirmed on the real TC1 in Phase 5.
- **FFmpeg** reads lengths and makes thumbnails, ProRes 4444 included.
- **A mock-show test** runs the app's core against the simulator with real (tiny) clips: import, load, every cue rule, manual mode, and the simulator-only lock.
