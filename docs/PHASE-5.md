# Phase 5: the real TC1

*Plan, Oct 30, 2026. This becomes the Phase 5 test guide as it's built.*

Phase 5 connects the show app to TSTV's real TriCaster TC1. Decisions (RG, Oct 30, 2026):

- **Graphics go to the TC1 over NDI from the laptop.** The drive stays on the laptop, nothing is copied to the TC1, and the TC1 needs no Windows login. The app plays each graphic and sends it as a live NDI source; on the TC1, DSK 2's source is set to it once and saved in the session.
- **Camera video is part of Phase 5**, over NDI.
- **Recordings end up on the laptop**: the app records the TC1's program feed over NDI.

## Steps

### At home (no studio time)

1. **Live mode with its three safety locks.** The app always opens in simulator mode. Live mode takes a switch and a confirmation, then a red "LIVE: TC1" bar stays across the top. In live mode the app talks only to a device that says it's TSTV's TC1.
2. **Finding the TC1 on the cable**, as the probe does: remember its last address, wait for it to announce itself, and send only from the cable, never across campus Wi-Fi.
3. **NDI in the app** (proven on the laptop Oct 30, 2026): the app sends the clip on Program as an NDI source with its see-through parts and sound, receives the cameras' feeds for the camera boxes, and can record a feed to the laptop.
4. **The live driver**: cameras on M/E 1, DSK 2 on and off, the Sound fader as the NDI source's level, and Record.
5. **A studio check tool**: one harmless step at a time, each confirmed by RG at the TC1.

### At the studio (outside a show)

6. **Done Oct 30, 2026: NDI over the cable works both ways** (see `docs/TC1-FINDINGS.md`): the laptop's see-through graphic keyed over Camera 1 on a spare DSK, its sound reached the TC1's mixer, and the cameras' and program feeds play live on the laptop. Asked at the time: does the TC1 see the laptop's source, and key it on DSK 2 with its see-through parts? Do the TC1's camera feeds play on the laptop? Which feed is which camera?
7. **Commands**: cameras, DSK 2, and recording, one at a time.
8. **The Phase 5 test: a rehearsal on the TC1 outside a show**, including back-to-back teases.

## What RG needs

- Studio time outside a show, with the laptop on the TC1's cable.
- On the TC1, in the TSTV session: add the laptop's NDI source as an input, and set DSK 2's source to it. (A switcher setting, like the green-screen key; nothing installed, no Windows change.)
