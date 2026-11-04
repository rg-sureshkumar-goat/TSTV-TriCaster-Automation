# Phase 6: ship it

Phase 6 turns RiGster into a normal Mac and Windows app that anyone can install, and adds the producer guide, the pre-show checklist and the TD fallback sheet. Decisions (RG, Oct 30, 2026):

- **Staying free:** RiGster isn't signed with a paid certificate, so Mac and Windows each ask once before opening it (steps below).
- **Updates:** Windows updates itself. The Mac shows a **Get RiGster …** button that opens the download page.

## Part 1: installers and updates (built)

- **Installers:** a .dmg for Macs with an Apple chip (M1 or newer), one for Intel Macs, and a Setup .exe for Windows. The app is called RiGster everywhere, including the Dock and the taskbar, with its own blue icon.
- **No terminal:** RiGster opens from Applications (Mac) or the Start menu (Windows) like any app.
- **Everything RiGster remembers carries over** from the version run from the terminal (the same folder on the laptop): the episode key, the graphics, the music, the green screen and the light or dark choice.
- **NDI comes with RiGster (RG, Nov 4, 2026):** nobody has to install NDI Tools. Each build fetches the latest NDI® SDK from NDI's own download (`scripts/fetch-ndi.mjs`) and puts just its library and notices inside the app, as NDI's SDK manual allows. The SDK is never put in this repository. RG accepted NDI's SDK License Agreement for this on Nov 4, 2026. NDI® is a registered trademark of Vizrt NDI AB; more at https://ndi.video/.
- **RiGster's license (`apps/show-app/assets/license_en.txt`):** shown by the installers, and it carries the terms NDI requires. It's a draft for TSTV to review before any release.
- **Don't build or release yet:** the FFmpeg RiGster packs (`ffmpeg-static`) is built with `--enable-nonfree`, which FFmpeg says can't be shared. It has to be replaced first. GitHub's build artifacts on this public repository count as sharing.
- **Where installers come from:** GitHub's free machines build all three (`.github/workflows/release.yml`).
  - Run it by hand to just build them and download them from the run's page, without publishing anything.
  - To publish a version, push a tag like `v1.0.1` (matching `apps/show-app/package.json`). The installers go up as a GitHub Release, which is where RiGster looks for updates. Publishing makes them public, so it only happens when RG says so.
- **Updates:** RiGster checks when it opens and every four hours.
  - **Windows:** it downloads a new version by itself. The top bar then shows **Update to 1.0.1**, which restarts RiGster into it; otherwise it installs when RiGster is closed. During a live show it just says it installs after the show.
  - **Mac:** the top bar shows **Get RiGster 1.0.1**. It opens the download page; install it the same way as the first time.
- **To make an installer on this Mac** (for this kind of Mac only): `npm run package -w apps/show-app`. It lands in `apps/show-app/release/out`.

## How to install RiGster

**Mac**

1. Open the .dmg and drag **RiGster** onto **Applications**.
2. Open RiGster from Applications. The first time, macOS says it can't check RiGster for malicious software. Click **Done** (not Move to Trash).
3. Open **System Settings → Privacy & Security**, scroll down to the line about RiGster, and click **Open Anyway**. Type your Mac password if asked, then click **Open Anyway** again.
4. From then on, RiGster opens normally.

**Windows**

1. Open **RiGster-Setup-….exe**.
2. Windows says "Windows protected your PC". Click **More info**, then **Run anyway**.
3. Follow the installer. RiGster is then in the Start menu.

## Test for Part 1

1. **The Mac app:** the installer for your Mac is at `apps/show-app/release/out/RiGster-1.0.0-mac-arm64.dmg`. Quit RiGster if it's open from the terminal, install it as above, and open it from Applications. Check:
   - the Dock says RiGster, with the blue icon
   - it's connected to your episode as before, with your graphics, music and green screen
   - on the simulator, a mock show runs as before (start the simulator from the terminal as usual)
2. **The Windows installer:** on GitHub, open **Actions → Build RiGster**, run it, wait for it to finish (about 10 minutes), download **rigster-windows** from the run's page, and install it on a Windows computer as above.
3. **At the studio:** in the installed RiGster, turn on live mode and check the graphics reach input 4, the camera boxes show the cameras, and Record saves a file.
4. **Publishing 1.0.0:** when you're happy, tell me, and I'll publish version 1.0.0 as the first GitHub Release. The next version will then show up in RiGster as an update.

