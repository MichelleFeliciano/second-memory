# Spec: Books — `textbook` status + `jons_bookshelf_read` status/column

Status: **Validated by Analyst.** Safe to build against as-is. Two accepted limitations
and one non-blocking implementation note are called out in Section 5 — none require an
Architect/user decision before Bob starts; they're documented so nobody rediscovers them
mid-build and treats them as bugs.

Reference sources read for this spec: `CLAUDE.md`, `docs/specs/books-currently-reading-jons-bookshelf.md`
(prior cycle, settled precedent), current `app.js` (`BOOK_STATUSES`, `addBook`,
`updateBookStatus`, `updateBookRating`, `matchesBookSearch`, `BOOK_SORTS`,
`renderBooksStats`, `renderBooks`), current `index.html` (Books toolbar/form/columns
markup, move-select options), current `style.css` (`.book-columns` grid rule).

**Settled by the user, not reopened here:** per the prior cycle, a new "kind of book"
request is a new status value / new column in the same flat single-axis model — not a
separate section, tab, or a second `owner`/`type` field. This cycle (Textbooks, Jon's
Bookshelf — Read) is a mechanical extension of that already-settled pattern, applied
identically. Nothing about that precedent is re-litigated here.

**User's request, verbatim:** "give me a Textbooks column and a Jon's Bookshelf-read
column in books."

---

## 1. Data shape

No new fields. The Book record shape is unchanged from the prior cycle:

```
{
  id: string,
  title: string,          // required (HTML `required`, `addBook()` also rejects empty-after-trim)
  author: string,          // optional — "" is valid today for all statuses, stays valid for all 7
  status: string,           // now one of 7 values (was 5) — see enum below
  rating: number|null,      // 1–5, only meaningful when status === 'owned_read' (unchanged rule)
  dateAdded: string,        // ISO timestamp, set once at creation, never ambiguous, never re-derived from status
  updatedAt: string,
  deviceId: string,
  deleted: boolean,
  version: number,
}
```

Only `status` gains new allowed values. `title`/`author`/`dateAdded` requiredness rules
are unchanged and apply identically across all 7 statuses.

### `BOOK_STATUSES` — new array and order

```js
const BOOK_STATUSES = [
  'want_to_buy',
  'owned_unread',
  'currently_reading',
  'owned_read',
  'textbook',
  'jons_bookshelf',
  'jons_bookshelf_read',
];
```

This array's order is the column left-to-right order in the UI (per `renderBooks()`'s
`BOOK_STATUSES.forEach(...)` loop, unchanged mechanism from the prior cycle).

**Placement decisions and justification:**

- **The first four (`want_to_buy → owned_unread → currently_reading → owned_read`) are
  untouched** — this is the user's own acquisition/reading pipeline, already settled last
  cycle. Nothing about it changes here.

- **`textbook` slots in right after `owned_read`, before the two Jon's Bookshelf
  columns.** It is, like `jons_bookshelf` before it, "a different fact" outside the
  reading-pipeline order (it's about *what kind of book it is*, not *where the user is in
  reading it*), so it belongs in the same trailing group as `jons_bookshelf` rather than
  inside the pipeline. Within that trailing group, `textbook` is placed *before* the two
  Jon's Bookshelf columns rather than after, because a textbook is still one of the
  user's own books (something the user owns/uses), whereas Jon's Bookshelf is a
  different person's books entirely — ordering left-to-right as "mine, in reading-pipeline
  order" → "mine, but a different fact (it's a textbook)" → "not mine at all (Jon's)"
  reads as a sensible closest-to-farthest grouping. No functional consequence rides on
  this choice (per Section 2, movement between all 7 is free either way) — it's purely a
  readability call for the column order.

