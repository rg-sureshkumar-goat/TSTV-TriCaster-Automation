# TSTV Show Automation — Project Brief

Oct 28, 2026 · @RG Sureshkumar

TSTV will replace Rundown Creator with its own free rundown, script and prompter website, plus a laptop app that runs the TriCaster TC1 from prompter cues. One producer with no technical background can then run a live show from a laptop, with the TD on standby to take over on the physical panel only if the producer hits Pause Automation.

## Goals

The project is done when a producer can run a full 30-minute live show from her laptop without anyone touching the TriCaster.

- **One operator.** A producer with no technical background runs cameras, graphics, VOs, SOTs, packages, the green screen and recording from a laptop.
- **Cues fire themselves.** Each graphic or clip fires when its cue reaches the prompter's reading line.
- **Write from anywhere.** Writers type scripts from any location at any time. The producer edits live during the show, and the prompter updates without losing its place.
- **Rundown Creator retired.** Everything TSTV uses in Rundown Creator today exists in the new website.
- **Safe hand-off.** Pause Automation stops the tool instantly. Every file and setting is already loaded on the TC1, so the TD takes over on the physical panel without hunting for anything.
- **$0 to run.** Free hosting only, no paid services, no paid code signing.
- **Mac and Windows.** Both the website and the laptop app work on either.

## The studio today

These are the facts the build has to fit, confirmed on site on Oct 28, 2026.

| Item | Today |
| --- | --- |
| Switcher | NewTek TriCaster TC1, software Version 7-7 (build 7-7-210722C), running on Windows 10 build 17763 |
| Control panel | TC1SP button panel. It connects over USB through a USB-over-Cat-cable extender (labeled "USB Extender"), not over the network. Leave it alone. |
| Network | Until now the TC1 was on no network: both Ethernet ports showed "Media disconnected" and `ping 8.8.8.8` returned "General failure." One port now has a cable for the show laptop. Label that port. Confirmed Oct 28: a laptop on that cable and the TC1 both give themselves automatic addresses and can talk with no settings changed (the TC1 was at 169.254.193.52). |
| Cameras | 3 studio cameras on TriCaster inputs 1, 2 and 3. Cameras 1 and 2 have prompter monitors and are used interchangeably for the anchors; camera 3 is the wide shot. All three face the green screen. Angles and zoom use other hardware and are out of scope. |
| Program path | Program runs through M/E 1: the main program row shows M/E 1, and cameras are switched on M/E 1's row. |
| Graphics and clips | L3s, OTS, FSGs, VOs, SOTs and packages all play from DDR2 and are put on air with the DSK 2 Take button. They're loaded from a USB drive in rundown order. DDR2 has AutoPlay on: taking DSK 2 on plays the cued clip, and taking it off stops DDR2 and cues the next clip. Each block in DDR2 starts with a break clip (today "TSTV Ident 2022 News") that's held during the commercial break. DDR1 is not used. |
| Green screen | Each show has its own green-screen background, which doesn't change during the show. The background lives in GFX 1, keyed with LiveMatte and layered in an M/E. The probe saw M/E 2 set up as a camera on its A row over GFX 1, and GFX 1 on program through M/E 1. |
| Audio | Separate sound board, out of scope. SOTs and packages carry their own audio from DDR2. The TC1's **Sound** player holds the show's music: the probe (Oct 28, 2026) found "PrimeTime Main" (`News_Under (1).wav`, 0:56) and "PrimeTime Transition Music" (0:21). |
| Streaming | YouTube, not through the TriCaster. Out of scope. |
| Recording | The TC1 records. Shows are often aired or published later. |
| Prompter | A dedicated Mac in the studio, using Safari. A prompter runner sets the speed with the arrow keys. Its screen feeds monitors on two cameras (cameras 1 and 2), and a physical mirror flips the image, so no software mirroring is needed. |
| Rundown | Rundown Creator, with no connection to the TriCaster |
| Show format | Many shows, each with its own rundown format. About 30 minutes each, blocks lettered A, B, C and on, usually 2 anchors plus a varying number of correspondents. Always live, often recorded. |
| Laptops | Most students' laptops have no Ethernet port. |

## How the pieces fit

