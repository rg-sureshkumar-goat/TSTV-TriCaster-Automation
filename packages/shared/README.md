# Shared code

Code the website, prompter and show app all use, so they always agree:

- `src/rundown.ts`: the rundown (blocks and sections), stored as a shared Yjs document so several people can edit at once. It also numbers rows (A, A1, A2, B, B1…), computes timing and back-times, and records who created and last edited each row.
- `src/show.ts`: a show's settings (target length, reading speed, cameras, talent, segment types) and their defaults.