- **`jons_bookshelf_read` sits immediately next to `jons_bookshelf`, keeping Jon's two
  columns adjacent** — unlike `owned_unread`/`owned_read`, which aren't adjacent today
  because `currently_reading` sits between them. This is a deliberate difference, not an
  inconsistency: `currently_reading` exists as a real, requested concept for the user's
  own reading pipeline, but no "Jon's Bookshelf — currently reading" status has been
  requested here (the user's request was only for a "Jon's Bookshelf-read" column, mirroring
  the existing unread/read split on the user's own books — see Section 4 for why no
  `jons_bookshelf_currently_reading` is being added). With no in-between concept for
  Jon's shelf, there is no reason to separate the two Jon's columns, and adjacency makes
  the "these two are a pair" relationship visually obvious.

No other ordering was seriously considered: interleaving `textbook` or
`jons_bookshelf_read` back into the first four would break up the reading pipeline for no
benefit (same reasoning the prior spec already applied to `jons_bookshelf`).

### Column/status label — `jons_bookshelf` relabeled for symmetry (display text only, no enum change)

**Decision:** relabel the existing `jons_bookshelf` column heading from "Jon's Bookshelf"
to **"Jon's Bookshelf — Unread"**, and label the new column **"Jon's Bookshelf — Read."**
This is a **display-text-only change** — the underlying `status` string value stays
`jons_bookshelf` (not renamed to `jons_bookshelf_unread`), specifically so that no
existing book record needs its `status` value migrated (see Section 7).

**Justification:** the app already establishes the "— Unread"/"— Read" labeling
convention for the user's own books (`"Owned — Unread"` / `"Owned — Read"` in
`index.html`). Now that a genuine unread/read pair exists for Jon's shelf too, leaving
the first column labeled plain "Jon's Bookshelf" would read as ambiguous once a second,
differently-labeled Jon's column appears next to it — a reader would have to infer that
plain "Jon's Bookshelf" implicitly means "unread." Relabeling it "Jon's Bookshelf —
Unread" removes that ambiguity and matches the existing naming pattern exactly, at zero
cost (no code/logic change, no migration — just the heading text in `index.html` and the
`<option>` label text in the add-form/move-select dropdowns).

---

## 2. State transitions

**Confirmed: free movement between all 7 statuses, in both directions, via the existing
move-dropdown mechanism — no restricted transition graph.** This is not re-derived here;
it's the same already-settled precedent from the prior cycle, extended without
modification. `updateBookStatus()` has no transition-adjacency logic today and needs
none added:

```js
function updateBookStatus(id, newStatus) {
  const book = books.find((b) => b.id === id);
  if (!book || !BOOK_STATUSES.includes(newStatus)) return;
  book.status = newStatus;
  if (newStatus !== 'owned_read') book.rating = null;
  ...
}
```

Because this checks membership in `BOOK_STATUSES` generically, extending the array to 7
values means `textbook` and `jons_bookshelf_read` are automatically valid move targets
from — and valid statuses to move away from — any of the other 6, with zero code change
beyond the array literal. No new transition confirmation dialogs, no disallowed-transition
errors, matching `CLAUDE.md`'s "keep scope tight" constraint.

---

## 3. Rating field — confirmed unchanged

The existing rule already generalizes correctly to 7 statuses with **zero code change to
the conditional itself**:

```js
if (newStatus !== 'owned_read') book.rating = null;
```

This clears `rating` on every transition into `textbook` or `jons_bookshelf_read` exactly
as it already does for `want_to_buy`, `owned_unread`, `currently_reading`, and
`jons_bookshelf` — no special-casing needed. Note explicitly: **`jons_bookshelf_read`
does *not* get its own rating capability**, even though "read" is in its name. Rating in
this app is scoped to "the user's own finished copy" (`owned_read`) — a book on Jon's
shelf that the user has read is still not the user's own owned copy, so it's excluded
from rating the same way `jons_bookshelf` already is today. This is consistent, not an
oversight: the rating field's gating condition (`status === 'owned_read'`) was never "is
this book finished," it was specifically "is this the user's owned, finished copy."

