# Research: Edit-everywhere + Undo/Redo-everywhere

## Question

The user asked for (1) edit buttons "for everything" and (2) an undo/redo button "for
everything" — across all nine collections (Books, Recipes, Medications, Diagnoses,
To-Do, Shopping List, Notes, Resume & Portfolio, Coursework). This brief validates the
technical approach before the Analyst specs the exact data model / UI changes. It does
not decide the schema or write application code.

Grounding read before this research: `app.js` in full (every `addX`/`updateX`/`deleteX`
across all nine collections, `renderNotes()`'s edit-form pattern, `runSync()`,
`stampSync()`, `migrateSyncFields()`), `sync_server.py` in full (`merge_collection`,
`_content_matches`, optimistic-concurrency version handling), and `DECISIONS.md` in
full, especially the 2026-09-15 "Device sync architecture" entry and the 2026-09-15
"Filter/sort across all nine collections" entry (the single-open-edit-form exclusivity
bug).

---

## 1. Undo/redo implementation pattern

**Confirmed — no free browser API applies here.** `document.execCommand('undo')` is
deprecated and, per MDN, only ever affected "the currently active editable element"
(`contenteditable` regions or a document in `designMode`) — it has no concept of
arbitrary application/JS state and cannot be pointed at this app's `books`/`notes`/etc.
in-memory arrays. MDN's own guidance: "the `execCommand()` method is deprecated... not
implemented consistently or fully by user agents, and it is not expected that this will
change." There is no other browser-native "give me undo for free" API for general
application state — this must be built. ([MDN: Document.execCommand()](https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand))

**Confirmed — standard approach.** For an app like this (flat plain-object records, no
nested class instances, no functions/DOM refs stored in data), the standard,
well-understood technique is a **memento-style undo stack**: each user action pushes an
entry recording enough state to reverse and reapply the change, rather than a full
command-object hierarchy (Command pattern with a distinct `execute()`/`undo()` class per
mutation type). Recommendation: one generic entry shape —
`{ collection, id, before, after, timestamp }` — reused for every mutation type
(add/update-field/status-move/toggle/delete) across all nine collections, rather than
~30–40 bespoke command classes (9 collections × up to ~5 mutation shapes each). This
mirrors the project's own established convention of generalizing a repeated shape into
one shared helper instead of one-off code per collection (the `compareByField`/
`renderChipFilter` precedent from the most recent filter/sort cycle, per DECISIONS.md).
`undo` restores `before` onto the record; `redo` re-applies `after`. Add is modeled as
`before: null`; delete is modeled as `after: { ...record, deleted: true }`.

---

## 2. Snapshot vs. reference — real correctness risk confirmed

**Confirmed by direct code read: every `updateX`/`toggleX`/`deleteX` function in
`app.js` mutates the found record object in place**, never replaces it with a new
object or removes/re-inserts it. Examples verified directly:
- `updateBookStatus`/`updateBookRating` (lines ~222–238): `const book = books.find(...); book.status = newStatus; ...`
- `updateMedicationDate` (line ~553): mutates `med.startDate`/`med.endDate` directly.
- `updateNote` (line ~1179): mutates `note.title`/`note.body`/`note.dateModified` directly.
- `toggleTodoCompleted`, `toggleShoppingChecked`, `updateDiagnosisStatus`,
  `updateCourseStatus`, `updateCourseGrade` — same pattern.
- Every `deleteX` sets `record.deleted = true` in place (tombstone), never splices the
  array.
- `stampSync(record)` also mutates in place (`record.updatedAt`, `record.deviceId`).

**This confirms the classic undo-stack bug is a real risk here, not a theoretical one.**
If an undo entry stored `{ before: book }` (a live reference into the `books` array)
rather than a copy, then any subsequent call to `updateBookStatus`/`stampSync`/etc. on
that same object would silently corrupt the "before" snapshot too, because it's the same
object in memory. **Undo entries must store deep copies, not references,** captured at
the moment of the action (both `before`, captured pre-mutation, and `after`, captured
post-mutation).

