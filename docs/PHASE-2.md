# Phase 2: script editor

Phase 2 turns each section's script box into a real script editor: several people can write at once and see each other's cursors, cues for the section's graphics sit in the text as locked chips, and speaker tags like `{Jordan}` show in that person's color. It also adds the admin **Usage** page.

## What's new

- **The script editor.** Click a slug in the rundown to open its script, as before. Now:
  - Everyone typing in the same script sees each other's cursor, with their name above it.
  - **Your Phase 1 scripts are kept, word for word.** The first time an episode opens after this update, its scripts are copied into the new editor, one paragraph per line. The old text is kept as a backup.
- **Cue chips.** A cue marks where a graphic fires: the prompter (Phase 3) sends the cue to the show app when that spot reaches the reading line.
  - The **Cues** row above the script lists the section's graphics from the rundown. Put the cursor where a graphic should fire, then click it. It drops in as a colored chip, like **Take L3 Score**, **★ Station ID** or **♪ PrimeTime Main**, in the same colors as the rundown.
  - A chip can't be typed over. Drag it to move it, or select it and press Delete.
  - Each graphic gets one cue. Once it's in the script, its button shows ✓.
  - **+ New graphic** adds a graphic to the section in the rundown and drops its cue at the cursor in one step.
  - Renaming a graphic in the rundown renames its chip. If a graphic is removed from the rundown, its chip turns into a red **Removed graphic** so you know to delete it.
  - **In the rundown, graphics with no cue in their script yet have a dashed outline.** Once every chip in a section is solid, that section is fully cued.
- **Speaker tags.** When several people read a section, each part starts with the person's name in curly brackets on its own line, like `{Jordan}`, as you already do.
  - Tags show in that person's color. A name that isn't one of the episode's anchors or correspondents gets a dotted red underline, which catches typos.
  - The **Speakers** row has a button for each of the section's readers, which starts a new part with their tag.
  - **Speaker tags and cue chips don't count as words**, so read times (and Est.) can drop slightly for scripts that have tags.
- **Usage page** (admins only): today's Cloudflare use against the free limits, with a bar for each. It needs a one-time setup, described below.

**Not yet:** the prompter (Phase 3), and firing the cues on the TriCaster (Phases 4 and 5).

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
8. Open **Usage** in the website's top bar. Any number Cloudflare can't report shows **Not available**; hover over it to see why, and tell me.

## The Phase 2 test: two people write the same scripts

You need a second person signed in (invite them on the **People** page).

1. **Your existing scripts:** open a few scripts in the October 26 episode. Check that the text is all there, line for line.
2. **Write together:** you and the other person open the same script and type at the same time, in different places. You should see:
   - each other's cursor, with a name
   - each other's typing within about a second, with no words lost
   - both names under "Edited by"
3. **Cues:** in a section with graphics, put the cursor where each graphic fires and click it in the **Cues** row. Check that:
   - the chip shows for the other person
   - its button now shows ✓
   - the word count doesn't change
   - you can drag a chip to a new spot, and delete it with Delete
4. **New graphic from the script:** click **+ New graphic**, pick one, and check it appears in the rundown's Graphics column with a solid (cued) outline.
5. **Rename and remove:** rename a graphic in the rundown and check the chip's name follows. Remove one and check its chip turns into a red **Removed graphic**.
6. **Speaker tags:** in a two-reader section, use the **Speakers** buttons to start each part. Type a wrong name, like `{Jordn}`, and check it gets a dotted red underline.
7. **Rundown:** go back to the rundown and check that cued graphics are solid and the rest are dashed.
8. **Usage:** after the setup above, open **Usage** and check the numbers look sensible: small numbers and bars near zero.
9. **Tell me** what's missing or awkward, and whether Phase 2 is approved.

## Behind the scenes

- Scripts are now shared editor documents (TipTap with Yjs) inside each episode room. The episode room copies each Phase 1 plain-text script in once and keeps the original text. Only the room creates scripts, so two people opening a new script at the same moment can't end up with two copies.
- A cue chip stores only its graphic's id, which is how the prompter and show app will find the graphic and its file.
- The Usage page asks Cloudflare's analytics API from the website's server, using `CF_API_TOKEN` and `CF_ACCOUNT_ID`. They're stored as Cloudflare secrets, never in the code.
