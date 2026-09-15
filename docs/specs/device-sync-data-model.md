# Spec: Device Sync Data Model (Local-First Multi-Device Sync — Data Layer Only)

Status: **Validated by Analyst, with flagged decisions the Architect must confirm before
Builder starts** (see Section 8). Everything else in this document is safe to build
against as-is.

Reference sources read for this spec: `CLAUDE.md`, `DECISIONS.md`, `app.js` (all nine
collections' schemas and the shared `makeId()`/`loadCollection()`/`saveCollection()`
helpers), `docs/specs/multi-tab-tracker.md`, `docs/specs/personal-collections-expansion.md`.

**Scope note:** `docs/research/device-sync-architecture.md` (the Researcher's brief on
wire protocol / conflict-resolution / security approach) **does not exist yet** — it was
not found in `docs/research/` at the time this spec was written. Per the dispatch
instructions, this spec proceeds with its own reasonable defaults for anything
protocol-level (how bytes move between phone and computer, authentication, transport)
and flags every such default explicitly in Section 8 for reconciliation once the
Researcher's brief lands. This spec's actual job — and the only part that's binding on
the Builder without further confirmation — is the **local data model**: what fields
every record needs, how existing status-conditional rules interact with those fields,
how local storage is laid out, what "device" means, and how existing data migrates.
Nothing here should be read as a final word on the sync protocol itself.

---

## 1. Per-record sync metadata

### 1.1 Decision: identical fields added to every record in all nine collections

Three fields, added with the **exact same name, type, and semantics** to every record in
Books, Recipes, Medications, Diagnoses, To-Do, Shopping List, Notes, Resume & Portfolio,
and Degree & Coursework. No per-collection variation — there is no collection here whose
sync needs are structurally different from the others (all nine are flat, independent
record arrays with no relational fields, per the standing "no relational fields"
constraint from `DECISIONS.md`).

| Field | Type | Required | Default | Semantics |
|---|---|---|---|---|
| `updatedAt` | string (ISO 8601 datetime, same format as existing `dateAdded`) | **yes** | set to the record's `dateAdded` value at creation | Stamped to `new Date().toISOString()` on **every** mutation to the record — creation, any field edit, any status/derived-field change, and tombstoning (Section 1.3). This is the field sync/conflict-resolution logic reads to determine "which copy of this record is newer." It is distinct from `dateAdded` (fixed at creation, never touched again) and, for Notes, distinct in *purpose* from `dateModified` even though the two are stamped together (see 1.4). |
| `deviceId` | string (same UUID-or-fallback shape as `id`, produced by the existing `makeId()` helper) | **yes** | the current device's ID (Section 4) | Identifies which device performed the **most recent** mutation — overwritten on every save, not fixed at creation. Used as a conflict tiebreaker (Section 2.6) and for audit/debugging ("which device produced this data"), never shown in the UI. |
| `deleted` | boolean | **yes** | `false` | Tombstone flag. `true` means the record is logically deleted. Never removed from the array locally — see 1.3 for why. |

No `deletedAt` field: when `deleted` transitions to `true`, `updatedAt` is stamped in the
same mutation to the same timestamp a `deletedAt` field would hold — a separate field
would be 100% redundant with `updatedAt` for any tombstoned record, so it's deliberately
omitted rather than added for symmetry's sake.

### 1.2 Exact stamp points — every existing mutating function needs the same two-line change

Every function in `app.js` that currently mutates a collection array and calls
`saveCollection()` must additionally set `record.updatedAt` and `record.deviceId` on the
record(s) it touches, in the same call, before saving. Recommended shared helper
(matching the existing `makeId()`/`loadCollection()`/`saveCollection()` shared-helper
style):

```js
function stampSync(record) {
  record.updatedAt = new Date().toISOString();
  record.deviceId = getDeviceId();
}
```

Exact call sites that need this (traced from the current `app.js`):

