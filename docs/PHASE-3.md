# Phase 3: prompter

Phase 3 adds the prompter: a full-screen page of the website for the prompter computer, run from the keyboard by the prompter operator. It shows every section that airs, in rundown order, straight from the live episode, so script changes show up within about a second.

## What's new

- **Open prompter.** Each episode has an **Open prompter** button at the top. It opens the prompter in a new window. Its address, `/prompter/<episode>`, can be bookmarked on the prompter computer.
- **What it shows:**
  - each section starts with its number, in green on a red box, and the camera to look at, like **A2 CAMERA 2**
  - a cross-talk section just says **CROSS TALK**
  - speaker tags like `{JORDAN}` become a marker in that person's color
  - cues are bold colored markers, like **TAKE L3 SCORE**, in the rundown's colors
  - block headers, commercial breaks (with their length) and **END OF SHOW**
  - floated sections are left out
- **Keys:**

  | Key | What it does |
  | --- | --- |
  | ↑ | Faster |
  | ↓ | Slower; past a stop it runs backwards, faster with each press |
  | Space | Pause and resume |
  | Page Down or → | Next section |
  | Page Up or ← | Back to the start of this section, then the one before |
  | H or Home | Back to the top, stopped |
  | F | Full screen |
  | S | Settings |
  | ? | This list of keys |

  The **Go to section** list at the top (next to Keys, Settings and Full screen; move the mouse to show them) lists every section by number and slug, like **A2 · Basketball Wins**. Picking one jumps there and starts it. The mouse wheel nudges the text. A small line at the bottom left shows the speed and the section, for the operator.
- **Settings** (press S), saved on that computer: text size, line spacing, side margins, where the reading line is, **Marker Size** (the size of the reading-line arrows), how much each arrow press changes the speed, and the text and background colors. **Back to the defaults** undoes them. There's no mirror setting. Press **Esc** (or **Close**) when you're done, so the arrow keys go back to running the prompter.
- **Edits while it runs.** Script edits appear as they're made. The line on the reading line stays exactly where it is, even when someone adds or removes lines above it.
- **Cues.** The big white arrows at each side mark the reading line. When a section start or a cue crosses it, the prompter sends that to the episode. For now, the rundown page shows it in a **Prompter** bar: where the prompter is, its speed, and the last cue it fired. From Phase 4 the show app fires them on the TriCaster. Jumping with Page Down starts the section it lands on, but doesn't fire the cues it skipped.
- **If the internet drops**, the prompter keeps going with the copy it saved on that computer, and shows a small yellow warning. Edits come through again when the connection returns.

## Set up the prompter computer (one time)

1. On **People**, invite the Google account the prompter computer will use. A TSTV station Gmail is best, rather than someone's own. Leave **Give Admin Access** unticked.
2. On the prompter computer, open <https://tstv-show.tstv-rundown.workers.dev> in Safari and sign in with that account. Type a first and last name when asked, like "Studio Prompter".
3. Open tonight's episode and click **Open prompter**. Bookmark the page if you like.
4. Press **F** for full screen, and **S** to set the text size and colors.

## The Phase 3 test: run a past show on the prompter computer

1. **Deploy** (see below), then on the prompter computer open the October 26 episode and click **Open prompter**.
2. **Looks:** check each section's number (green on red) and camera, the speaker markers in their colors, the cue markers, and that floated sections are missing. Set the text size and colors with **S**, then reload: they should stay.
3. **Keys:** run through the script with ↑ and ↓, including backwards, Space, Page Down, Page Up and H. Try **Go to section** too. Check the speed feels right for your anchors. If each press is too big or too small a step, change **Speed change per arrow press** in the settings.
4. **Cues:** on another computer, open the same episode's rundown. As the prompter scrolls, check the **Prompter** bar shows the right section and each cue as it crosses the white arrows.
5. **Live edits:** while the prompter scrolls, have someone change the script of the section being read, and of one above it. The text should change without the line being read jumping.
6. **Internet drop:** turn off the prompter computer's Wi-Fi for a minute. It should keep scrolling with a yellow warning, then catch up when Wi-Fi is back.
7. **Monitors:** check it reads well on the camera monitors and the mirror.
8. **Tell me** what's missing or awkward, and whether Phase 3 is approved.

## Deploying

```bash
cd "/Users/rg_sureshkumar/AI Apps/TSTV Automated Technical Director/apps/web" && npm run deploy
```

## Behind the scenes

- The prompter reads the same live episode room as the editors. Each script line keeps a permanent key, so when the text changes the prompter finds the line that was on the reading line and puts it back in the same spot.
- Scrolling happens in the browser 60 times a second without redrawing the page, which keeps it smooth.
- Section starts and cues are sent to the episode room as they cross the reading line while scrolling forward. The room stamps the time and passes them on. The prompter's position and speed go out about 4 times a second.
- A copy of the episode is saved in the prompter computer's browser every 5 seconds, for internet drops.
- The browser tests run the prompter in both Chrome and Safari's engine.