```mermaid
flowchart TB
  subgraph Online["Online, free hosting"]
    W["Writers and producer<br/>write scripts from any browser"] --> S["TSTV website<br/>shows, episodes, rundowns, timing,<br/>co-edited scripts, prompter page, sign-in<br/>(media files never upload here)"]
  end
  subgraph Studio["TSTV studio and control room"]
    P["Prompter computer (studio)<br/>full-screen prompter page<br/>runner sets speed with arrow keys<br/>sends cue events at the reading line"]
    L["Producer laptop with show app<br/>camera buttons, up next, preview<br/>Pause Automation and Record<br/>imports graphics from the USB drive"]
    T["TriCaster TC1<br/>cameras, DDR2 and DSK 2 graphics<br/>GFX 1 green screen, recording<br/>holds the whole show for the TD"]
    D["TD at the TC1SP panel<br/>takes over when the producer hits Pause"]
  end
  S <-- "script down, cue events up" --> P
  S <-- "cues and rundown (Wi-Fi)" --> L
  L -- "commands and files over one Ethernet cable" --> T
  D -- "USB panel" --> T
```

Cues reach the laptop through the website because the prompter computer and the laptop can't reach each other on campus Wi-Fi. Pause and every TriCaster command travel only over the cable, so they still work if the internet drops.

## Part 1 — Rundown and script website

The website replaces the Rundown Creator features TSTV actually uses, and only those. Anyone signed in can use it from any browser on Mac or Windows.

**Shows and episodes**

- Anyone can **Add a Show** and name it anything. Each show holds **episodes**, and each episode has its own rundown, scripts, graphics and prompter text.
- Every show uses the same interface. Shows differ only in their content: number of blocks, sections and talent.
- Each show has settings for its default camera (for example "Anchor Camera"), its usual talent, and its target length (default 30:00).
- **On-air talent per episode (decided Oct 28, 2026):** every episode has its own anchors and correspondents, so each episode has a section where the producer enters their names. Each person gets a color, used for their sections in the rundown and on the prompter.
- After air, an episode can be **archived** (read-only, still searchable) and **exported** as PDF and CSV.

**Rundown grid**

- One row per section, grouped under block headers A, B, C. Sections are numbered within the block: A1, A2, B1.
- Columns: Section, Slug, Segment type (**Intro, Tease, Reader, Cross Talk, Q&A, Package, SOT, Permanent Graphic**, decided Oct 28, 2026, with Q&A and Permanent Graphic added Oct 29, 2026; each show can still edit its list), **Writer** (typed in; added Oct 28, 2026), Talent (picked from the episode's anchors and correspondents; **one or more people** per section, for a Q&A or any part where several people talk; or **Everyone (cross talk)** on its own, for real cross talk with no formal script, where the prompter just says CROSS TALK; decided Oct 29, 2026), Camera, **Headline** (typed in; added Oct 29, 2026), Elements (attached graphics with Ready or Missing status), **Notes** (typed in; added Oct 28, 2026), **Assign Graphics** (typed in: who makes the section's graphics; added Oct 29, 2026), Est. duration, Back-time. The column headers stay at the top while you scroll down the rundown. *(No green-screen column: decided Oct 28, 2026, since each show uses one background for the whole show. See Part 3.)*
- **Decided Oct 28, 2026:** a section can have several things happening in it, so the **Elements** column (titled **Graphics** in the rundown) lists each section's elements in the order they fire. For example, a Reader can have an L3 and then a VO playing over the anchor.
  - Element types: L3, OTSL, OTSR, FSG, **TEASE**, **LITES**, VO, SOT and PKG (TEASE and LITES added Oct 29, 2026). Each element can also have an optional name.
  - In the rundown, graphics are blue and video is red. **LITES is a video** (decided Oct 29, 2026), so it's red like VO, SOT and PKG.
  - **MUSIC (decided Oct 29, 2026):** music is an element too, shown in purple and named by its track, such as the intro music that plays under the tease at the top of block A. The show app plays it from the TC1's Sound player when its cue is reached.
  - **Permanent graphics (decided Oct 29, 2026):** each show has a list of graphics used in every episode. TSTV's default list is Station ID, Show Intro, Commercial Break, Social Media L3, Website L3 and Station Outro, and each show can edit it in its settings. The Graphics column can pick any of them for a section. In Phase 4 the show app makes sure they're loaded on the TriCaster before every show.
  - Elements are planned in the rundown first.
  - In Phase 2 each element is linked to its cue chip in the script. In Phase 4 it's linked to its file, with Ready or Missing.
  - The TriCaster cueing is built from them.