| Collection | Functions needing a `stampSync()` call |
|---|---|
| Books | `addBook`, `updateBookStatus`, `updateBookRating`, `deleteBook` |
| Recipes | `addRecipe`, `deleteRecipe` |
| Medications | `addMedication`, `updateMedicationDate`, `deleteMedication` |
| Diagnoses | `addDiagnosis`, `updateDiagnosisStatus`, `deleteDiagnosis` |
| To-Do | `addTodo`, `toggleTodoCompleted`, `deleteTodo` |
| Shopping List | `addShoppingItem`, `toggleShoppingChecked`, `deleteShoppingItem` |
| Notes | `addNote`, `updateNote`, `deleteNote` |
| Resume & Portfolio | `addLink`, `deleteLink` |
| Degree & Coursework | `addCourse`, `updateCourseStatus`, `updateCourseGrade`, `deleteCourse` |

On creation (every `addX` function), the new object literal gets all three fields
directly: `updatedAt: now, deviceId: getDeviceId(), deleted: false` (where `now` is the
same `new Date().toISOString()` value already being assigned to `dateAdded`, captured
once and reused — do not call `new Date()` twice for one mutation).

### 1.3 Tombstones — why hard-delete breaks sync, and the exact replacement behavior

**The problem this solves:** today, every `deleteX(id)` function does
`items = items.filter((i) => i.id !== id)` — the record is simply gone from the array.
If device A deletes a record while offline and later syncs, there is nothing in A's
dataset that says "this record used to exist and was removed" — from a sync protocol's
point of view, a deleted record and a record that never existed on A look identical.
If device B still has that record (because B synced before the delete, or created it and
A never had a chance to see the delete before B's next sync), a reconciliation pass has
no signal to remove it from B — worse, if B's copy has since been edited (bumping its
`updatedAt`), a naive "newer wins" merge would treat B's still-present, updated record as
the correct one and push it back to A, silently undoing A's delete. **A tombstone fixes
this by making "deleted" a normal, transmittable fact about the record instead of the
record's absence** — it participates in the same last-write-wins comparison as any other
field (Section 2.6), so it can never be silently missed.

**Exact replacement behavior for every `deleteX(id)` function:** instead of filtering the
record out of the array, find it, set `deleted = true`, and stamp `updatedAt`/`deviceId`
— the array itself is not reassigned:

```js
function deleteBook(id) {
  const book = books.find((b) => b.id === id);
  if (!book) return;
  book.deleted = true;
  stampSync(book);
  saveCollection(BOOKS_KEY, books);
  renderBooks();
}
```

This is a **code-shape change**, not just a field addition — every one of the nine
`deleteX` functions currently uses the `items = items.filter(...)` reassignment pattern
and must switch to "find the record, mutate it in place." Flagging explicitly since it's
an easy thing to miss while otherwise just adding fields.

**Tombstone content:** the record's other fields (`title`, `notes`, etc.) are **left
intact**, not scrubbed, when tombstoned — see Section 8.e for why, and the flagged
alternative.

**No purge in this cycle:** tombstoned records accumulate in `localStorage` forever under
this spec — no automatic garbage collection of old tombstones is built. See Section 8.b.

### 1.4 Notes' existing `dateModified` field — kept, not replaced

