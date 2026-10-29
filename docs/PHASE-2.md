# Phase 2: script editor

Phase 2 turns each section's script box into a real script editor: several people can write at once and see each other's cursors, cues for the section's graphics sit in the script as locked chips, and speaker tags like `{JORDAN}` show in that person's color. It also adds the admin **Usage** page.

## What's new

- **The script window.** Click a slug in the rundown and its script opens in a window over the rundown, which stays in view behind it. Close it with **×**, the **Escape** key or a click outside it. **←** and **→** at the bottom go to the previous and next sections.
  - Everyone typing in the same script sees each other's cursor, with their name above it.
  - **Capital letters only.** Whatever you type or paste comes out in capitals, whether Caps Lock is on or off.
  - **Your Phase 1 scripts are kept, word for word.** The first time an episode opens after this update, its scripts are copied into the new editor, one paragraph per line, and switched to capitals. The old text is kept as a backup.
- **Readers' names are filled in.** A script with no words yet starts with each reader's name in curly brackets, like `{JORDAN}`, from the section's Talent, each with an empty line under it to write on. Until someone writes in it, the names follow the Talent if it changes. A written script with one reader and no name gets the name at the top. Written scripts with several readers are left as they are, since only the writer knows where each part starts. Cross talk gets no names.
- **Story Type.** The rundown's Type column is now called **Story Type**, in exports too. Each show's list of choices is under **Story types** in its settings.
- **Cue chips.** A cue marks where a graphic fires: the prompter (Phase 3) sends the cue to the show app when that spot reaches the reading line.
  - The **Cues** row above the script lists the section's graphics from the rundown. Put the cursor where a graphic should fire, then click it. It drops in as a colored chip, like **Take L3 Score**, **★ Station ID** or **♪ PrimeTime Main**, in the same colors as the rundown.
  - **Each cue gets a line of its own.** If the cursor is in the middle of a line, the line splits around the cue. The cursor ends up on the line below, so you can keep typing. Cues you placed before this update moved to their own lines too.
  - A chip can't be typed over. Drag it to move it to another line, or click it and press Delete.
  - Each graphic gets one cue. Once it's in the script, its button shows ✓.
  - **+ New graphic** adds a graphic to the section in the rundown and drops its cue at the cursor in one step.
  - Renaming a graphic in the rundown renames its chip. If a graphic is removed from the rundown, its chip turns into a red **Removed graphic** so you know to delete it.
  - **In the rundown, graphics with no cue in their script yet have a dashed outline.** Once every chip in a section is solid, that section is fully cued.
- **Speaker tags.** When several people read a section, each part starts with the person's name in curly brackets on its own line, like `{JORDAN}`, as you already do.
  - Tags show in that person's color. A name that isn't one of the episode's anchors or correspondents gets a dotted red underline, which catches typos.
  - The **Speakers** row has a button for each of the section's readers, which starts a new part with their name.
  - **Speaker tags and cue chips don't count as words**, so read times (and Est.) can drop slightly for scripts that have tags.
- **Usage page** (admins only): today's Cloudflare use against the free limits, with a bar for each. It needs a one-time setup, described below.

**Not yet:** the prompter (Phase 3), and firing the cues on the TriCaster (Phases 4 and 5).

## Also in this update: accounts, shows and breaks

- **Admin and Contributor accounts.** Your name at the top right says which you are. On **People**, tick **Give Admin Access** when inviting someone to make them an admin. Click a person's name to give an existing contributor admin access.
- **Names.** The first time anyone signs in, including you after this update, they type their first and last name.
- **Top bar.** At the top left: a light/dark switch for the whole website and, for admins, an **ⓘ** that opens the Usage page. The menu reads Shows, People, Search.
- **Shows page.** **Add a show** is at the top, with an optional logo. A **List / Cards** switch changes the layout. A show's logo can be changed in its settings.
- **Deleting episodes.** Admins see **Delete** next to each episode in a show's list, and on the episode itself. It erases the rundown and scripts for good, after a warning.
- **Commercial breaks.** Admins can type a different length on a break's line, remove a break with its **×**, and add one with **Add a commercial break above** in any row's ⋯ menu.

**Test it:**

