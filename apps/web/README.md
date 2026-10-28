# Website

The TSTV rundown website: sign-in, shows, episodes, the live rundown grid, timing, archive and export. Scripts (Phase 2) and the prompter page (Phase 3) will live here too. It runs on Cloudflare's free tier. See [docs/PHASE-1.md](../../docs/PHASE-1.md) to try it locally or put it online.

| Folder | What's in it |
| --- | --- |
| `src/` | The pages people see (React) |
| `src/rundown/` | The live rundown grid, its connection to the episode room, and CSV/PDF export |
| `worker/` | The server: sign-in (`auth.ts`), the API (`index.ts`) and the episode rooms (`room.ts`) |
| `migrations/` | The database tables |
| `test/`, `e2e/` | Logic tests, and browser tests where two people edit one rundown |

Useful commands, run from the repo folder:

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the website on this computer at http://localhost:5173, with pretend sign-in |
| `npm run test:e2e` | Runs the browser tests |
| `npm run deploy -w apps/web` | Publishes the website to Cloudflare |
