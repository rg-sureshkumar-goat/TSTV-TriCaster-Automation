# What we learned about TSTV's TC1

Probe run at the studio on Oct 28, 2026, plus RG's answers the same day. The full results file stays on RG's Mac in `tools/probe/results/`, because it holds the switcher's serial number and is kept off GitHub. The simulator now behaves the way this document describes.

## The six questions from the brief

| Question | Answer | Details |
| --- | --- | --- |
| Can a laptop on the cable reach the TC1, and at what address? | **Yes** | Both sides give themselves automatic addresses, so no settings change is needed. The TC1 was at **169.254.193.52** and kept that address after the cable was unplugged and replugged. Windows takes about a minute after the cable goes in to set its address. |
| Which remote-control interface does the TC1 accept? | **Yes** | It's the same web control Bitfocus Companion uses: port 80, `/v1/…`, **no password**. The port-5951 state stream and the change notifications both work. It's TriCaster TC1 software version 7-7, session "TSTV News PrimeTime". |
| Can DDR2 jump to a playlist item, play, stop, and report when a clip ends? | **Partly confirmed** | It reports the selected item, play and stop, the whole playlist, and seconds elapsed and remaining in the current clip. A clip ending by itself was seen. Jumping and playing are commands, to confirm in live mode (Phase 5). |
| Can files be copied onto the TC1 and loaded into DDR2 and GFX 1 remotely? | **Not without approval** | Windows file sharing is on, but it needs a Windows login on the TC1. That needs the TC1 owner's OK. The fallback is the TD loading from USB as today, with the app matching by file name. |
| Can recording start and stop remotely, and can its save location be set? | **Partly** | It reports recording on and off (`record_toggle`). The save location isn't exposed, so the TD sets it once on the TC1. Start and stop are commands, to confirm in Phase 5. |
| Can the app read what's on program, DSK 2 and the M/Es? | **Yes** | Program, preview, DSKs, M/E rows and tally are all readable. `program_tally` lists exactly what's on air, for example `INPUT2\|BFR11`. |

## How TSTV's TC1 is set up

- **Program runs through M/E 1.** The main program row shows M/E 1, and the TD switches cameras on **M/E 1's A row**. So the show app takes a camera by changing M/E 1's row, not the main row.
- **Cameras** are inputs 1, 2 and 3 (named INPUT 1–3 on the TC1).
  - Cameras 1 and 2 have prompter monitors and are used interchangeably for the anchors.
  - Camera 3 is the wide shot.
  - All three face the green screen.
- **Green screen is M/E 2:** a camera on its A row, keyed over **GFX 1** on its B row. Taking it to air means switching the main program row from M/E 1 to M/E 2. The TD did it as preview plus Auto.
- **DSK 2 shows DDR 2, and DDR 2 has AutoPlay on:**

  | You do this | The TC1 does this |
  | --- | --- |
  | Take DSK 2 on | DDR 2 starts playing the cued clip |
  | Press Play on DDR 2 | DSK 2 goes on |
  | Take DSK 2 off | DDR 2 stops and cues the next clip |
  | Press Stop on DDR 2 | DSK 2 stays on |
  | A clip ends by itself | DDR 2 stops; **DSK 2 stays on** until something takes it off |

  So "fire a cue" is one command, DSK 2 on, and the brief's rule "clip ends first: DSK 2 off" has to be sent by the app.
- **DDR 2 holds the whole show in order** (43 items in the session we read):
  - Each block starts with **"TSTV Ident 2022 News"** (about 5 seconds), the clip held during the commercial break.
  - Graphics (L3, OTS, FSG) are roughly 20-second `.mov` clips; packages and SOTs are their real length.
  - A few **"Second Transition"** effect items sit between clips.
- **DDR 1 ("A")** holds an unused commercial-break clip, so it's free for green-screen video backgrounds.
- **GFX 1** holds the green-screen backgrounds, such as "PrimeTime Main BG".
- **The Sound player ("SOUND")** holds the show's music: "PrimeTime Main" (`News_Under (1).wav`, 0:56) and "PrimeTime Transition Music" (0:21), both `.wav` files in the session's Stills\Import folder. AutoPlay is off. Its states include `sound_play`, `sound_stop`, `sound_select_clips` (cued track, counting from 0), `sound_volume` and `sound_mute`.
- **DSK 3** shows the bug from buffer 11.
- **Media lives on the TC1** in the session's Import folders, such as `D:\Sessions\TSTV News PrimeTime\Clips\Import\`.
- **The prompter computer** is a Mac running Safari.