- **Commercial breaks (decided Oct 29, 2026):** a commercial break is added automatically between every two blocks. It shows the show's break permanent graphic (Commercial Break), can't be edited or moved, and goes wherever the blocks go. Each show sets its break length in its settings (0:00 by default, which leaves breaks out of the timing); breaks count toward the episode total and back-times.
- Drag rows to reorder, add or delete sections, and **float** a section (keep it but skip it on air). Section numbers update when rows move.
- **Publish rundown (decided Oct 28, 2026):** a new episode is a draft. Only the producer who created it and admins can see it. When the rundown is built, the producer clicks **Publish rundown** and everyone who can sign in sees it. The producer or an admin can unpublish it.

**Timing**

- Each section's estimated duration = script read time (word count at an adjustable words-per-minute rate) + the durations of its clips (SOT, PKG).
- Shows the episode total, over/under against the target length, and back-times (the clock time each block must start to finish on time).
- During the show, records each section's actual start and length from the prompter, so the producer sees how far over or under the show is running.

**Script pages**

- Each section opens to its own script page. The prompter shows all sections in rundown order.
- **Several readers (decided Oct 29, 2026):** when more than one person talks in a section, the writer marks each person's part with their name in curly brackets on its own line above it, like `{Jordan}`. *Proposed for Phase 3:* the prompter shows each `{Name}` line as a speaker marker in that person's color.
- **Reading cue (decided Oct 29, 2026):** the script page, and in Phase 3 the prompter, clearly shows who reads each section (everyone, when several people share a section) and which camera to look at.
- **Decided Oct 28, 2026:**
  - Each slug in the rundown is a link to its script page.
  - The script page has a text box. Above it are a **word counter** and an estimate of how long a typical anchor takes to read the script, at **143 to 154 words a minute** (2.38 to 2.57 words a second).
  - The page records everyone who edited the script, and who edited it last.
  - **The rundown's Est. fills in from the script's read time** (the middle of that range, 148.5 words a minute). Typing a length overrides it; clearing it goes back to the script's time.
- **Live co-editing**, like Google Docs: several people type in the same rundown and the same script at once, with each other's cursors visible and no overwritten work.
- **Cues** are inserted with a toolbar button or shortcut as locked chips in the text: Take L3, Take VO, Take SOT, Take PKG, Take OTSL, Take OTSR, Take FSG.
- Each section is tagged with the on-air **talent** who reads it, and the prompter shows that name at the section's start.
- During the show the producer can edit any script, and changes reach the prompter within about a second.

**Sign-in**

- Sign-in is required so outsiders can't edit scripts. Version 1 has one role for everyone, plus an admin (the TD) who invites people.
- **Decided Oct 28, 2026:** the website uses **Sign in with Google**, limited to people the TD invites.
- **Authorship:** the site records who wrote and who edited each section's script and rundown row, so the producer knows exactly who wrote and edited each reader.

**Not in version 1:** team chat, per-person permissions, rundown templates, printing scripts.

## Part 2 — Prompter

The prompter is a full-screen page of the website, opened in a browser on the existing prompter computer. Its screen already feeds the camera monitors and mirror, so nothing else changes in the studio.

- **Controls:** the up arrow speeds up, the down arrow slows down, exactly like today. The spacebar pauses and resumes. Other keys jump to the next or previous section and back to the top.
- **Settings:** text size, line width and margins, line spacing, text and background colors, and the position of the reading-line marker. No mirror setting is needed.
- **What it shows:** each section starts with its number (B5), the talent names (color-coded by talent; a cross-talk section just says CROSS TALK) and the camera to look at. Cues appear as bold colored markers in the text, as on today's prompter. Floated sections are skipped.
- **Live updates:** script edits appear as they're made without moving the text the anchor is reading.
- **Cue firing:** when a cue marker or section start crosses the reading line, the prompter sends that event to the show app (see Part 3). It also sends its position a few times a second so the producer can see where the anchors are.
- **Internet drops:** the prompter keeps scrolling the last version of the script and shows a small warning to the runner. Edits sync again when the connection returns.

