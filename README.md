# TSTV Show Automation

Texas Student Television's own rundown, script and prompter website, plus a laptop app that runs the TriCaster TC1 from prompter cues.

- **What we're building and why:** [docs/PROJECT_BRIEF.md](docs/PROJECT_BRIEF.md) (the source of truth)
- **How it's built:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Folder layout

| Folder | What lives there | Build phase |
| --- | --- | --- |
| `docs/` | The project brief, architecture and (later) the producer guide and checklists | All |
| `tools/probe/` | The TriCaster probe: one read-only command the TD runs at the station | 0 |
| `tools/simulator/` | The fake TriCaster used for development and practice | 0 |
| `apps/web/` | The website: rundowns, scripts, prompter page, sign-in | 1–3 |
| `apps/show-app/` | The Mac and Windows desktop app that runs the TC1 | 4–6 |
| `packages/shared/` | Code the website and the show app both use (cue rules, file-name parsing, data types) | 1+ |

## Safety rules

- Simulator mode is the default. The show app sends commands to the real TC1 only in a clearly marked live mode that the TD turns on.
- Nothing is installed on the TC1.
- Media files never upload to the cloud.
