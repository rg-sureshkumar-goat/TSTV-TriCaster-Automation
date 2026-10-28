# TriCaster probe

One read-only command the TD runs on a laptop cabled to the TC1. It finds the TC1, records which remote-control interfaces it offers and what state it reports, and saves everything to a results file for Claude Code. **It only reads. It never sends a command or changes a setting.**

## What it does, in order

1. **Finds the cable.** It lists the laptop's network adapters and picks the wired one. If the cable was just plugged in, it waits up to a minute for an automatic address.
2. **Finds the TC1.** It checks the laptop's own list of devices it has seen, asks the cable "who's there?" (the same multicast questions Macs and NDI devices use), and looks for IPv6 neighbors. If nothing answers, it waits up to 90 seconds for the TC1 to announce itself on the cable. Windows does that about a minute after a cable is plugged in.

   An earlier version tried every automatic address instead. On campus that disrupted the laptop's Wi-Fi, so it was removed.
3. **Reads what the TC1 offers.** It checks which ports answer, then reads `/v1/version` and about 20 named data sets from the TriCaster's web API. If the LivePanel password is on, the probe asks for it once. It doesn't save the password.
4. **Listens.** It connects to the state stream (port 5951) and the change notifications, then walks you through a few panel steps. You do each one yourself on the TC1SP or the TC1 screen, and the probe records which states change.
5. **Checks file sharing.** If port 445 is open, it lists the TC1's shared folders.
6. **Saves** a `.json` results file and a short `-summary.txt` in `tools/probe/results/`, and prints the summary.

## How it stays read-only

- [`lib/guard.mjs`](lib/guard.mjs) is the only gate to the network. It allows GET requests to a fixed list of read addresses and never the command address (`/v1/shortcut`). On port 5951 it allows only the "send me updates" message and empty keep-alive lines.
- [`test/read-only.test.mjs`](test/read-only.test.mjs) fails if command text ever appears in the probe's code, or if any file that writes to the network skips the guard.
- [`test/probe-vs-simulator.test.mjs`](test/probe-vs-simulator.test.mjs) runs the whole probe against the simulator and checks that the simulator received zero commands.

## Running it

It needs only Node.js 22 or newer. You don't need to run `npm install` for the probe.

```bash
npm run probe
```

Step-by-step instructions for the station are in [docs/PHASE-0-TESTING.md](../../docs/PHASE-0-TESTING.md).

| Option | What it does |
| --- | --- |
| `--host <address>` | Skips the search and uses this address, for example `--host 169.254.10.20`. |
| `--no-guided` | Skips the panel steps and just listens for `--listen` seconds (default 60). |
| `--wait <seconds>` | How long to wait for the TC1 to appear on the cable (default 90). |
| `--out <folder>` | Saves results somewhere other than `tools/probe/results/`. |
| `--yes` | Asks no questions. |

To try it against the simulator, run `npm run simulator` in one terminal, then this in a second terminal:

```bash
npm run probe -- --host 127.0.0.1:8080
```

## Results files

The results contain the TC1's network details, so `tools/probe/results/` is never committed to git. Send the `.json` file to Claude Code directly.