## Part 3 — Show app and TriCaster automation

The show app is a desktop app for Mac and Windows, installed once on each laptop that will run shows. At showtime it connects to the TC1 over the cable and to the website over Wi-Fi. Nothing is installed on the TC1.

**Connecting**

- The producer plugs the USB-C-to-Ethernet adapter and the TC1 cable into her laptop and opens the app. The app finds the TC1 on the cable by itself. Producers never change network settings.
- **No sign-in in the show app (decided Oct 28, 2026).** Only one laptop is connected at a time, and running the TC1 means being in the studio on the cable.
- **Proposed, to confirm in Phase 4:** the app still reads the rundown and cues from the website. To keep scripts and the cue feed private, the admin links each show laptop to the website once.
- Status lights show whether the website, the prompter and the TriCaster are connected.

**Producer screen**

- **Camera buttons:** one per camera, with names the producer sets (Anchor Camera, Weather Camera, Guest Camera). One click takes that camera to air. Input numbers are mapped once in settings.
- **On air / Up next:** what's on air now, and the queue of upcoming cues. The producer can skip an element, pick a different one to play next, or fire the next cue by hand, all without touching the TriCaster.
- **Preview:** a still image of the next element with the name of the camera it will play over. A live video preview from the TriCaster is a possible later upgrade.
- **Pause Automation:** a large button plus a keyboard shortcut (see below).
- **Record:** starts and stops the TC1 recording, after the producer picks where the file should be saved.
- **Show clock:** elapsed time, the current section, and over/under.

**Importing graphics**

- On an episode, the producer clicks **Import graphics** and picks the files or folder, usually from the USB drive the graphics team hands her.
- File names follow `[Block][Section]_[Type]_[Slug]`, for example `B5_VO_Basketball.mov`. Types: L3, OTSL, OTSR, FSG, VO, SOT, PKG.
- The app reads each name and attaches the file to the matching cue in that section. `B5_VO_Basketball` goes to section B5's Take VO cue. It also reads each file's length and makes a thumbnail.
- It stops and asks the producer whenever it can't decide. For example: two files of the same type for one section (`B5_VO_Basketball1`, `B5_VO_Basketball2`), more files than cues, a cue with no file, a section that doesn't exist, or a name that doesn't follow the pattern. The producer drags each file onto the right cue.
- Formats: L3, OTS and FSG files are Apple ProRes 4444 with alpha in QuickTime (.mov). VO, SOT and PKG files are .mov or .mp4.
- **The media files never go to the cloud.** ProRes 4444 is far too large for free storage. Only file names, lengths and thumbnails sync to the website. The files stay on the laptop until they're sent to the TC1.

**Send to TriCaster (before the show, at the station)**

- One button copies the episode's files to the TC1, builds the DDR2 playlist in rundown order with each item named by section, and loads any green-screen backgrounds.
- The app then checks that the TC1 has everything and marks each element Ready or Missing. This also sets up the TD's fallback: the TC1 already holds the full show in order.
- The app also produces a one-page **TD fallback sheet** listing each section's camera, elements and DDR2 position.
- If the TC1 can't receive files over the cable, the TD loads DDR2 from the USB drive as today, and the app matches the playlist by file name.

**Cameras by section**

- Each section can name a camera in the rundown. For example, B2 is set to Weather Camera.
- When a section starts, the app takes its camera. When it ends, the app goes back to the show's default camera (Anchor Camera), unless the next section names a different one.
- The producer's camera buttons override this at any time.

**Green screen**

- **Decided Oct 28, 2026:** each show uses one green-screen background for the whole show. There is no green screen per section.
- **The show app has a single green-screen drop box.** The producer drops the image or clip for the show's background onto it, and the app loads it on the TC1 as the background used throughout the show.
- The TD sets up the green-screen M/E's LiveMatte key once and saves it in the TC1 session. After that nobody keys anything by hand.
- Stills go in GFX 1. A clip background needs a free player; DDR1 is free (confirmed Oct 28).

**Recording**

- Record asks where to save, then starts the TC1 recording. Files are named `Show_Episode_Date`.
- If the TC1 can only record to its own drives, the app copies the file to the chosen location over the cable after the show.

