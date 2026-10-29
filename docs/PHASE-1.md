# Phase 1: website foundation

**Approved by RG on Oct 29, 2026.** RG rebuilt a real episode ("October 26 PrimeTime Show", 55 sections in 5 blocks) on the live website. Two people editing at once was checked by the automated browser tests rather than by two real people, so it gets a real-world check in the Phase 2 test. The admin usage panel moves to the next phase.

Phase 1 covers sign-in, shows and episodes, the live rundown grid, timing, archive and export. This page explains how to try it on your Mac, how to put it online (one time, about 30 minutes), and how to run the Phase 1 test.

## What's in Phase 1

- **Sign in with Google**, open only to people the TD invites. The **People** page (admins only) is where you invite and remove people.
- **Shows.** Anyone can add a show. Each show has settings for:
  - target length (default 30:00)
  - reading speed
  - camera names and the default camera
  - usual talent, each with a color
  - segment types (Intro, Tease, Reader, Cross Talk, Q&A, Package, SOT, Permanent Graphic)
  - permanent graphics used in every episode (Station ID, Show Intro, Commercial Break, Social Media L3, Website L3, Station Outro)
  - commercial break length
- **Episodes**, each with a title, air date and start time, and an **Anchors / Correspondents** section where the producer enters that episode's on-air talent. Each person gets a color, and a section whose Talent is set to them shows that color. The PDF export lists them at the top.
- **The rundown grid**:
  - Blocks A, B, C, with sections numbered A1, A2, B1. Numbers update when rows move.
  - Columns: Slug, Type, Writer, Talent, Camera, Headline, Graphics, Notes, Assign Graphics, Est., Back-time, and Last edit. The column headers stay at the top as you scroll. There's no green-screen column, because each show's background is set once in the show app (Phase 4).
  - **Writer**, **Headline**, **Notes** and **Assign Graphics** are typed in.
  - **Talent:** click the cell and tick everyone who reads the section, from this episode's anchors and correspondents. Several people can share a section (they mark their parts in the script with `{Name}`). **Everyone (cross talk)** is for unscripted cross talk, and the prompter will just say CROSS TALK.
  - **Graphics:** what plays during a section, in order, for example an L3 and then a VO over the anchor during a Reader. Click **+** to add one (L3, OTSL, OTSR, FSG, TEASE, LITES, VO, SOT, PKG, MUSIC) or one of the show's permanent graphics (★). Click a chip to name it, change its type, move it earlier or later, or remove it. Blue chips are graphics, red chips are video, purple chips are music (played from the TriCaster's Sound player), and green ★ chips are permanent graphics. Later phases connect each element to its cue in the script and its file, and that's what the TriCaster cueing runs on.
  - **Commercial breaks** appear on their own between blocks, using the show's break length.
  - **Live editing:** everyone in the episode sees changes within about a second, plus colored initials for who else is there and a highlight on the cell they're editing.
  - **Authorship:** every row records who created it and who last edited it.
  - Drag the ⋮⋮ handle to reorder rows. The ⋯ menu floats, moves, inserts and deletes rows.
- **Est. fills in from the script:** each section's length is its script's read time (shown in grey) unless you type a length, which overrides it. Clear the box to go back to the script's time.
- **Timing:** total, target, over or under, block lengths, and back-times. Back-times are clock times when the episode has a start time.
- **Archive:** the episode becomes read-only, including for anyone who has it open, but stays searchable. Only an admin can un-archive.
- **Export** to CSV and PDF, and **Search** across all episodes, archived ones included.

- **Publish rundown:** a new episode is a draft that only its creator and admins can see. Click **Publish rundown** when it's ready, and everyone who can sign in sees it.
- **Script pages:** click a slug to open its script page. Hover over a slug and click ✎ to rename it. The page has:
  - a shared text box that several people can type in at once
  - a word counter
  - an estimate of the read time at 143–154 words a minute
  - who reads it and which camera to look at
  - who has edited the script
  - links to the previous and next sections