## Part 2: show profiles, shared through Google Drive (built Nov 2, 2026)

Each show has its own permanent graphics, green screen and tease music. RiGster keeps each show's set as a **show profile**, in a Google Drive, so every laptop with RiGster has them.

- **RiGster opens on the Select A Show Profile page** every time (RG's drawing, Nov 2, 2026): a tile for each show on the website, with its logo (or its initials) and its name under it, and the one used last outlined. Click one to work on that show. Without a RiGster key yet, the page asks for one first, since the list of shows comes from the website.
- **The Show profile menu** at the top left, next to RiGster's name, switches shows after that. Picking a show loads its permanent graphics, green screen and music.
- **The wrong key:** RiGster always shows the whole layout. If the RiGster key is for another show's episode, a red banner across the top says **This Show Profile Does Not Match the RiGster Key**, and RiGster doesn't follow that episode (so it can't run with the wrong show's graphics). Pick that show, or paste a key for this show.
- **A profile without an episode:** the layout shows with no episode too, so a show's permanent graphics, green screen and music can be set up ahead of time.
- **Adding or changing files:** drop them on the boxes as before. RiGster sends them to Google Drive (the Permanent graphics box shows "Uploading …" with how far it's got), and the other laptops download them the next time they check (every two minutes, and when the profile is picked). **Remove** takes a file out of the profile on every laptop.
- **In Google Drive:** a **RiGster** folder, with a folder for each show. You can look at them there, but don't rename, move or delete them there: change files in RiGster. Files added to the Drive by hand don't show up in RiGster, which can only see the files it put there.
- **Offline:** each laptop keeps a copy of each profile it has used, so the show runs if the internet drops.
- **The files RiGster already had** (like PrimeTime's on your laptop) go up to the Drive by themselves the first time the profile is opened with the Drive connected.
- **Moving to a TSTV Google account later:** on the website's Usage page, click **Connect a different Google Drive** and sign in with the TSTV account. Each laptop then sends the new Drive the files it has, the next time it opens each profile.

### Setting up Google Drive (once, by RG)

The website's "Sign in with Google" setup in Google Cloud is reused. In [Google Cloud console](https://console.cloud.google.com), with the TSTV Rundowns project picked at the top:

1. **Turn on the Drive API:** APIs & Services → Library → search **Google Drive API** → **Enable**.
2. **Add the return address:** APIs & Services → Credentials → click the website's OAuth client (the one used for sign-in) → under **Authorized redirect URIs**, click **Add URI** and paste `https://tstv-show.tstv-rundown.workers.dev/api/drive/callback` → **Save**.
3. **Add the Drive permission:** Google Auth Platform (or OAuth consent screen) → **Data access** → **Add or remove scopes** → tick **`.../auth/drive.file`** ("See, edit, create, and delete only the specific Google Drive files you use with this app") → **Update** → **Save**.
4. **Publish it, so the connection lasts:** Google Auth Platform → **Audience** → under Publishing status, click **Publish app** → **Confirm**. (While it's "Testing", Google ends the connection every 7 days. The permissions it uses don't need Google's review.)
5. **Deploy the website** (in Terminal 7): `cd "/Users/rg_sureshkumar/AI Apps/TSTV Automated Technical Director/apps/web" && npm run deploy`
6. **Connect the Drive:** on the website, open **Usage** (the gauge at the top), scroll to **RiGster's Google Drive**, click **Connect Google Drive**, pick your Gmail, and leave the Drive permission ticked. The page then says it's connected.

### Test for Part 2

1. Open RiGster. The menu at the top left shows your show (like TSTV News GMLH), and the Permanent graphics box says **Uploading …**, then **✓ Shared with every laptop through Google Drive**. In Google Drive, a **RiGster** folder has the show's folder with its files.
2. Pick another show in the menu. Its boxes show (empty if it has nothing yet). Drop a permanent graphic on its box: it uploads.
3. Paste a RiGster key from an episode of a different show than the one picked: the red **This Show Profile Does Not Match the RiGster Key** banner shows. Pick that show's profile: the episode opens.
4. On a second computer with RiGster (or the installed RiGster with another laptop), paste a key: the show's files download, and the boxes fill in.
5. On one laptop, click **Remove** on the green screen. Within two minutes (or after picking the profile again), it's gone on the other.

## Part 3: LITES in their own layout (built Nov 2, 2026)

A LITES clip no longer plays over the camera on DSK 2. It goes up in TSTV's LITES layout, from RG's template (`LITES Graphic Onscreen template.png`): the camera in a box at the left, the clip in a box at the right, and the green screen behind.

- **On the TC1 it's M/E 4**, already built as the LITES layout in the TSTV session (the probe on Oct 29, 2026 found camera on layer A, DDR 2 on B, the background on C). When a LITES cue fires, RiGster puts the section's camera on A, the clip on B (in live mode the laptop's graphics, input 4), the green screen on C (input 5 in live mode, the same background as the anchors'), plays the clip and switches program to M/E 4.
- **When the clip ends**, program goes back to M/E 1, the camera, full screen. If the section ends first, the same. If the section's L3 was up before the LITES, it comes back afterward, as after a VO. ↓ in manual mode takes the layout down too.
- **On the simulator,** RiGster's Program box draws the layout like the template.

### Test for Part 3

1. **On the simulator:** in a rundown, add a LITES graphic to a section, cue it in the script, import its file, and run the show. When the LITES cue fires, the Program box shows the green screen with the camera in a box at the left and the clip in a box at the right. When the clip ends, it goes back to the camera full screen.
2. **On the TC1 (live mode, RiGster session):** the same, on the TC1's program. Check M/E 4's boxes are where they should be, and that program goes back to the camera after.
3. If the TC1's M/E 4 layers aren't A camera, B clip, C background in the RiGster session, tell me: the layers are easy to change.

## Part 4: transitions (built Nov 2, 2026)

Each show has two transitions, kept in its show profile like the permanent graphics, in RiGster's new **Transitions** box (between the Green screen and Music boxes):

- **Tease Transition:** plays between back-to-back teases, when one tease goes straight to the next. Not before the first or after the last.
- **LITES Transition:** plays going into a LITES layout, and again coming out of it.
- **They're wipes:** the transition plays over everything, and at its middle (when it covers the picture) the switch happens underneath: the next tease starts, or program goes to the LITES layout, or back to the camera. A show without a transition file just switches, as before.
- **Adding them:** drop a file on the Transitions box (a name with "tease" or "lites" in it goes to that one; otherwise it fills an empty one), or use **Choose**. Like the permanent graphics, they upload to the show's folder in Google Drive and reach every laptop.
- **On the simulator,** RiGster's Program box plays the transition over the picture.

**What the TC1 needs (live mode, RiGster session):** RiGster sends the transition as a third source, **RIGSTER (Transition)**. Input 6 and DSK 4 are now steps 6 and 7 of the RiGster session's setup (docs/PHASE-5.md, "What the TC1 needs"). DSK 4 sits above DSK 2 and the M/Es, so it covers the switch. The probe found DSK 4 on media player A; if DSK 4 is used for something else in shows, tell me and RiGster can use another.

**Note:** the website must be deployed for the transitions to save to Google Drive (it now accepts them in a show's profile).

### Test for Part 4

1. Deploy the website. Open RiGster, pick a show, and drop a tease transition and a LITES transition on the Transitions box. They show their pictures, and upload.
2. **On the simulator:** run two teases back to back: the tease transition plays over the Program box, and the second tease appears under it halfway through. Fire a LITES: the LITES transition plays, and the layout appears under it halfway; when the LITES ends, the transition plays again and the camera comes back under it.
3. **On the TC1:** set input 6 and DSK 4 as above, and do the same in live mode.

## Part 5: RiGster runs the TC1 from the moment it opens (built Nov 2, 2026)

RG: no simulator mode, and no **Run the real TC1…** button or warning page.

- RiGster opens looking for the TC1. Until it's connected, a red banner across the top reads **RiGster Is Not Connected to TC1**, with what it's waiting for: **Plug in the TC1 Cable to Connect to TC1** until it sees the cable, then the TC1 (turned on?) or its session (open?).
- Once connected, the banner goes, the **TC1** light turns green, the **LIVE: TC1** badge shows, and the cameras and program come on. The red LIVE bar no longer has **Back to the simulator**.
- If the connection drops (cable pulled, TC1 turned off), RiGster stops sending, the banner comes back, and it connects again by itself when it can.
- It still sends nothing until it's connected, and still talks only to a switcher that calls itself a TriCaster TC1.
- The simulator is now only for development and testing: `npm run show-app:simulator`.

### Test for Part 5

1. **At home (no cable):** open RiGster and pick a show. The red banner reads **RiGster Is Not Connected to TC1** and **Plug in the TC1 Cable to Connect to TC1…**. There's no SIMULATOR badge and no **Run the real TC1…** button.
2. **At the studio:** with the RiGster session open on the TC1, plug in the cable. Within about a minute the banner goes and the cameras come on, with no buttons pressed.
3. Pull the cable: within a few seconds the banner comes back. Plug it in again: RiGster connects by itself.

## Part 6: Open On Manual Mode (built Nov 2, 2026)

For recordings that use the TC1's cameras and graphics without a show (RG):

- **Open On Manual Mode** is below the shows on the Select A Show Profile page (and at the bottom of the Show profile menu at the top left). No RiGster key, rundown or prompter.
- RiGster stays in manual mode: click a camera to take it; **→** fires the next graphic, **Space** pauses it where it is and starts it again, **←** goes back one, **↓** takes it off. **Record** works as in a show.
- **Graphics stay up until you take them off** (a clip holds its last frame).
- **Playlist:** **Import graphics** (or drop files on the list) adds them to the end, in the order imported. Drag a graphic by the **⠿** at its left to move it up or down; **Play next** makes it the next one; **✕** takes it out; **Clear** empties the list. The list is kept for next time.
- **Green screen:** a menu of the shows' green screens. Picking one uses it for Manual Mode only; the show's own stays as it was. You can still drop or choose a file.
- No permanent graphics, music or transitions; their boxes stay, empty.
- Picking a show from the Show profile menu leaves Manual Mode.

### Test for Part 6

1. Open RiGster. Below the shows, click **Open On Manual Mode**. The top says **Manual Mode**, with no **Episode key** button, and the Pause button reads **Manual Mode**.
2. Click **Import graphics** and pick two or three files. They appear in the Playlist in that order. Drag the last one to the top by its **⠿**.
3. In the Green screen box, pick a show from the menu. Its green screen appears.
4. At the studio, with the TC1 connected: click cameras, fire graphics with →, pause one with Space, take them off with ↓, and record.
5. Close RiGster and open Manual Mode again: the graphics are still there. Click **Clear** to empty the list.

## Part 7: The TC1's Preview box shows what's up next (built Nov 4, 2026)

The TC1's **Preview** box now matches RiGster's **Up next preview** (RG): the next graphic over its section's camera.

- **RiGster sends** the next graphic as a fourth source, **RIGSTER (Up Next)**: one picture, from the same moment as its thumbnail, with its see-through parts.
- **When the next graphic changes,** RiGster sets M/E 3's A row to the section's camera and puts M/E 3 on the Preview row. Music or a cue with no file shows just the camera.
- **Watch out:** **Take** or **Auto** on the TC1's panel would send that picture to Program, and moves the Preview row. With RiGster running, nobody uses them.
- **Not yet confirmed on the TC1:** the Preview row command (`main_b_row_named_input`), and that M/E 3 keys the graphic as expected.

**What the TC1 needs (RiGster session):** steps 8 and 9 of the setup (docs/PHASE-5.md, "What the TC1 needs").

### Test for Part 7

1. With RiGster connected, set input 7 to **RIGSTER (Up Next)**. On M/E 3, turn on Key 1 with its source on input 7. Save the session.
2. Import graphics. The TC1's **Preview** box should show the same as RiGster's **Up next preview**: the next graphic over the section's camera.
3. Press **→**. The graphic goes to Program, and Preview changes to the one after it.
4. Fire to the end of the list. Preview shows just the camera, with no graphic.

## Still to come in Phase 6

- A one-page producer guide
- A pre-show checklist
- The TD fallback sheet (if still wanted)