## File names on the real playlist

TSTV already names files `[Block][Section]_[Type]_[Slug]`, but the real names differ from the brief in a few ways. The importer will need to handle these:

- **More types:** TEASE, NAMES, RDR and LITES appear alongside L3, OTSL/OTSR, FSG, VO, SOT and PKG.
- **Different spellings:** `OTS_L` and `OTS_R` as well as `OTSL` and `OTSR`, and a double underscore (`A12__OTSR_…`).
- **Copies:** `(1)` or `copy` at the end, as in `A9_NAMES_ANCHORNAMES (1)`.
- **Spaces** inside slugs (`B17_OTS_R_BEVO LAB`).

## Technical details for the show app

- **Web API, port 80.**
  - `/v1/version` returns `<product_information>` with child elements.
  - `/v1/dictionary?key=…` works for `shortcut_states`, `tally`, `switcher`, `macros_list`, `switcher_ui_effects`, `ddr_playlist`, `ddr_timecode` and `record_configuration`.
  - **Asking for any other key drops the connection** instead of answering 404.
- **Change notifications** at `ws://<tc1>/v1/change_notifications`.
  - Each message is a key name **followed by a null character**: `tally\0`, `switcher\0`, `shortcut_states\0`, `ddr_playlist\0`, `ddr_timecode\0`, `record_configuration\0`.
  - Some messages name a single state: `state.ddr2_play\0`, `state.media_stop\0`.
- **State stream, port 5951.** After `<register name="NTK_states"/>`, the TC1 sends `<build number="210722" product="TC1" session="…" />`, then every state as `<shortcut_state name value type sender />`.
  - It lists about 3,400 states, most of them copies for other control-panel models (`minics_`, `strip1_`, `cs450_`…), which can be ignored.
- **Useful states and their formats:**

  | State | Example | Meaning |
  | --- | --- | --- |
  | `main_a_row_named_input` / `main_a_row` | `V1` / `43` | Program row (`V2` = green screen) |
  | `v1_a_row_named_input` | `INPUT2` | Camera on M/E 1 |
  | `v2_a_row_named_input`, `v2_b_row_named_input` | `INPUT2`, `GFX1` | Green-screen camera and background |
  | `main_dsk2_value` / `main_dsk2_take` | `1` / `true` | DSK 2 on air |
  | `main_dsk2_select_named_input` | `ddr2` | DSK 2's source |
  | `ddr2_play` / `ddr2_stop` | `true` / `false` | DDR 2 playing |
  | `ddr2_select_clips` | `21\|` | Cued DDR 2 item, counting from 0 |
  | `ddr2_autoplay_mode_toggle` | `true` | AutoPlay on |
  | `record_toggle` | `1` | Recording |
  | `program_tally` | `INPUT2\|BFR11` | What's on air |

