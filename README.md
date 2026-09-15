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

## Project structure

```
index.html   — page structure
style.css    — styling (light/dark aware)
app.js       — all app logic (add/edit/move/delete books, search, persistence)
CLAUDE.md    — operating rules for the multi-agent dev workflow (see below)
.claude/agents/ — subagent definitions used to build and maintain this project
DECISIONS.md — running log of decisions made across work cycles
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
