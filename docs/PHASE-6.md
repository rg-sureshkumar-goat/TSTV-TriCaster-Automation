# Phase 6: ship it

Phase 6 turns RiGster into a normal Mac and Windows app that anyone can install, and adds the producer guide, the pre-show checklist and the TD fallback sheet. Decisions (RG, Oct 30, 2026):

- **Staying free:** RiGster isn't signed with a paid certificate, so Mac and Windows each ask once before opening it (steps below).
- **Updates:** Windows updates itself. The Mac shows a **Get RiGster …** button that opens the download page.

## Part 1: installers and updates (built)

- **Installers:** a .dmg for Macs with an Apple chip (M1 or newer), one for Intel Macs, and a Setup .exe for Windows. The app is called RiGster everywhere, including the Dock and the taskbar, with its own blue icon.
- **No terminal:** RiGster opens from Applications (Mac) or the Start menu (Windows) like any app.
- **Everything RiGster remembers carries over** from the version run from the terminal (the same folder on the laptop): the episode key, the graphics, the music, the green screen and the light or dark choice.
- **Still needed on each laptop: NDI Tools** (free, from ndi.video), for live mode. RiGster doesn't include NDI.
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

## Still to come in Phase 6

- A one-page producer guide
- A pre-show checklist
- The TD fallback sheet (if still wanted)