**Pause Automation and failures**

- **Pause** stops every command from the app at once. The prompter keeps scrolling, and the TD takes over on the physical panel. Pause goes over the cable, so it works even if the internet is down.
- **Resume** picks up from the prompter's current position and does not fire any cues that were passed while paused.
- **Lost prompter link:** if prompter events stop arriving, the app shows a banner. The producer can keep the show going by firing the next cue with the spacebar.
- **Simulator mode:** the app can run against a fake TriCaster for practice and testing. It talks to the real TC1 only when someone switches to live mode on purpose.

## Cue rules

Every element except MUSIC plays from DDR2 through DSK 2. Only one element is on DSK 2 at a time, so a new cue replaces whatever is up. When a section starts, its first element is cued in DDR2 so it's ready to fire.

| Element | Goes up | Comes off |
| --- | --- | --- |
| L3 | Its Take L3 cue reaches the reading line (usually the top of the section) | The section ends. It comes back up if a VO in the same section ends early. |
| OTSL / OTSR | Its cue reaches the reading line | The section ends |
| FSG | Its cue reaches the reading line | The section ends |
| VO | Its cue reaches the reading line, and DDR2 plays the clip while the anchor reads | **Clip ends first:** DSK 2 off, the anchors are back, and the section's L3 returns if it has one. **Section ends first:** DDR2 stops, DSK 2 off, back to the anchors. |
| SOT | Its cue reaches the reading line, and it plays with its own audio | The clip ends, then back to the anchors (assumed; to confirm) |
| PKG | Same as SOT | Same as SOT (assumed; to confirm) |
| MUSIC | Its cue reaches the reading line, and the Sound player plays the named track. It plays alongside DDR2, so graphics can go up over it. | The track ends (assumed; to confirm) |

A section "ends" when the next section's start crosses the prompter's reading line. Clip end comes from the TriCaster's own playback status when it's available. Otherwise it comes from the clip length measured at import.

## Technical decisions

These are settled. Claude Code should check current free-tier limits before committing to a specific service.

- **Free hosting only.** The website and its database must run on free tiers with no credit card. **Decided Oct 28, 2026: Cloudflare's free tier** (Workers for the website and sign-in, a D1 database, and one Durable Object per episode for Yjs co-editing and the cue relay), chosen over Supabase because Cloudflare doesn't pause free projects over breaks. It starts on RG's personal Cloudflare account and can move to a TSTV-owned account later. See `docs/ARCHITECTURE.md`.
- **Mac and Windows.** The website runs in any modern browser. The show app is one cross-platform desktop app (Electron is the likely choice) with installers for both.
- **No code-signing fees.** That means Mac and Windows warn on first install. Include the one-time "Open anyway" steps in the user guide.
- **Nothing installed on the TC1.** The station may not allow it. Changing a TC1 setting, such as a fixed network address or a shared folder, needs approval from whoever is responsible for the equipment.
- **Why a laptop app and not just a webpage.** Browsers block secure websites from sending commands to devices on a local cable. They also can't keep the open connection that reports clip status, or copy files onto the TC1. The app handles those parts.
- **Network.** One Ethernet cable from the TC1's open port, plus a USB-C-to-Ethernet adapter kept at the desk, connects any laptop. Wi-Fi stays on for the website. Use no wall jacks and no routers: UT policy forbids extending the campus network with your own wireless equipment.
- **Cue path.** Cues travel prompter computer → website → show app → TC1, because the prompter computer and the laptop can't talk directly on campus Wi-Fi. Target: under half a second from the reading line to the TriCaster. Measure this and show it in the app.
- **Media stays local.** Graphics and clips go from the laptop straight to the TC1 and never upload to the cloud.
- **Simulator first.** A fake TriCaster lets everything be built and practiced without the TC1, because time on the real switcher is limited. Real commands go out only in a clearly marked live mode.

## Verify on the TC1 first

The automation depends on what the TC1 accepts from another computer, and that isn't confirmed yet. Claude Code's first job is a probe tool that the TD runs in one session at the station and that saves everything it learns to a file. Version 7 TriCasters support macros and network control panels (LivePanel), and third-party controllers such as Bitfocus Companion talk to them over the network. The exact commands still have to be confirmed on this unit.

