# Phase 0 testing: probe and simulator

There are two parts. **Part A** runs at home on your Mac and checks that the simulator works and the probe sends nothing. **Part B** runs at the station with the real TC1, outside a show.

Commands go in **Terminal** (Mac) or **PowerShell** (Windows), typed one at a time.

## Part A: at home (about 15 minutes)

### 1. Get the latest code and tools

```bash
cd "/Users/rg_sureshkumar/AI Apps/TSTV Automated Technical Director"
```

```bash
git pull
```

```bash
npm install
```

`npm install` downloads the development tools into the `node_modules` folder. You only need to run it again when the tools change.

### 2. Run the automated tests

```bash
npm test
```

✅ **Expect:** a line like `Tests 63 passed (63)`, with nothing failed. This takes about 40 seconds. One of these tests runs the real probe against the simulator and checks that the simulator received zero commands.

### 3. Start the simulator

```bash
npm run simulator
```

✅ **Expect:**

- The terminal prints "TSTV TriCaster simulator is running. This is NOT the real TC1."
- Your browser opens the simulator page, which has an orange **SIMULATOR** bar across the top. If it doesn't open, go to <http://127.0.0.1:8080/sim/>.

Try the page. These clicks act like the TD pressing panel buttons:

1. Next to **Cameras**, click **Camera 2**. The red Program monitor shows Camera 2.
2. Next to **DSK 2**, click **Off: take on**. A blue bar appears at the bottom of the Program monitor, and **On air now** lists the DSK 2 clip.
3. In the **DDR 2** list, click item 1 (`A1_L3_Anchors`), then **Play**. The time counts up, and the clip stops by itself after 8 seconds.
4. Next to **Green screen**, click **Take to air**. The monitor shows Camera 3 on the green screen.
5. Scroll down to **What the show app sent**. It says "Nothing yet". Your clicks stand in for the TD at the panel, so they don't appear there.

Leave the simulator running.

### 4. Run the probe against the simulator

Open a second terminal window (**Cmd+N**). Then run:

```bash
cd "/Users/rg_sureshkumar/AI Apps/TSTV Automated Technical Director"
```

```bash
npm run probe -- --host 127.0.0.1:8080
```

The probe connects and walks you through the panel steps.

1. Step 1 waits 10 seconds by itself.
2. For each step after that, use the matching button on the simulator page, then press **Enter** in the terminal:
   - camera step: **Camera 2**, then **Camera 1**
   - DSK 2 step: on, then off
   - DDR 2 steps: a list item, then **Play** and **Stop**
   - green-screen step: **Take to air**, then a camera
   - record step: **Record**, then stop
3. The page has no GFX 1 button, so type `s` and Enter to skip that step.

✅ **Expect at the end:**

- A summary with **YES** next to "Can a laptop on the cable reach the TC1" and "Which remote-control interface".
- It reports "TSTV Simulator, 7-7 (simulated)".
- Two files in `tools/probe/results/`.
- **Most important:** on the simulator page, **What the show app sent** still says **"Nothing yet"**. That proves the probe sent no commands.

### 5. Practice the password case

1. At the bottom of the simulator page, click **Practice problems** to open it.
2. Type `test` in **LivePanel password** and click **Apply**.
3. Run the probe again (the same command as step 4).

✅ **Expect:** "The TC1 asks for its LivePanel password." For username, press Enter. For password, type `test` (it shows `****`). The probe then says "Password accepted."

When you're done, click **Reset everything** under **Practice problems**, then press **Ctrl+C** in the simulator's terminal window.

## Part B: at the station with the TC1 (about 15 minutes)

Do this when **no show is running**. The probe only reads, but step 4 asks you to press a few panel buttons yourself.

### Before you go

- Bring your Mac, the USB-C-to-Ethernet adapter and the Ethernet cable.
- On your Mac, run `git pull` in the project folder so you have the latest probe.

**If you use a different laptop:**

1. Install Node.js "LTS" from <https://nodejs.org>.
2. On GitHub, click **Code → Download ZIP** and unzip it.
3. Open a terminal in that folder.

The probe needs nothing else. You don't need `npm install` for it.

### 1. Connect the cable

1. Plug the Ethernet cable into the TC1's open Ethernet port. Put a **"Show laptop"** label on that port while you're there; it's an open question in the brief.
2. Plug the other end into the USB-C-to-Ethernet adapter, and the adapter into the laptop. Wait for the link lights.
3. Leave Wi-Fi on. It doesn't matter for the probe.

Don't change any settings on the TC1 or the laptop.

### 2. Run the probe

```bash
cd "/Users/rg_sureshkumar/AI Apps/TSTV Automated Technical Director"
```

```bash
npm run probe
```

**If your computer asks for permission:**

- **Mac, "Terminal would like to find and connect to devices on your local network":** click **Allow**. If you already clicked Don't Allow, go to System Settings → Privacy & Security → Local Network, turn on **Terminal**, and run the probe again.
- **Mac, "accept incoming network connections" for `node`:** click **Allow**.
- **Windows Firewall window for Node.js:** click **Allow**. It's about the laptop, not the TC1.

### 3. Let it search

The probe:

1. Shows the cable adapter it found.
2. If needed, waits up to a minute for an automatic address.
3. Lists any devices it sees.

If nothing answers right away, it searches every automatic address, which takes up to 2 minutes and shows progress in percent.

If it asks for the **LivePanel password**, type it, or just press Enter to skip. The password isn't saved.

### 4. Do the panel steps

The probe asks for these one at a time. Do each one on the TC1SP panel or the TC1 screen, then press **Enter**. Type `s` and Enter to skip any step.

1. Hands off for 10 seconds. This one runs by itself.
2. Take a different camera to Program, then take the first one back.
3. Turn DSK 2 on, wait a second, then turn it off.
4. In DDR2, click a different playlist item, but don't play it.
5. Play that DDR2 item for a few seconds, then stop it.
6. If DDR2 has a clip under 20 seconds, play it and let it end by itself.
7. In GFX 1, select a different still, then select the original again.
8. Take M/E 2 (the green-screen M/E) to Program, then take the camera back.
9. Optional: record for 5 seconds, then stop.

These steps tell us which TriCaster state names move for cameras, DSK 2, DDR2, GFX 1, M/E 2 and recording. That's exactly what the show app needs to watch.

### 5. Send me the results

The probe prints a summary and saves two files in `tools/probe/results/`.

- **Ran it on your Mac in this project folder?** Just tell me "probe results are in," and I'll read them directly.
- **Used another laptop?** Send yourself the `.json` file, put it in `tools/probe/results/` on your Mac, and tell me.

### If it says "Could not find the TC1"

- Check that both link lights on the cable are on, then run the probe again.
- The summary and results file still help, so send them anyway. They show what the laptop saw on the cable, including a TC1 with a fixed address.
- **Only if you're allowed to look at the TC1's Windows desktop without changing anything:** run `ipconfig` in a Command Prompt there to see the port's address. Then run this on the laptop, putting that address in place of `<address>`:

```bash
npm run probe -- --host <address>
```

## What happens with the results

I'll read the results and do four things:

1. Answer each question in the brief's "Verify on the TC1 first" table.
2. Update the simulator so its names and replies match our TC1 exactly.
3. Note anything that needs the TC1 owner's approval.
4. Bring it all back to you before Phase 1 starts.