**Confirmed: `structuredClone()` is sufficient and safe for this.** It is a global
function (no import, callable as `structuredClone(value)` directly on `window`),
requires no network access (a local, synchronous, in-memory operation), and has been
Baseline/widely available across all major browsers since March 2022. It performs a true
deep copy, including circular references, and only throws (`DataCloneError`) on
non-cloneable types such as functions or DOM nodes. Every record in this app's nine
collections is a plain JSON-serializable object (`{ id, title, status, dateAdded,
updatedAt, deviceId, deleted, version, ... }` — strings, numbers, booleans, null) with no
functions, DOM references, or circular structure, so `structuredClone()` is a strictly
better fit than `JSON.parse(JSON.stringify(x))` (no real downside here, and it correctly
handles types like `Date` if any were ever introduced later) and is the recommended
mechanism for snapshotting undo entries.
([MDN: `Window.structuredClone()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone))

---

## 3. Memory/storage footprint

**Confirmed (from code): record shape is small and flat** — a typical Books record
(`id`, `title`, `author`, `status`, `rating`, `dateAdded`, `updatedAt`, `deviceId`,
`deleted`, `version`) serializes to roughly 250–350 bytes of JSON per record depending on
title/author length. **This is my own estimate from the observed field shapes, not a
sourced figure** — flagged as such rather than asserted as fact.

At that per-record size, with 218 real Books records:
- A **whole-collection-array snapshot per undo action** would cost roughly 218 × ~300
  bytes ≈ **~65 KB per action** for Books alone. At a stack depth of 50 actions, that's
  on the order of **~3 MB** just from Books-related undo entries (other collections are
  much smaller — Recipes has 22 records, Coursework 48, etc. — so Books dominates the
  worst case).
- A **single-changed-record snapshot per action** (`{ collection, id, before, after }`,
  each `before`/`after` being one record, not the whole array) costs roughly 300–700
  bytes per undo entry regardless of collection size. At 50 actions, that's on the order
  of **15–35 KB total** — three orders of magnitude smaller.

**Recommendation: single-record (or single-changed-field) snapshot granularity, not
whole-collection-array snapshots.** Reasoning: (a) the ~3 MB whole-array figure, while
survivable in raw JS-heap terms for a single session, becomes a real concern the moment
persistence is considered (see §5 — localStorage's per-origin quota is commonly cited at
around 5 MB, so a persisted 50-deep whole-array undo log for Books alone could burn a
meaningful fraction of the entire storage budget for no functional benefit); (b) there is
no correctness reason to prefer whole-array snapshots — every mutation in this codebase
already targets exactly one record by `id`, so a single-record diff captures 100% of what
undo/redo needs to reverse or reapply; whole-array snapshots would just be carrying
~217 unchanged records per entry for nothing.

---

## 4. Interaction with sync's tombstones and version-based conflict resolution

**Confirmed: undo/redo can and should reuse the exact same mutation functions/code path
as any other local edit — no special-casing needed.** Two supporting facts from direct
code read:

1. **The client never bumps `version` itself.** `version` is set once at creation
   (`version: 0`) and is otherwise only ever overwritten wholesale by whatever the server
   assigns in its sync response (`c.set(incoming)` in `runSync()` fully replaces the
   local array with the server's returned records, versions included) or by the
   client-side import merge (`mergeCollectionFromImport`). Every local mutation function
   (`updateBookStatus`, `updateNote`, etc.) only calls `stampSync()` (which sets
   `updatedAt`/`deviceId`), never touches `version`. So an undo action that flips a field
   back and calls `stampSync()` is byte-for-byte indistinguishable, from the sync
   algorithm's point of view, from any other local edit — there is nothing
   undo-specific to reconcile with the server's optimistic-concurrency check.
2. **"Undo a delete" needs one new (but trivial) function per collection** — nothing in
   the current codebase un-tombstones a record; every `deleteX()` only sets
   `deleted = true`. A `restoreX(id)` counterpart (or one generic
   `restoreRecord(collectionArray, id)` helper) that sets `deleted = false` and calls
   `stampSync()` is structurally identical to every existing update function — this is
   new code the Builder will need to add, but it is mechanically trivial, not a design
   risk.

**Real risk flagged (not a blocker, but the Analyst/Builder should know about it):**
because `deleteX()`/tombstoning does not bump `version` locally, an "undo delete" that
flips `deleted` back to `false` and syncs afterward is handled by the **same conflict
mechanism already documented in DECISIONS.md's 2026-09-15 sync-architecture entry**: if
another device already independently deleted (or edited) that same record and pushed a
newer `version` to the server before this device's undo syncs, the server's
`merge_collection()`/`_content_matches()` logic will see `client_version < server_version`
and the content will no longer match (tombstoned vs. un-tombstoned) — this is **not** a
no-op replay, so it becomes a **genuine conflict**: the server keeps its own
(tombstoned) record untouched and stores the client's un-deleted content as a **brand
new duplicate record** under a fresh id (exactly the existing "keep both, never silently
overwrite" behavior already built and already surfaced to the user via the sync status
line's conflict message). **Net effect: undo-of-delete can never silently resurrect a
record that was legitimately deleted elsewhere and stomp on that decision — worst case
is a confusing duplicate, which is the same class of confusing-but-safe outcome this
project already ships and has already user-facing messaging for.** This is worth an
explicit one-line note in the eventual UI copy ("undo" of an old delete may produce a
duplicate after syncing, rather than a true shared restore) but is not a new failure
mode requiring special-case code.

The same reasoning applies symmetrically to "undo an edit" applied after time has
passed and another device has since changed the same record — it's just another local
mutation, caught (if at all) by the exact same version-mismatch/conflict path, producing
at worst a duplicate, never silent data loss.

**Recommendation:** implement undo/redo by literally calling the *existing*
`updateX`/`deleteX`/new `restoreX` functions (or the smallest possible generalized
wrappers around them), rather than writing a parallel "apply this diff directly to
localStorage" path that bypasses `stampSync()`/render/save. This guarantees undo actions
sync exactly like normal edits with zero additional logic.

---

## 5. Session-only vs. persisted undo history

**Recommendation: in-memory-only (a module-level array), reset on reload — do not
persist the undo/redo stack.** This matches the project's own explicit, already-recorded
precedent: filter/sort selections are deliberately non-persisted module-level variables,
described in DECISIONS.md as "a deliberate convention... and should stay that way unless
the Architect explicitly decides to persist UI state more broadly." Reasoning specific
to this app, beyond just precedent-matching:

- **Sync invalidates a persisted stack's assumptions.** `runSync()` fully replaces every
  collection's in-memory array with the server's current dataset on every successful
  sync (`c.set(incoming)`), and this can happen automatically in the background (a
  60-second interval timer, on tab visibility change, on `online` events — see
  `initSyncUI()`). A persisted undo/redo entry captured before such a sync could
  reference a record `id` that another device has since deleted, or hold `before`/`after`
  field values that are now stale relative to newly-arrived data from elsewhere. A
  "redo" fired after reopening the tab could reapply a now-outdated mutation the user
  no longer has full context for. An in-memory stack sidesteps this cleanly: it's
  guaranteed empty at the start of every fresh page load/session, i.e. always
  consistent with whatever data that session started from.
- **No existing precedent for a mutation-history log in this app's data model.** Every
  standing decision in DECISIONS.md has deliberately kept records history-free (e.g. the
  2026-09-14 entry's accepted gap that resuming a stopped medication "discards the prior
  stop date rather than keeping episode history" as a known, accepted limitation).
  Introducing a persisted, ever-growing mutation log would be a new category of stored
  state this app has consistently avoided elsewhere.
- **Low cost of the tradeoff.** Losing undo/redo availability across an accidental
  reload is the same, widely-normal behavior as most desktop/web editors, whose undo
  history is also typically session-scoped (cleared on close/reload), not a
  compromise unique to this app.

---

## 6. Global single stack vs. per-collection stacks

**Recommendation: one global stack, not nine per-collection stacks.** This is both the
standard UX pattern (Ctrl+Z conventionally undoes "the last thing you did" in an
application, regardless of which pane/section/tab it happened in — not "the last thing
you did in the currently active view") and technically simple here: a single array of
`{ collection, id, before, after, timestamp }` entries is sufficient regardless of how
many different collections are represented in it, because each entry is
self-describing — undoing it just needs to look up which collection's array/render
function to call (already available via the existing `SYNC_COLLECTIONS` lookup table
that maps collection name → `get`/`set`/`render`), the same lookup pattern the sync/
import code already uses generically across all nine collections. No structural reason
favors nine separate stacks, and per-collection stacks would actually complicate the "for
everything" requirement the user stated, since the user would then need nine separate
undo buttons/keybindings instead of one.

---

## 7. Generalizing Notes' edit pattern to all nine collections

**Confirmed: the pattern generalizes, with one identified, non-blocking structural
adjustment for the status-column collections.**

Notes' current implementation (`renderNotes()`, lines ~1229–1322) has three reusable
pieces:
1. Per-card view/edit toggle (`.note-view`/`.note-edit-form`, `.edit-btn`/`.cancel-btn`).
2. Single-open-edit-form exclusivity, enforced at the Edit-button level (opening one
   note's form force-closes any other note's open form first) — this was the exact bug
   fixed in the most recent filter/sort cycle (originally a `querySelector` bug that
   only ever tracked one open form even when two could be opened simultaneously).
3. Capture/restore of unsaved in-progress edits across a re-render, keyed by record
   `id`, not by DOM position.

**For the flat-list collections — To-Do, Shopping List, Resume & Portfolio (and Notes
itself)** — this generalizes cleanly with essentially no structural friction: each
already renders exactly one `<ul>`/list container per collection via the same
`template.content.cloneNode(true)` per-record loop Notes uses, so a shared
`captureOpenEdit(listEl, ...)` / `restoreOpenEdit(...)` pair of helpers (parameterized
similarly to how `compareByField`/`renderChipFilter` already take collection-specific
getters/setters) drops in directly.

**For the status-column collections — Books, Diagnoses, Coursework, and Medications'
current/former split** — the pattern still generalizes, but requires one concrete,
identified adjustment: these collections render the *same* record type into **multiple
separate list containers** (one per status/group, e.g. `[data-list="owned_read"]`,
`[data-list="currently_reading"]`, etc., rebuilt independently inside a `forEach` over
statuses within a single `renderX()` call). Notes' current capture/restore logic scopes
its "find the open edit form" search to a single list element
(`list.querySelector('.note-edit-form:not([hidden])')`). A generalized version for these
collections needs that search widened to span **all of that collection's status-column
list containers**, not just one — otherwise an open edit form in, say, the
"owned_unread" column could be lost on re-render while the search only checked
"currently_reading." This is a small, mechanical adjustment (directly analogous to how
`renderChipFilter`'s auto-reset-to-"all" logic already had to be written generically
enough to serve both single-instance and multi-instance callers), not a structural
blocker — **confirmed generalizable, with this one adjustment flagged explicitly for the
Analyst/Builder.**

**Two additional things flagged for the Analyst, not decided here:**
- None of the other eight collections' card `<template>` elements currently contain any
  edit-form markup at all (only Notes' template has `.note-view`/`.note-edit-form`).
  Adding edit buttons "for everything" means adding analogous edit-form markup to eight
  more templates, not just wiring up shared JS — a real (if mechanical) piece of work,
  not just a refactor.
- Open question for the Analyst to decide, not something this research resolves:
  should single-open-edit-form exclusivity be **per-collection** (matching today's
  Notes-only precedent — opening a Books edit form doesn't need to close a
  simultaneously-open Notes edit form) or **app-wide** (only one edit form open anywhere
  in the app at a time, across all nine collections)? Both are technically easy; this is
  a UX call, not a technical constraint, and is explicitly left to the Analyst/Architect.
- Minor implementation inconsistency observed in passing (not a bug, just worth noting):
  `updateNote()` does not call the shared `stampSync()` helper — it manually inlines
  `note.updatedAt = now; note.deviceId = getDeviceId();` alongside setting
  `note.dateModified = now` with the same `now` value. A generalized "edit any record"
  helper should probably call `stampSync()` directly (and let Notes' `dateModified` be
  set as an extra, Notes-specific step alongside it) rather than have every collection
  reinvent what `stampSync()` already does.

---

## Summary of explicit recommendations for the Analyst

1. Memento-style undo stack (generic `{ collection, id, before, after, timestamp }`
   entries), not per-mutation-type command classes.
2. Deep-copy every `before`/`after` via `structuredClone()` — never store live
   references into the collection arrays.
3. Snapshot granularity: single changed record per undo entry, never a whole-collection
   array.
4. Undo/redo should call the existing (or minimally-extended, e.g. a new `restoreX`)
   mutation functions so sync stamping/merge behavior is inherited for free — no
   sync-specific special-casing needed. Flag to the user in copy that undoing a very old
   delete/edit could, in rare cases, produce a duplicate after the next sync (same
   accepted behavior as any other genuine sync conflict today) rather than a true
   cross-device restore.
5. In-memory-only undo/redo stack, reset on reload — do not persist it.
6. One global undo/redo stack for the whole app, not nine per-collection stacks.
7. Notes' edit pattern generalizes to all nine collections; status-column collections
   (Books/Diagnoses/Coursework/Medications) need their open-form search widened across
   all of their status/group list containers, not just one. Eight of nine collections'
   card templates need new edit-form markup added (doesn't exist today). Per-collection
   vs. app-wide edit-form exclusivity is an open UX question left to the Analyst.

## Confidence flags

- The byte-size/KB estimates in §3 are my own arithmetic from observed field shapes in
  `app.js`, not a sourced or measured figure — labeled as an estimate throughout, not
  fact.
- The localStorage quota figure referenced in §3's reasoning (commonly cited around
  5 MB per origin) varies by browser and is not itself pinned to a single canonical
  number across all browsers; it's used here only as a rough order-of-magnitude sanity
  check for why whole-array snapshots would be wasteful if ever persisted, not as a hard
  limit this app is close to hitting either way.
- Everything in §2 and §4 (in-place mutation behavior, version/stampSync behavior,
  conflict/duplicate mechanics) is Confirmed by direct reading of the actual
  `app.js`/`sync_server.py` source as it exists today, not inferred from documentation.