- **Source numbers** (the TC1's tally index) are fixed:

  | Sources | Numbers |
  | --- | --- |
  | Inputs 1–16 | 0–15 |
  | Buffers 1–15 | 16–30 |
  | DDR1, DDR2 | 39, 40 |
  | GFX1, GFX2 | 41, 42 |
  | M/E 1–4 | 43–46 |
  | Black | −1 |
- **Commands are still unconfirmed.** The probe only reads. In Phase 5, live mode confirms the command names: `v1_a_row`, `main_a_row`, `main_dsk2_take`/`auto`, DDR 2 select and play, and `record_toggle`. If any are missing, the fallback is TriCaster macros the TD builds once.

## Video feeds (NDI), checked Oct 29, 2026

RG ran the probe at the studio (version 1.1), and I checked the cable from the laptop while he was there.

- **The TC1 sends 8 NDI video feeds over the cable:** `TC1-1FD7311C (1)` to `(4)` on ports 5961–5964, and `TC1-1FD7311C (MIX 1)` to `(MIX 4)` on ports 5965–5968, all in the "Public" group.
- **How they were found:** the probe's own "who's there?" question got no answer, but the Mac's system service (`dns-sd -B _ndi._tcp`) listed all eight. The TC1 also sends the full list to anyone who connects to **port 5960**, without being asked. The probe now reads that list (and still sends nothing).
- **All four mix outputs show Program:** `mix1_output_source` to `mix4_output_source` are all `program`. They can presumably be set to other sources, which would be a TC1 setting change (owner's OK).
- **Watching them:** in NDI Video Monitor on the laptop, feeds (1) to (4) each showed the same still picture (probably from Camera 1), and after reopening the app, only black. The laptop had no TCP connection to the TC1 while watching. NDI's newer UDP transport may be blocked by the TC1's Windows firewall on this cable, or the numbered feeds may not be live cameras. **Not yet known:** which feed, if any, is each camera, and whether the MIX feeds play live on the laptop.
- **Inputs 1–3 are Cameras 1–3** (RG).
- TSTV streams to YouTube straight from the TC1.

## NDI both ways over the cable, tested Oct 30, 2026 (Phase 5)

RG at the studio, laptop on the TC1's cable (laptop 169.254.41.47, TC1 169.254.193.52). Test scripts used the NDI runtime that comes with NDI Tools on the Mac, through koffi; nothing was installed on the TC1, and no TC1 commands were sent. RG made the TC1 changes by hand and didn't save the session.

- **Laptop → TC1, picture:** the laptop offered a 1920×1080 NDI source, "TSTV Show App (test)": a blue bar, a white strip and a red square on a see-through background. On the TC1 it shows in input 4's source drop-down under **NDI_E29C47193CAF0BD9** (newer NDI announces the laptop under a coded name, not its computer name). Input 4 showed the shapes, and the laptop counted 2 connections from the TC1.
- **See-through parts work:** with DSK 1's source set to input 4 and DSK 1 taken, Program showed Camera 1 with the green-screen background and the shapes on top. So the TC1 keys an NDI source's alpha. (RG used DSK 1, which shows don't use.)
- **Laptop → TC1, sound:** a 440 Hz test tone sent with the picture moved input 4's meters in the TC1's **AUDIO MIXER** (a tab beside **SOUND** under the PGM/PREV rows); the channel was muted, as inputs are until the TD unmutes them.
- **TC1 → laptop, video:** feeds `(1)`, `(2)` and `(3)` are the three cameras (three angles of the green-screen set; `(3)` the wide shot) at **1280×720, 59.94 fps, progressive**, received at a steady 60 frames a second. `(MIX 1)` is program, the same. `(4)` was black (input 4 empty, 1920×1080). Oct 29's still-then-black was NDI Video Monitor; the app's own receiver gets live frames.
- **The TC1 doesn't re-send an NDI input:** once input 4 was the laptop's source, feed `(4)` disappeared.
- **Program sound** comes in MIX 1 (48 kHz, 4 channels).
- **From RG's photo of the screen:** the media players are labeled **A** and **B**; the show's playlist (TSTV Ident 2022 News, A2_TEASE_…, Intro Sequence Fall 2023, …) is in **B** (DDR 2), with Autoplay on. **DSK 2's source is B**; DSK 3 is BUG, DSK 4 is A. Player **A** holds "PrimeTime Main BG" (a 5:00 clip), the green-screen background, and two "TSTV News Commercial" clips.
- **Also on the screen:** EXPORT, STREAM / ENCODE, RECORD / REPLAY and GRAB along the top.

## Camera command, confirmed Oct 30, 2026 (Phase 5)

With RG's OK, in live mode, at the studio: `v1_a_row=INPUT2` is answered OK but **changes nothing**; the TC1 wants either the source's number on `v1_a_row` (`1` is input 2, counting from 0) or its name on **`v1_a_row_named_input=INPUT2`**. The show app uses the named form. (The simulator, built from the earlier guess, had accepted the name; it now ignores it, as the TC1 does.)

## Network notes

- **Oct 30, 2026 (Phase 5): the Mac sent the TC1's traffic over Wi-Fi.** After working all session, the laptop suddenly couldn't reach 169.254.193.52: macOS had routed the self-assigned range to Wi-Fi (`route get` showed en0). Sending from the cable's own address (curl `--interface`, Node `localAddress`) reached it at once. The show app's live mode now sends everything to the TC1 (web control, state stream, change notifications) from the cable's address, as the probe does.

- The laptop's USB Ethernet adapter linked at 1 gigabit, full duplex.
- **On a Mac, the automatic-address range is also attached to Wi-Fi.** A first version of the probe searched all 65,000 automatic addresses. That burst of traffic coincided with campus Wi-Fi dropping twice, and the search missed the TC1. The search was removed. The probe and the show app now wait quietly for the TC1 to announce itself, and the show app will remember the TC1's last address.
- Reading the Mac's device list with plain `arp -a` stalls when Wi-Fi is down, because it looks up names. Use `arp -an`.