| Question | Why it matters | Fallback if the answer is no |
| --- | --- | --- |
| Can a laptop on the cable reach the TC1, and at what address? | Everything else depends on it | Adjust the TC1's network setting (needs approval) |
| Which remote-control interface does the TC1 accept, and what commands does it list? | Camera takes, DSK 2, DDR2 control | Have the TD build TriCaster macros once and trigger those |
| Can DDR2 jump to a specific playlist item, play, stop, and report when a clip ends? | VO rules, skipping, bringing the L3 back | Use the clip lengths measured at import as timers |
| Can files be copied onto the TC1 and loaded into DDR2 and GFX 1 remotely? | Send to TriCaster, green-screen drop | TD loads from USB; the app matches by file name |
| Can recording start and stop remotely, and can its save location be set? | Record button | Copy the file over the cable after the show |
| Can the app read what's on program, DSK 2 and the M/Es? | Showing the producer what's really on air | The app tracks state itself |

**Probe results, Oct 28, 2026** (details in `docs/TC1-FINDINGS.md`):

1. **Reach:** yes, with no settings changed.
2. **Interface:** yes. The web control on port 80 needs no password, and the port-5951 state stream and change notifications both work.
3. **DDR2:** partly confirmed. It reports the selected item, play and stop, the playlist, and seconds remaining. Jumping and playing get confirmed in live mode in Phase 5.
4. **Files:** file sharing is on but needs a Windows login on the TC1, which needs the owner's approval. Otherwise the fallback applies.
5. **Recording:** on and off is reported. The save location isn't exposed, so the TD sets it once.
6. **What's on air:** yes.

## Build plan

There's no deadline, so the plan aims for the fastest path to a first live test. Each phase ends with a short test RG can run, and the next phase waits for his OK. Phases 1–3 replace Rundown Creator on their own, even before any automation works.

0. **TriCaster probe and simulator.** The probe tool from the section above, plus a fake TriCaster that behaves like the TC1. Test: RG runs the probe at the station; Claude Code reads the results file.
1. **Website foundation.** Sign-in, Shows and Episodes, the rundown grid, timing, archive and export. Test: build a real episode's rundown.
2. **Script editor.** Section script pages with live co-editing, cue chips and talent tags. Test: two people edit the same script at once.
3. **Prompter.** Full-screen prompter with arrow-key control and live updates. Test: run a past show's script on the prompter computer.
4. **Show app on the simulator.** Producer screen, graphics import and matching, the cue engine with every rule above, cameras by section, Pause and manual cues. Test: a full mock show against the simulator.
5. **Real TC1.** Send to TriCaster, live cues, the green screen and recording on the switcher. Test: a rehearsal on the TC1 outside a show.
6. **Ship it.** Mac and Windows installers, a one-page producer guide, a pre-show checklist and the TD fallback sheet. Test: someone who has never used it runs a rehearsal from the guide alone.

## Open questions