Notes already has a `dateModified` field (distinct from `dateAdded`, per the prior
spec's Section 4.3, a standing constraint from `DECISIONS.md`). This spec does **not**
remove or repurpose it. `updatedAt` is added *alongside* `dateModified` for Notes, same
as every other collection. The two serve different purposes even though they're often
stamped at the same moment:

- `dateModified` is **user-facing** (rendered as "Updated <date>" in the note card) and
  updates only when the user explicitly saves an edit to `title`/`body` via `updateNote`.
- `updatedAt` is **sync-internal** (never rendered) and updates on *every* mutation,
  including tombstoning via `deleteNote` — a case `dateModified` does **not** cover,
  since deleting a note isn't "editing its content."

In `addNote` and `updateNote`, capture one `now` value and assign it to both
`dateModified` and `updatedAt` in the same call, to avoid a hairline timestamp mismatch
between two separate `new Date()` calls. In `deleteNote`, only `updatedAt` (and
`deviceId`, `deleted`) are touched — `dateModified` is left at whatever it was before the
delete, since the content wasn't edited.

---

## 2. State transitions and dependent fields — tracing every existing rule against the sync model

### 2.1 Books: rating clears on status change away from `owned_read`

`updateBookStatus(id, newStatus)` sets `status` and, if leaving `owned_read`, clears
`rating` to `null` — both changes happen in one function call, one `saveCollection()`
write. Adding `stampSync()` to this function bumps `updatedAt`/`deviceId` **once** for
the whole mutation (status change + rating clear together), not twice. No interaction
with the sync fields changes this rule's existing behavior for a single device used
offline — it's identical to today.

**Cross-device interaction (new):** if a book's status is changed differently on two
devices while both are offline, reconciliation applies whole-record last-write-wins
(Section 2.6) to the **entire record**, not per-field — so the "losing" device's `status`
*and* whatever `rating` value resulted from it are both discarded together in favor of
the "winning" device's full snapshot. There is no scenario where the winning device's
`status` is kept but the losing device's `rating` survives (or vice versa) — the
rating-clear rule and the sync conflict rule compose cleanly because both operate on the
whole record, never on individual fields.

### 2.2 Medications: current/former status derived from `endDate`

`isCurrent = endDate === null` is computed at render time and is not a stored field, so
it has no sync metadata of its own to reconcile — it simply falls out of whichever
`endDate` value wins the record-level last-write-wins comparison. No change needed beyond
stamping `addMedication`/`updateMedicationDate`/`deleteMedication` per Section 1.2. The
existing accepted gap around "resuming" a stopped medication discarding the prior stop
date (`DECISIONS.md`, flagged unresolved in the prior spec's Section 6.g) is orthogonal
to sync and is neither fixed nor worsened by this spec.

### 2.3 Degree & Coursework: grade clears on status change away from `completed`

Identical shape to 2.1 — `updateCourseStatus` clears `grade` to `null` in the same call
that changes `status`. One `stampSync()` call covers both. Cross-device conflicts resolve
as one whole-record decision, same reasoning as 2.1.

### 2.4 Diagnoses: status transitions with no dependent fields

`updateDiagnosisStatus` has no dependent field to clear (per the existing spec, all six
transitions between `active`/`monitoring`/`resolved` are side-effect-free). Adding
`stampSync()` here is a pure addition — nothing about the transition logic changes.

### 2.5 Tombstones and dependent fields — explicit reasoning (not assumed)

**Question:** does a tombstoned record ever need its dependent fields (Books' `rating`,
Coursework's `grade`) touched at delete time — e.g. cleared, the way they're cleared on a
status change?

**Answer: no.** Reasoning, worked through rather than assumed:
1. Every render/search function is updated (Section 6) to filter out `deleted: true`
   records before rendering or matching search, so a stale `rating`/`grade` value sitting
   on a tombstoned record is never visible in the UI — there's no card, no list row, no
   search result where it could mislead anyone.
2. There is no "restore from trash" feature in scope for this spec — a tombstoned record
   never re-enters the visible UI, so there's no future point where a stale dependent
   field would resurface. If a restore/undelete feature is added in a **future** cycle,
   this reasoning should be revisited then (a restored record's dependent fields might
   need re-validation against its restored `status`) — flagged here as a forward note,
   not a current requirement.

So tombstoning is a **pure metadata mutation**: `deleted`, `updatedAt`, `deviceId`
change; every other field, including status-conditional ones, is left exactly as it was.

### 2.6 Conflict resolution model — whole-record last-write-wins (default, protocol-adjacent)

Since no Researcher brief exists yet to specify the wire protocol's conflict-resolution
algorithm, this spec assumes and requires the simplest mechanism consistent with the
task's explicit "no full CRDTs, no operational-transform, no multi-writer conflict UI"
instruction:

- When the same record (same `id`) exists in conflicting form on two devices, the record
  with the **later `updatedAt`** wins outright — the entire record is replaced, not
  merged field-by-field.
- If two `updatedAt` values are exactly equal (a real possibility if both devices'
  clocks happen to align, or in fast automated tests), `deviceId` is compared as a
  deterministic, arbitrary-but-consistent tiebreaker (e.g. lexicographic string
  comparison) — this exists purely to make the outcome deterministic, not to encode any
  real preference for one device over the other.
- This is a **whole-record** decision. There is no field-level merge anywhere in this
  model — see Section 8.c for the explicit alternative this rejects and why.

**Known limitation, flagged for the Researcher:** this comparison depends on each
device's local clock being roughly correct. If the computer's or phone's clock is wrong,
last-write-wins could pick the objectively older edit. Mitigating this (e.g. having the
sync server assign an authoritative receipt timestamp instead of trusting client-supplied
`updatedAt`) is a protocol-level decision this spec does not make — flagged in Section
8.h.

**Tombstone resurrection scenario, worked through explicitly** (this is the scenario the
dispatch explicitly asked to reason about): device A deletes a record (tombstones it,
`updatedAt` = T1). Device B, offline at the time, edits the same record before ever
seeing A's delete (`updatedAt` = T2). When both devices eventually sync:
- If T2 > T1 (B's edit happened after A's delete), B's edit wins — the record comes back
  to life everywhere, including on A, with B's edited content. This is arguably correct:
  B genuinely edited the record after it was gone on A, so treating that as "I want this
  back" is a reasonable interpretation, not a bug.
- If T1 > T2, A's tombstone wins — the record disappears everywhere, including B's edit.
- No special-case code is needed for this scenario beyond treating `deleted` as just
  another field inside the same whole-record LWW comparison already used for everything
  else — the tombstone mechanism from 1.3 is what makes this resolvable at all; without
  it, A's delete would have nothing to transmit and B's edited copy would simply "win"
  every future sync by default, resurrecting the record with no way for A's intent to
  ever be represented.

---

## 3. Local storage layout

### 3.1 Decision: sync metadata lives inline on each record — no separate pending-changes queue

Per `CLAUDE.md`'s scope discipline and the dispatch's explicit lean toward the simpler
option absent a real correctness reason otherwise: **the three new fields live directly
on each record inside the existing flat array under the existing single `localStorage`
key per collection.** The overall storage shape is unchanged — still one array, one key,
per collection — the only structural change is three new fields per record.

**Rejected alternative:** a separate "pending outbound changes" queue (a second data
structure tracking which record IDs have unsynced writes). This pattern earns its
complexity in systems with high write volume or a need for guaranteed, ordered delivery
of each individual mutation. Neither applies here: this is one person's personal data
across two devices, with realistic per-collection record counts in the dozens-to-low-
hundreds, not thousands. An "incremental sync" pass can simply scan the whole array and
filter `updatedAt > lastSyncedAt` — a full scan of a few hundred records is computationally
free, and it avoids a second source of truth that could drift out of sync with the
records themselves (a queue entry could get lost independent of the record it describes;
scanning `updatedAt` values directly has no such failure mode, since there's only one
place the fact "this record changed" is recorded — on the record itself).

This also directly simplifies the offline story: a device that's been offline for days
just accumulates local writes with bumped `updatedAt` values, exactly like any other
write. There's no separate "offline queue" to reconcile against "current record state"
when connectivity returns — there is only one source of truth to read from.

### 3.2 New non-collection `localStorage` keys

Two new keys, following the existing precedent that non-collection state (like
`secondMemory.ui.v1`) is stored as a plain object, not an array:

| Key | Shape | Purpose |
|---|---|---|
| `secondMemory.device.v1` | `{ deviceId: string, createdAt: string }` | This device's stable identity (Section 4). |
| `secondMemory.sync.v1` | `{ lastSyncedAt: string \| null }` | Bookkeeping for the sync process: the watermark used to determine which local records are "unsynced" (`updatedAt > lastSyncedAt`). `null` until the first successful sync ever completes. |

### 3.3 One global watermark, not nine per-collection ones (default)

`lastSyncedAt` is a **single value covering all nine collections**, not nine independent
watermarks. Default assumption: a sync pass exchanges all nine collections together in
one round-trip with the server, so one shared watermark is sufficient and simpler than
tracking nine. **This is coupled to the actual sync protocol design and is flagged in
Section 8.i** — if the Researcher's eventual protocol syncs collections independently or
asynchronously, this would need to become a per-collection map instead
(`{ books: '...', recipes: '...', ... }`), which is a small, additive change to this key's
shape if it becomes necessary later.

---

## 4. What "device" means for this app

**Decision: yes, a stable per-browser device identifier is needed**, generated once and
stored separately from all collection data.

- **Storage:** `secondMemory.device.v1` → `{ deviceId: string, createdAt: string }`
  (Section 3.2).
- **Generation:** on app load, read `secondMemory.device.v1`. If it doesn't exist (first
  load ever on this browser profile), generate a new ID using the **existing shared
  `makeId()` helper** (no new ID-generation logic needed — same UUID-or-timestamp-
  fallback shape already used for every record's `id`), write
  `{ deviceId: <new id>, createdAt: <now> }` to `localStorage` immediately, and cache the
  value in memory for the rest of the session (mirroring the existing
  `let books = loadCollection(...)` module-load-time caching pattern).
- **Stability:** once generated, the `deviceId` is **never regenerated or rotated**
  automatically. It persists for the lifetime of that browser's `localStorage` — the
  phone's copy of the app and the computer's copy of the app will each generate their own
  `deviceId` independently on first load, and those two values are what distinguish "a
  change made on the phone" from "a change made on the computer" for the rest of this
  app's life on those two devices.
- **User-visibility:** `deviceId` is purely internal/system state, exactly like every
  record's `id` field — never rendered in the UI.
- **Edge case — cleared browser storage:** if the user manually clears site data (or uses
  a private/incognito window), a new `deviceId` is generated on next load, which — from
  the sync server's perspective — looks identical to a brand-new third device. This spec
  takes no position on whether the (not-yet-designed) sync protocol needs an explicit
  device de-registration/re-pairing step for this case; flagged to the Researcher as a
  protocol-level question, not a data-model gap.

---

## 5. Migration of existing data

The user already has real records (books, medications, etc.) stored under the existing
`secondMemory.<name>.v1` keys, written before any of this spec's fields existed. This
migration must be **purely additive** — it must never remove, rename, or reshape any
existing field, and must run automatically, once, the first time the app loads after this
ships.

### 5.1 Exact algorithm

For each of the nine collection keys, immediately after `loadCollection(key)` and
**before the first render call and before any sync attempt**:

```js
function migrateSyncFields(items, key, deviceId) {
  let changed = false;
  items.forEach((item) => {
    if (!('updatedAt' in item)) {
      // Notes: prefer dateModified (more accurate "last changed" signal) if present.
      item.updatedAt = item.dateModified || item.dateAdded;
      changed = true;
    }
    if (!('deviceId' in item)) {
      item.deviceId = deviceId;
      changed = true;
    }
    if (!('deleted' in item)) {
      item.deleted = false;
      changed = true;
    }
  });
  if (changed) saveCollection(key, items);
  return items;
}
```

Key details:
- **Presence check, not truthiness check.** Use `'updatedAt' in item` (or
  `item.updatedAt === undefined`), not `if (!item.updatedAt)` — this matters because a
  falsy-but-present value must never be re-derived (not a concern for these three fields
  today, since none of them can legitimately be falsy-but-intentional in a pre-migration
  record, but using the presence check is the correct, robust pattern and costs nothing).
- **Idempotent.** Running this function twice (e.g. across two reloads before a save
  somehow didn't stick) does nothing the second time, since every field it would set is
  already present after the first run.
- **Persisted immediately**, not just held in memory — `saveCollection()` is called
  as part of migration if anything changed, so the backfilled values are durable across
  reloads and don't silently re-derive differently at a later timestamp if the migration
  function were ever invoked again before the first save landed.
- **`updatedAt` backfill source:** `dateModified` for Notes (already tracks last edit
  more accurately than `dateAdded` would), `dateAdded` for all other eight collections
  (the only timestamp available for them). This is an accepted approximation, not a bug:
  for a Book that's changed status three times since it was added, backfilling
  `updatedAt` to its original `dateAdded` understates its true last-change time, but no
  more accurate data exists to backfill from, and the consequence is bounded — worst case,
  a pre-migration record looks "older" than it really is in exactly one first
  reconciliation pass, after which its `updatedAt` is accurate going forward from every
  subsequent real edit.
- **`deviceId` backfill source:** the current device's `deviceId` (Section 4), generated
  or loaded *before* migration runs. This is not a guess dressed up as fact — it happens
  to be **exactly correct** for this app's real history: sync doesn't exist yet, so every
  record currently in `localStorage` genuinely was created and last touched on this one
  device.
- **No data loss possible:** the migration only ever *adds* keys to existing objects; it
  never deletes, renames, or rewrites `title`, `status`, `rating`, or any other existing
  field. If `loadCollection()`'s existing try/catch/`Array.isArray` guard already reduced
  a corrupted key to `[]` before migration runs, that's pre-existing behavior this spec
  doesn't change or worsen.

### 5.2 `secondMemory.ui.v1` is explicitly out of scope for both migration and sync

The active-tab preference is a **per-device display preference**, not shared user data.
It does not get sync fields, is not migrated by this spec, and — per Section 8.g — is not
synced between devices at all under this spec's default.

---

## 6. Builder checklist — concrete code-site changes required in `app.js`

- [ ] Add shared helpers: `getDeviceId()` (reads/creates `secondMemory.device.v1`,
      caches in memory), `stampSync(record)` (Section 1.2), `migrateSyncFields(items, key,
      deviceId)` (Section 5.1).
- [ ] Call `migrateSyncFields()` on every one of the nine arrays immediately after each
      `loadCollection()` call, before `renderX()` is ever invoked for that collection.
- [ ] Add `updatedAt`, `deviceId`, `deleted: false` to every `addX` object literal
      (Section 1.2 table).
- [ ] Add a `stampSync()` call to every mutating function listed in the Section 1.2 table
      (status/date/rating/grade updates, toggles).
- [ ] Rewrite all nine `deleteX(id)` functions from `items = items.filter(...)` to
      "find, set `deleted = true`, `stampSync()`, save" (Section 1.3) — this is a
      code-shape change, not just an added line.
- [ ] Update every `renderX()` function's visibility filter to exclude tombstones as the
      **first** filter step, before search matching: e.g.
      `const visible = books.filter((b) => !b.deleted).filter((b) => matchesBookSearch(b, term))`.
      Applies to all nine collections, including Medications' derived current/former
      grouping and every status-column grouping (Books, Diagnoses, Coursework).
- [ ] Update every empty-state check (`document.getElementById('...-empty-state').hidden
      = X.length !== 0`) to count only non-deleted records, e.g.
      `X.filter((i) => !i.deleted).length !== 0` — otherwise the empty-state message stays
      permanently hidden after the last real record in a collection is deleted, since a
      tombstone would still count toward `X.length`.
- [ ] Do **not** include `updatedAt`, `deviceId`, or `deleted` in any `matchesXSearch`
      haystack — these are non-prose, system-internal fields, consistent with the
      existing precedent of excluding dates/status/booleans from free-text search.
- [ ] No UI is added for viewing, restoring, or purging tombstoned records — out of scope
      per Section 2.5 and Section 8.b.

---

## 7. Edge cases

| Case | Expected behavior |
|---|---|
| First run on a brand-new device (no `localStorage` at all) | `secondMemory.device.v1` doesn't exist → new `deviceId` generated. All nine collections load as `[]` (existing `loadCollection` fallback) → migration is a no-op (nothing to backfill). `secondMemory.sync.v1` doesn't exist → `lastSyncedAt: null`. The (protocol-level) first sync should treat this as "pull everything from the server," since there's no local data to conflict with. |
| Computer off for an extended period; phone accumulates many local writes | No special "offline" flag or queue bookkeeping is needed (Section 3.1) — every write simply bumps that record's `updatedAt`. On reconnect, a sync pass scanning for `updatedAt > lastSyncedAt` picks up every change made while offline, regardless of how long that was. |
| Same record edited differently on both devices while both were offline, then both come back online | Resolved via whole-record last-write-wins (Section 2.6) — the earlier edit is **silently discarded**, not merged. This is an accepted, explicit trade-off for a personal single-user two-device app, not swept under the rug — see Section 8.d for the specific tension this creates for health-related collections. |
| Record deleted on one device, edited on the other before it saw the delete | Resolved by ordinary whole-record LWW between the tombstone and the edit — see the worked-through scenario in Section 2.6. No special-case code required. |
| Same record tombstoned twice (e.g. a duplicate delete click, or a synced-in delete arriving after a local delete already happened) | Idempotent and harmless — `deleted` stays `true`, `updatedAt`/`deviceId` simply reflect whichever delete happened most recently. The existing `if (!record) return` null-guard pattern already used throughout `app.js` covers the "already gone" case; no new guard needed since tombstoned records are never removed from the array. |
| User deletes a record, then adds a new record with identical field values (e.g. same book title/author) | Always a brand-new record with a brand-new `id` via `makeId()` — never revives or reuses a tombstoned record's `id`. Consistent with the app-wide no-dedupe precedent (duplicates are already allowed everywhere). |
| Very large accumulation of tombstones over years of use | Not addressed by automatic purging in this cycle (Section 8.b) — flagged as a real long-term storage-growth question, deferred rather than solved speculatively. |
| A future (tenth+) collection is added in a later cycle | Must carry the same three sync fields with the same semantics, per the uniform-across-all-collections decision in Section 1.1 — this should be treated as a standing constraint going forward, the same way `DECISIONS.md` already tracks other standing constraints. |

---

## 8. Flagged ambiguities — default call made for each, confirmation needed from Architect

**a. Inline sync metadata vs. a separate pending-changes queue.**
Default: inline (Section 3.1) — simplest option, no second source of truth, adequate for
this data volume. *Alternative (a separate outbound-changes queue) would only earn its
complexity at write volumes or delivery-guarantee requirements this app doesn't have —
named for completeness, not because it's a close call.*

**b. Automatic tombstone purging.**
Default: **not built in this cycle.** A tombstone, once created, persists in
`localStorage` indefinitely under this spec. Per `CLAUDE.md`'s "don't add abstractions
beyond what's asked," a purge mechanism is a feature nobody has requested yet, and
realistic tombstone volume for one person's personal-tracking use over a few years is
unlikely to meaningfully stress `localStorage`'s per-origin limits. *Flagging as the
natural next addition once the Researcher's actual sync protocol exists — the safe
purge condition (e.g. "both known devices have acknowledged this tombstone") needs a
concept of "known devices" and "acknowledgment" that only the protocol can define; a
simpler time-based fallback (e.g. purge tombstones older than N days) is a plausible
data-model-level safety net worth deciding then, not guessed at now.*

**c. Whole-record last-write-wins vs. field-level merge for conflicts.**
Default: whole-record LWW (Section 2.6), directly required by the dispatch's explicit "no
CRDTs, no operational-transform" instruction. *Field-level merge is named only to make
clear it was considered and rejected, not because it's a live option here.*

**d. Should health-sensitive collections (Medications, Diagnoses) get different,
more-conservative conflict handling than the other seven collections?**
Default: **no — uniform treatment across all nine**, per this spec's own Section 1.1
decision and the dispatch's explicit "uniform... it should be, for consistency"
instruction, with no request anywhere to special-case Medications/Diagnoses conflict
resolution specifically. *This is flagged as a genuine, real tension worth the
Architect's explicit sign-off rather than a clean default: silently discarding a losing
edit is a materially different kind of loss for "I changed my dosage" than for "I changed
a book's star rating," and the task's own instructions pull in two directions at once
here — "don't lose the user's health/personal data" vs. "no multi-writer conflict UI."
This spec resolves the tension in favor of uniformity and simplicity per the stronger,
more specific "no conflict UI" instruction, but it's a real trade-off, not an obvious
call.*

**e. Tombstoned record content: keep in full, or scrub to a bare minimum
(`id`/`deleted`/`updatedAt`/`deviceId` only)?**
Default: **keep the full record** (Section 1.3) — simplest, and introduces no new privacy
exposure beyond what already exists today (nothing in this app encrypts `localStorage`
contents regardless of a `deleted` flag). *Scrubbing on delete is a real alternative if
minimizing at-rest storage of deleted health/personal content specifically matters more
than this spec assumes — would require per-collection knowledge of which fields to keep
(`id`/`updatedAt`/`deviceId`/`deleted`) vs. scrub (everything else), a small additional
implementation surface not built here by default.*

**f. `deviceId` backfill during migration attributes all pre-existing records to the
current device.**
Not really contestable (Section 5.1) — it happens to be exactly true for this app's
actual history (no sync has ever existed, so every existing record genuinely was created
on the one device running it) — included for transparency, not because a real
alternative exists.

**g. Does `secondMemory.ui.v1` (active tab) sync across devices, or stay purely local?**
Default: **stays purely local, entirely excluded from the sync data model** (Section
5.2) — not migrated, not tagged with sync fields, never transmitted. Justification: the
phone and computer are plausibly used for different collections at the same time (e.g.
Shopping List open on the phone while grocery shopping, Coursework open on the computer
while planning next semester), and forcing the active tab to match across devices would
be an unrequested, likely-unwanted behavior change. *Confirm — syncing the active tab too
is a coherent alternative if "the same experience on both devices" was actually the
intent, but it wasn't requested and this spec defaults against it.*

**h. Client-supplied `updatedAt` vs. server-authoritative receipt timestamp for conflict
comparison.**
Default (data-model level only): comparisons use the client-supplied `updatedAt` field
specified in Section 1.1. *This is explicitly protocol territory — flagged for the
Researcher. If the eventual sync protocol decides the server should be the authority on
"which write is newer" (to protect against client clock skew), that likely means adding
a distinct server-assigned field (e.g. `serverReceivedAt`) alongside, not instead of,
`updatedAt` — which would be a small additive change to this spec's field list once that
design exists, not a contradiction of it.*

**i. Single global `lastSyncedAt` watermark vs. one per collection.**
Default: single global watermark (Section 3.3), assuming all nine collections sync
together in one pass. *Flagged as directly coupled to the Researcher's actual protocol
design — if collections end up syncing independently or asynchronously, `secondMemory
.sync.v1` would need to become a per-collection map instead of a single value, a small,
additive reshape of that one key if it turns out to be needed.*

---

## 9. Summary checklist for the Builder

- [ ] Add the three uniform sync fields (`updatedAt`, `deviceId`, `deleted`) to every
      record in all nine collections exactly per Section 1.1 — no per-collection
      variation.
- [ ] Implement `stampSync()` and call it at every mutation site in Section 1.2's table.
- [ ] Convert all nine `deleteX` functions to tombstone-in-place per Section 1.3, not
      array-filter removal.
- [ ] Keep Notes' existing `dateModified` field unchanged in meaning; add `updatedAt`
      alongside it per Section 1.4, stamped together on add/edit, `updatedAt`-only on
      delete.
- [ ] Do not touch any status-conditional dependent-field rule's existing logic (Books
      rating, Coursework grade, Medications derived status, Diagnoses transitions) beyond
      adding the `stampSync()` call — Section 2 confirms none of them need to change
      behavior.
- [ ] Do not clear dependent fields on tombstoning (Section 2.5) — deletion is a
      metadata-only mutation.
- [ ] Implement `getDeviceId()` / `secondMemory.device.v1` exactly per Section 4.
- [ ] Implement `migrateSyncFields()` and run it on every collection immediately after
      load, before first render, per Section 5.
- [ ] Update every `renderX`/empty-state check to exclude `deleted: true` records per
      Section 6 — this is required for correctness, not optional polish, since without it
      deleted records keep appearing in the UI.
- [ ] Do **not** implement anything protocol-level (actual network sync, authentication,
      transport) from this spec alone — that's the Researcher's forthcoming brief. This
      spec only prepares the local data model to support it.
- [ ] Do **not** implement anything in Section 8 without Architect confirmation —
      defaults are there to unblock, not to finalize.
