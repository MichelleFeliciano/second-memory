# Second Memory

A personal, local-first "second brain" app — a place to keep lists of things you want
to track. The first collection is **Books**, sorted into:

- **Want to Buy**
- **Owned — Unread**
- **Owned — Read** (with a star rating)

## Running it

No install, no build step, no server required.

- Double-click [index.html](index.html) to open it directly in a browser, or
- Serve the folder with any static file server if you'd rather access it via `http://`.

All data is stored in your browser's `localStorage` — nothing leaves your machine, and
nothing requires an internet connection. The same code works whether you open it
offline or host it online.

## Syncing between devices (phone + computer)

The app works fully offline with no setup. If you also want your phone and computer to
share the same data, run the included local sync server on one machine (typically your
computer) and point each device's app at it:

```
python sync_server.py
```

This starts an HTTPS server on port `8443`, using only Python's standard library plus
your machine's existing `openssl` binary (Git for Windows already includes one). On
first run it will:

- Generate a self-signed TLS certificate (`cert.pem`/`key.pem`) covering your machine's
  current LAN IP.
- Generate and print a random passphrase, and save it to `.sync_secret`.

**Copy the printed passphrase** — you'll need it on every device you want to sync. In
the app's sidebar, open the sync setup form and enter the server's URL (e.g.
`https://192.168.1.42:8443`, shown in the server's startup output) and the passphrase.

The first time each device's browser connects, it will show a "your connection isn't
private" warning — this is expected, not an error, because the certificate is
self-signed rather than issued by a public certificate authority. Click through to
proceed (usually "Advanced" → "Proceed anyway"); you only need to do this once per
device, and the app works normally afterward, including syncing over HTTPS.

`cert.pem`, `key.pem`, `.sync_secret`, and `sync_data.json` are machine-specific
generated files and are git-ignored — never commit them.

## Project structure

```
index.html     — page structure
style.css      — styling (light/dark aware)
app.js         — all app logic (add/edit/move/delete, search, persistence, sync)
sync_server.py — optional local HTTPS server for syncing data between devices
CLAUDE.md      — operating rules for the multi-agent dev workflow (see below)
.claude/agents/ — subagent definitions used to build and maintain this project
DECISIONS.md   — running log of decisions made across work cycles
```

## The multi-agent dev workflow

This project is built and maintained by a small fixed team of roles, defined so that
future work stays consistent even across separate sessions:

- **Architect** — the orchestrator (the main assistant session). Breaks down requests,
  decides which of the roles below are needed, runs independent work in parallel, and
  holds final approval before anything is considered done.
- **Researcher** ([.claude/agents/researcher.md](.claude/agents/researcher.md)) — validates
  technical claims against authoritative sources, not SEO content.
- **Analyst** ([.claude/agents/analyst.md](.claude/agents/analyst.md)) — checks the data
  model and specs for accuracy and logical gaps before code is written.
- **Builder** ([.claude/agents/builder.md](.claude/agents/builder.md)) — implements the
  approved spec in code.
- **Tester** ([.claude/agents/tester.md](.claude/agents/tester.md)) — tries to break what
  the Builder shipped and reports bugs (doesn't fix them).
- **Archivist** ([.claude/agents/archivist.md](.claude/agents/archivist.md)) — the closed-loop
  role: logs each approved cycle's decisions and outcomes to `DECISIONS.md` so the next
  cycle doesn't start from scratch or re-break something already fixed.

Full delegation rules live in [CLAUDE.md](CLAUDE.md).