1. Sign in: you're asked for your first and last name once. Check the top right then shows your name and "(Admin)".
2. Flip the light/dark switch, reload, and check it stays. Click the **ⓘ** for Usage.
3. On **People**, invite a test email with **Give Admin Access** ticked and check it's listed as Admin. Click a contributor's name and check **Give Admin Access** works. Sign in as a contributor and check there's no People, ⓘ, Delete or break controls.
4. On **Shows**, add a show with a logo, then switch between List and Cards.
5. In a test episode, change a break's length, remove it, and add one above a section. Check the total and back-times follow.
6. Delete that test episode and check it's gone.

## Set up the Usage page (one time, about 5 minutes)

The Usage page reads your Cloudflare account's usage numbers, which needs a **read-only** API token. You create it; I never see it.

1. Go to <https://dash.cloudflare.com/profile/api-tokens> and click **Create Token**.
2. Next to **Create Custom Token**, click **Get started**.
3. **Token name:** `TSTV Usage page (read-only)`.
4. **Permissions:** choose **Account** → **Account Analytics** → **Read**. That's the only permission it needs.
5. **Account Resources:** **Include** → your account.
6. Click **Continue to summary**, then **Create Token**, and copy the token. Cloudflare shows it only once.
7. In Terminal, run these one at a time from the website folder, and paste when asked:

   ```bash
   cd "/Users/rg_sureshkumar/AI Apps/TSTV Automated Technical Director/apps/web"
   ```

   ```bash
   npx wrangler secret put CF_API_TOKEN
   ```

   Paste the token, then press Enter.

   ```bash
   npx wrangler secret put CF_ACCOUNT_ID
   ```

   Paste your account ID (on the right side of the Cloudflare dashboard's **Workers & Pages** page), then press Enter.
8. Click the **ⓘ** at the top left of the website to open Usage. Any number Cloudflare can't report shows **Not available**; hover over it to see why, and tell me.

## The Phase 2 test: two people write the same scripts

You need a second person signed in (invite them on the **People** page).

1. **Your existing scripts:** click a few slugs in the October 26 episode. Check that:
   - each script opens in a window over the rundown, and **×**, **Escape** and a click outside it each close it
   - the text is all there, line for line, now in capitals
   - one-reader scripts have the reader's `{NAME}` at the top
2. **Names filled in:** add a new section, tick two people in its Talent, and open its script. Both names should be there in curly brackets, each with an empty line under it. Untick one, and their name should go.
3. **Write together:** you and the other person open the same script and type at the same time, in different places, with Caps Lock off. You should see:
   - everything in capitals
   - each other's cursor, with a name
   - each other's typing within about a second, with no words lost
   - both names under "Edited by"
4. **Cues:** in a section with graphics, put the cursor in the middle of a line where a graphic fires and click it in the **Cues** row. Check that:
   - the chip goes on a line of its own, splitting the line, with the cursor on the line below
   - the chip shows for the other person
   - its button now shows ✓
   - the word count doesn't change
   - you can drag a chip to another line, and delete it with Delete
5. **New graphic from the script:** click **+ New graphic**, pick one, and check it appears in the rundown's Graphics column with a solid (cued) outline.
6. **Rename and remove:** rename a graphic in the rundown and check the chip's name follows. Remove one and check its chip turns into a red **Removed graphic**.
7. **Speaker tags:** in a two-reader section, use the **Speakers** buttons to start each part. Type a wrong name, like `{JORDN}`, and check it gets a dotted red underline.
8. **Rundown:** close the window and check that cued graphics are solid and the rest are dashed, and that the **Story Type** column has its new name.
9. **Usage:** after the setup above, click the **ⓘ** and check the numbers look sensible: small numbers and bars near zero.
10. **Tell me** what's missing or awkward, and whether Phase 2 is approved.

## Behind the scenes

- Scripts are now shared editor documents (TipTap with Yjs) inside each episode room. The episode room copies each Phase 1 plain-text script in once and keeps the original text. Only the room creates scripts and fills in readers' names, so two people opening a new script at the same moment can't end up with two copies.
- On Oct 29, 2026 each episode room updated its scripts once, the first time it opened after the update: cues moved to lines of their own and the text switched to capitals. The script window uses the rundown page's own live connection, so opening a script doesn't start a second one.
- A cue chip stores only its graphic's id, which is how the prompter and show app will find the graphic and its file.
- The Usage page asks Cloudflare's analytics API from the website's server, using `CF_API_TOKEN` and `CF_ACCOUNT_ID`. They're stored as Cloudflare secrets, never in the code.