- [ ] Do SOTs and packages play to the end and then go back to the anchors, as assumed?
- [x] Which TriCaster inputs are the three cameras, and which camera faces the green screen? *Inputs 1–3. Cameras 1 and 2 have prompter monitors; camera 3 is the wide shot. All three face the green screen.*
- [x] Is DDR1 free for green-screen video backgrounds? *Yes. It isn't used.*
- [ ] Who must approve changing TC1 settings (a fixed network address, a shared folder)? *No network change is needed. Copying files over the cable needs a Windows login on the TC1.*
- [ ] During a show, is the green-screen key on air the whole time behind the anchors, and through which M/E? The probe saw GFX 1 on program through M/E 1. *(There's no per-section green screen: decided Oct 28, 2026.)*
- [ ] How do the file types TEASE, NAMES, RDR and LITES (seen on the real DDR2 playlist) map to cues? Should the importer also accept spellings like `OTS_L` and names ending in `(1)` or `copy`?
- [ ] Intro music: which Sound player track is it ("PrimeTime Main"?), does it play to its end or stop when the tease ends, and does the sound board need to do anything for it?
- [ ] When the app builds the DDR2 playlist, should it put the break clip ("TSTV Ident 2022 News") at the start of each block, as TDs do today?
- [ ] Who may sign in to the website: invited people only, or anyone with a UT email?
- [ ] Should old Rundown Creator rundowns be imported, or does TSTV start fresh?
- [ ] Which TC1 network port has the new cable? Label it "Show laptop." *The cable works. The label still needs to go on.*

## Starter prompt for Claude Code

This file is `PROJECT_BRIEF.md`. Open Claude Code in the folder that holds it and paste the prompt below. The repo URL is already filled in.

```plain
You're building TSTV Show Automation for Texas Student Television. The full spec is in PROJECT_BRIEF.md in this folder. Read all of it before doing anything. It is the source of truth: if something in it is unclear or seems wrong, ask me instead of guessing.

About me: I'm RG, TSTV's technical director. I'm not a professional developer, so explain decisions in plain language and give me step-by-step test instructions I can follow.

Setup first:
1. I created the GitHub repo myself. Its URL is: https://github.com/rg-sureshkumar-goat/TSTV-TriCaster-Automation. Connect this folder to that repo, set up the project structure, and commit PROJECT_BRIEF.md as docs/PROJECT_BRIEF.md. Push to GitHub as you go. Never create GitHub repos yourself: if you need another one, ask me and I'll make it and give you the URL.
2. Write docs/ARCHITECTURE.md: the stack you recommend for the website, the prompter and the show app, and how the parts talk to each other. Check the current free-tier limits of every hosted service you pick. Everything must run at $0 with no credit card. Wait for my OK before building.

Then follow the Build plan in the brief, starting with Phase 0:
- Build the TriCaster probe: one command I run on a laptop connected to the TC1 by cable. It finds the TC1, discovers which remote-control interface it accepts and which commands and states it exposes, and saves everything to a results file I can send you. It must only read and never change anything on the switcher. Study bitfocus/node-tricaster on GitHub to see how other tools talk to TriCasters.
- Build the TriCaster simulator so every later phase can be developed and tested without the real switcher.

Rules for the whole project:
- Stop at the end of each phase. Summarize what you built, tell me exactly how to test it, and wait for my OK before starting the next phase.
- Never send a command to the real TC1 unless the app is in a clearly marked live mode that I turn on myself. Simulator mode is the default.
- Install nothing on the TC1. Media files never upload to the cloud.
- Everything must work on both Mac and Windows.
- When we change a decision, update docs/PROJECT_BRIEF.md in the same commit.
```

## Sources

- [NewTek TriCaster TC1 Version 7 new features (Videoguys)](https://videoguys.com/blogs/news-and-sales/newtek-tricaster-tc1-version-7-new-features)
- [TriCaster TC1SP panel specs: USB connectivity (Markertek)](https://www.markertek.com/product/tri-tc1sp/vizrt-tricaster-tc1sp-14-button-control-panel-for-tricaster-tc1)
- [Vizrt docs: control surface connections](https://docs.vizrt.com/viz-now-launchpad/1.4/Control_Surfaces_for_TriCaster_Now.html)
- [TriCaster user guide, Elite and Pro models: macros, LivePanel, media network sharing (UiO mirror)](https://www.uio.no/tjenester/it/lyd-video/db/driftsdokumentasjon/produktmanualer/tricaster.pdf)
- [@bitfocusas/tricaster, a Node library for network control of TriCasters](https://www.skypack.dev/view/@bitfocusas/tricaster)
- [Rundown Creator TriCaster Playout Controller](https://www1.rundowncreator.com/how-it-works/tricaster-playout-controller)
- [Rundown Creator teleprompter](https://www1.rundowncreator.com/how-it-works/teleprompter)
- [Rundown Creator API](https://www1.rundowncreator.com/api/getrundowns)
- [Rundown Studio vs. Rundown Creator (feature and pricing overview)](https://rundownstudio.app/blog/rundown-studio-vs-rundown-creator)
- [UT Austin: Management of UTnet Wireless Access policy](https://tech.utexas.edu/sites/default/files/documents/management-of-utnet-wireless-access-policy.pdf)
- [UT Austin wiki: connecting a device to utexas-iot](https://cloud.wikis.utexas.edu/wiki/spaces/TAR/pages/36864142/Connecting+a+Jetson+to+utexas-iot)