Rendering: the rating `<select>`/display stays gated on `status === 'owned_read'`
(`renderBooks()`'s `if (status === 'owned_read') { ratingLabel.hidden = false; ... }`).
This condition needs no change — `textbook` and `jons_bookshelf_read` books simply never
show the rating control, matching `jons_bookshelf`/`currently_reading` today.

---

## 4. New fields considered and rejected

### `textbook` — no separate "is textbook" boolean

**Decision: no new field. Pure 7th status value.** A boolean flag orthogonal to `status`
(e.g. `isTextbook: true` layered on top of `owned_read`/`owned_unread`/etc.) was
considered and rejected for the same reasons the prior spec rejected an `owner` field for
`jons_bookshelf`: it's a second axis nobody asked for, it's more state to reason about
(does a textbook that's also `owned_read` show in both the Textbooks column and the
Owned — Read column, or just one? — a question a flag design forces and a pure-status
design avoids entirely), and the user's literal request ("a Textbooks column") maps
directly onto a status/column, not a flag.

### `jons_bookshelf_read` — no separate `owner` field, no `jons_bookshelf_currently_reading` status

**Decision: no new field, and no third Jon's-shelf status added beyond the requested
pair.** Two things were explicitly *not* added, both out of scope for what was asked:

- No `owner` field — same reasoning as the prior spec's Section 4 (single relevant
  non-owner in the household, per `DECISIONS.md`'s Recipes import; a general `owner` axis
  would solve for a multi-person model nobody has requested).
- No `jons_bookshelf_currently_reading` status — the user asked for exactly one new Jon's
  column ("a Jon's Bookshelf-read column"), a "read" counterpart to the existing
  `jons_bookshelf`, not a full three-state pipeline mirroring the user's own
  want/unread/reading/read cycle for Jon's books too. If the user wants to track
  "currently reading one of Jon's books" as its own status later, that's a new,
  explicitly-requested cycle — not something to guess at now.

---

## 5. Flagged — accepted limitations and implementation notes (not blockers)

1. **`textbook` cannot co-exist with `currently_reading` or `owned_read` on the same
   record — same tradeoff already accepted for `jons_bookshelf`, not re-litigated here.**
   Because "this is a textbook" and "I'm currently reading it" / "I've finished it" are
   both collapsed into the single `status` field, a book that is a textbook the user is
   *also* actively reading or has finished can only be represented as one status at a
   time. Moving it to `textbook` loses the in-progress/finished fact; leaving it in
   `currently_reading`/`owned_read` loses the "it's a textbook" fact. This is the exact
   same single-axis tradeoff the prior spec already documented and the user already
   accepted for `jons_bookshelf`, applied identically to `textbook` — not a new gap
   introduced by this cycle, and not up for reconsideration here.

2. **`jons_bookshelf_read` cannot co-exist with `currently_reading` either, for the same
   reason.** A book the user is currently reading that happens to be one of Jon's already
   couldn't be flagged as Jon's while in `currently_reading` (per the prior spec's
   Section 5.1) — that limitation now simply also applies symmetrically to the "read"
   half of Jon's shelf pair. No new limitation category, just the existing one extended.

3. **7-column layout is a UI/CSS concern, not a data-model one, flagged so it isn't
   mistaken for an ambiguity:** `.book-columns { grid-template-columns: repeat(auto-fit,
   minmax(200px, 1fr)); }` (added last cycle specifically to handle the jump from 3 to 5
   columns) should mechanically accommodate 7 by wrapping to additional rows on narrower
   viewports — but this hasn't been visually verified at 7. Bob should double-check
   readability/wrapping at 7 columns on a typical viewport width rather than assuming the
   existing rule is sufficient; this needs no Analyst/Architect decision, just a visual
   check during implementation.

---

## 6. Filter/sort interaction — confirmed, no special-casing