**Not yet:**
- Cue chips in scripts, and talent tags shown in the script, come in Phase 2.
- The prompter, plus actual section timing recorded from it, comes in Phase 3.
- Graphics don't yet link to script cues (Phase 2) or files with Ready/Missing (Phase 4).
- The admin usage panel (today's Cloudflare usage against the free limits) moves to the next phase.

## Try it on your Mac first (no accounts needed)

In Terminal, run these one at a time:

```bash
cd "/Users/rg_sureshkumar/AI Apps/TSTV Automated Technical Director"
```

```bash
npm install
```

```bash
npm run db:migrate:local -w apps/web
```

```bash
npm run dev
```

1. Open <http://localhost:5173>.
2. On your Mac, the sign-in page offers **pretend people** (RG (TD), Alex Producer, Sam Writer), so you can try everything without Google. This only works on your own Mac, never on the real website.
3. To see live editing, sign in as RG in Safari and as Sam in Chrome, and open the same episode in both.
4. Press **Ctrl+C** in Terminal to stop.

On a fresh copy of the project, copy `apps/web/.dev.vars.example` to `apps/web/.dev.vars` first. It's already there on your Mac.

## Put it online (one time, about 30 minutes)

**Done Oct 28, 2026:** the website is live at <https://tstv-show.tstv-rundown.workers.dev> on RG's Cloudflare account, with Google sign-in published. These steps are kept here in case it ever needs to be set up again, for example on a TSTV-owned account.

### A. Create your free Cloudflare account

1. Go to <https://dash.cloudflare.com/sign-up> and sign up with your email. Verify the email.
2. **Don't add a payment method.** If Cloudflare ever asks for a card, stop and tell me.

### B. Connect this Mac to the account

```bash
cd "/Users/rg_sureshkumar/AI Apps/TSTV Automated Technical Director/apps/web"
```

```bash
npx wrangler login
```

Your browser opens a Cloudflare page. Check that it's your account and click **Allow**. That lets this Mac publish the website to your account.

### C. Create the database and publish (I can run these with you)

1. `npx wrangler d1 create tstv-show` creates the free database and prints a `database_id`. That ID goes into `apps/web/wrangler.jsonc`.
2. `npm run db:migrate:remote -w apps/web` sets up the database's tables.
3. `npm run deploy -w apps/web` publishes the website.
   - The first time, Cloudflare asks you to choose a free `workers.dev` name, for example `tstv`.
   - The website's address will then look like `https://tstv-show.tstv.workers.dev`.

### D. Set up "Sign in with Google" (free, no card)

Google's screens change from time to time, so the wording might differ a little.

1. Go to <https://console.cloud.google.com> and sign in with the Google account that should own this. Yours is fine for now.
2. **Create a project** named `TSTV Rundowns`.
3. Open **Google Auth Platform**, which some screens call the "OAuth consent screen". Then:
   1. Fill in **Branding**: app name `TSTV Rundowns`, your email as the support email, and your email as the developer contact.
   2. Also on **Branding**, fill in **Application home page** (the website's address) and **Application privacy policy link** (the address followed by `/privacy`), then **Save**. Without these, Google leaves **Publish app** gray.
   3. Under **Audience**, choose **External** and **Publish app** (In production).
   4. The site only asks for name, email and profile picture, so Google doesn't need to review it.
4. Open **Clients**, then **Create client**, then **Web application**. Name it `TSTV website`.
5. Under **Authorized redirect URIs**, add your website's address followed by `/api/auth/google/callback`, for example `https://tstv-show.tstv.workers.dev/api/auth/google/callback`.
6. Click **Create**. Keep the **Client ID** and **Client secret** handy for the next step.

### E. Give the website its sign-in settings

You type these yourself; they're stored by Cloudflare, never in the project or on GitHub. Run each command in `apps/web`, paste the value when asked, and press Enter:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
```

```bash
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

```bash
npx wrangler secret put ADMIN_EMAILS
```

For `ADMIN_EMAILS`, type the Gmail address you'll sign in with. That account is always allowed in and is the admin.

### F. Sign in

Open your website and click **Sign in with Google**. You're the admin. Use **People** to invite everyone else by the email of their Google account (personal Gmail works).

## The Phase 1 test: build a real episode's rundown

1. **Sign in** with Google on the real website.
2. **People:** invite one other person, such as a producer or writer, and have them sign in.
3. **Shows:** add a real show, then open **Show settings** and set:
   - target length
   - cameras (for example Camera 1, Camera 2, Camera 3 (wide))
   - default camera
   - talent, with colors
   - segment types
   - permanent graphics
   - commercial break length
4. **Create an episode** with its real air date and start time, and enter its anchors and correspondents.
5. **Rebuild a past episode's rundown from Rundown Creator:** blocks, sections, slugs, types, writers, talent, cameras, headlines and estimates. Give each section its **graphics** in order, including permanent graphics and music. *(Done Oct 29, 2026: "October 26 PrimeTime Show", 55 sections in 5 blocks.)*
6. **Check timing** against Rundown Creator: total, over or under, and back-times.
7. **Drag a row** to a new place, then **float** a section. Check that the numbers and totals update.
8. **Publish the rundown,** then check that the other person can now see it. Before you publish, they shouldn't be able to.
9. **Write a script:** click a slug and type a reader. Check the word count and the read time. Have the other person open the same script and type at the same time.
10. **Edit the rundown at the same time as the other person.** You should see:
   - their edits within about a second
   - their initials at the top of the page
   - a colored outline on the cell they're editing
   - their name under **Last edit**
11. **Export CSV and PDF,** then open both files.
12. **Archive** the episode. It becomes read-only. Find it on the **Search** page.
13. **Tell me** what's missing or awkward compared with Rundown Creator, and whether Phase 1 is approved.

## Behind the scenes

- **Automated tests:** `npm test` runs the logic tests. `npm run test:e2e` runs the browser tests, where two pretend people build one rundown at the same time. GitHub runs both on Mac and Windows for every change.
- **Where data lives:**
  - each episode's rundown: in its own episode room on Cloudflare
  - users, shows, the episode list and search text: in the D1 database
  - media: never online