Per `docs/specs/filter-sort-all-collections.md` and the prior Books cycle's Section 6,
Books' sort (`selectedBooksSort` / `BOOK_SORTS`) is applied inside `renderBooks()`'s
`BOOK_STATUSES.forEach((status) => { ...visible.filter((b) => b.status === status).sort(comparator)... })`
loop, driven entirely by iterating `BOOK_STATUSES`. **Confirmed: adding `textbook` and
`jons_bookshelf_read` to the array means they automatically get the same sort applied,
with zero code change to the sort logic itself** — only the array literal and the
corresponding `index.html` markup (two new columns, two new `<option>`s in the add-form
status select, two new `<option>`s in the move-select dropdown) need updating. The same
sort options (Author A–Z / Title A–Z / Date Added newest/oldest) apply uniformly to the
two new columns, for the same consistency reasoning as the rest of that spec. No new sort
key is needed or requested.

`matchesBookSearch` (title + author only) is likewise unaffected — a `textbook` or
`jons_bookshelf_read` book is found by the same title/author search as any other book.

---

## 7. Existing data — confirmed purely additive

Per `DECISIONS.md`'s 2026-09-15 personal-data-import entry, all 218 imported books were
placed into only `owned_unread` or `want_to_buy`; per the prior cycle, none of those need
touching for `currently_reading`/`jons_bookshelf` either. That remains true here.

**Confirmed:** this change is purely additive to the enum, for both new statuses.

- No existing book record's `status` value needs migrating. This includes any book a
  user has already moved into `jons_bookshelf` since the prior cycle shipped
  (commit `4ccd5ab` per `DECISIONS.md`) — those records keep the exact same `status:
  'jons_bookshelf'` string; only the column's *display label* changes (Section 1), not
  the stored value, so nothing needs to be re-tagged or reinterpreted.
- The two new columns (`textbook`, `jons_bookshelf_read`) simply start empty and are
  populated only as the user manually moves or adds books into them going forward.

---

## 8. Edge cases (uniform across all 7 statuses — no new edge cases introduced)

These all inherit unchanged from the existing 5-status behavior; called out explicitly so
nothing is assumed to need new handling:

- **Duplicate title/author across statuses** (e.g. same title in both `owned_read` and
  `textbook`, or in both `jons_bookshelf` and `jons_bookshelf_read`): no dedup logic
  exists today for any status pair; this remains a pre-existing, unfixed gap, not
  something this cycle introduces or is expected to fix.
- **Empty/missing `author`**: valid for all 7 statuses, sorts after items with an author
  present, per the existing convention. No status-specific override.
- **Very long lists**: `textbook` and `jons_bookshelf_read` are expected to stay small in
  practice, but nothing in the render/sort/filter pipeline scales differently per
  column — same single `Array.prototype.sort()` over an already-filtered array as the
  other five columns handle today.
- **Search**: unaffected by the enum change, per Section 6.
- **First run / empty collection**: all 7 columns render with a `0` count badge and the
  existing single shared empty-state message continues to cover "no books in any
  column" — no per-column messaging, no change from today's behavior.
- **`renderBooksStats()` summary line**: today's format string hardcodes 5 of the (soon)
  7 statuses:
  ```js
  el.textContent = `${total} book${...} · ${countFor('want_to_buy')} want to buy · ` +
    `${countFor('owned_unread')} unread · ${countFor('currently_reading')} currently reading · ` +
    `${countFor('owned_read')} read · ${countFor('jons_bookshelf')} on Jon's Bookshelf`;
  ```
  This is a display-text detail, not a data-model ambiguity — Bob should extend it to
  mention `textbook` and `jons_bookshelf_read` counts for consistency (and update the
  existing `jons_bookshelf` phrase to reflect the "— Unread" relabel from Section 1 if he
  wants the summary line to match the column headings exactly), but the exact wording is
  an implementation choice, not something this spec needs to pin down further.

---

## 9. Nothing left open

Every point raised in this cycle's brief has a concrete answer above. Section 5's two
limitations are recorded as accepted, intentional consequences of the single-axis design
the user already chose (settled last cycle, not reopened) — not unresolved questions —
and should not block Bob from implementing this spec as written.
