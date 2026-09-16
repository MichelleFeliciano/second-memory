# Spec: Books — `currently_reading` status + `jons_bookshelf` column

Status: **Validated by Analyst.** Safe to build against as-is. One accepted limitation
and one non-blocking implementation note are called out in Section 5 — neither requires
an Architect/user decision before Bob starts; they're documented so nobody rediscovers
them mid-build and treats them as bugs.

Reference sources read for this spec: `CLAUDE.md`, `DECISIONS.md` (2026-09-14 initial
scaffold entry, 2026-09-15 personal-data-import entry), current `app.js` (`BOOK_STATUSES`,
`addBook`, `updateBookStatus`, `updateBookRating`, `renderBooks`, `renderBooksStats`,
`BOOK_SORTS`), current `index.html` (Books toolbar/form/columns markup, `books-card-template`).

**Settled by the user, not reopened here:** Jon's Bookshelf is a 5th status value
rendered as a 5th column in the existing single Books view — not a separate section, tab,
or duplicated pipeline. ("Make it just another column like the others.")

---

## 1. Data shape

No new fields. The Book record shape is unchanged:

```
{
  id: string,
  title: string,          // required (HTML `required`, `addBook()` also rejects empty-after-trim)
  author: string,          // optional — "" is valid today for all statuses, stays valid for all 5
  status: string,           // now one of 5 values (was 3) — see enum below
  rating: number|null,      // 1–5, only meaningful when status === 'owned_read' (unchanged rule)
  dateAdded: string,        // ISO timestamp, set once at creation, never ambiguous, never re-derived from status
  updatedAt: string,
  deviceId: string,
  deleted: boolean,
  version: number,
}
```

Only `status` gains new allowed values. `title`/`author`/`dateAdded` requiredness rules
are unchanged and apply identically across all 5 statuses — there is no status-dependent
requiredness rule today and this proposal doesn't introduce one.

### `BOOK_STATUSES` — new order

```js
const BOOK_STATUSES = ['want_to_buy', 'owned_unread', 'currently_reading', 'owned_read', 'jons_bookshelf'];
```

This array's order is the column left-to-right order in the UI (per `renderBooks()`'s
`BOOK_STATUSES.forEach(...)` loop, which drives both column population and count badges).

**Justification:**
- `want_to_buy → owned_unread → currently_reading → owned_read` reads left-to-right as
  the natural acquisition-then-reading pipeline for the user's own books: don't have it →
  have it, haven't started → in progress → finished. This matches how the existing
  `want_to_buy → owned_unread → owned_read` order already reads today; inserting
  `currently_reading` between `owned_unread` and `owned_read` extends the same logic
  rather than inventing a new one.
- `jons_bookshelf` sits last, after `owned_read`, deliberately *outside* that pipeline
  order — it isn't a step in the user's own acquisition/reading journey, it's a
  different fact entirely (whose book this is). Placing it at the far right keeps the
  four "my books" columns contiguous and visually groups the one "not mine" column apart,
  without requiring a second row, tab, or visual separator (none of which the user asked
  for).

No other ordering was seriously considered: putting `jons_bookshelf` in the middle would
break up the reading pipeline for no benefit, and putting it first would visually imply
it's the starting point of the user's own pipeline, which it isn't.

---

## 2. State transitions

**Decision: fully free movement between all 5 statuses, in both directions, via the
existing move-dropdown mechanism — no restricted transition graph.**

This is not a new design choice; it's the existing pattern extended. Today's
`updateBookStatus()` has no transition-adjacency logic at all — it accepts any target in
`BOOK_STATUSES` regardless of the book's current status:

```js
function updateBookStatus(id, newStatus) {
  const book = books.find((b) => b.id === id);
  if (!book || !BOOK_STATUSES.includes(newStatus)) return;
  book.status = newStatus;
  if (newStatus !== 'owned_read') book.rating = null;
  ...
}
```

A book can already jump `want_to_buy → owned_read` directly today, skipping
`owned_unread`, with no special handling. So for the two new statuses:

- **Into `jons_bookshelf`** from any of the other four statuses: allowed, no special
  handling. Example: user realizes a book they'd marked `want_to_buy` is actually one
  Jon owns — just move it.
- **Out of `jons_bookshelf`** to any of the other four statuses: allowed, no special
  handling. Example: user borrows Jon's book and starts it → move to
  `currently_reading`; user ends up buying/being given their own copy → move to
  `owned_unread`/`owned_read` as appropriate.
- **Into/out of `currently_reading`**: same free movement, no adjacency restriction
  (e.g. `currently_reading → want_to_buy` is a valid "gave up on it, don't own it, might
  rebuy later" move; no need to force a round-trip through `owned_unread` first).

No transition confirmation dialogs, no disallowed-transition errors. This matches the
"keep scope tight" constraint in `CLAUDE.md` — a transition graph is unrequested
complexity for a personal single-user tool.

---

## 3. Rating field — confirmed unchanged

The existing single-line rule already generalizes correctly to 5 statuses with **zero
code change to the conditional itself**:

```js
if (newStatus !== 'owned_read') book.rating = null;
```

Since this checks "is the *new* status `owned_read`" rather than enumerating the
statuses being moved *away from*, it already correctly clears `rating` on every
transition into `currently_reading` or `jons_bookshelf` — no special-casing needed, no
gap to close. Moving a book from `owned_read` (with a rating set) to `currently_reading`
(e.g. a re-read) or to `jons_bookshelf` (e.g. discovering it's actually Jon's copy that
got shelved together with the user's books) clears the rating exactly as moving it to
`want_to_buy` or `owned_unread` does today.

Rendering: the rating `<select>`/display stays gated on `status === 'owned_read'`
(`renderBooks()`'s `if (status === 'owned_read') { ratingLabel.hidden = false; ... }`).
This condition also needs no change — `currently_reading` and `jons_bookshelf` books
simply never show the rating control, matching `want_to_buy`/`owned_unread` today.

---

## 4. New fields considered and rejected

### `currently_reading` — no progress/page-number field

**Decision: no new field.** The user asked for a status/column, not a reading-progress
tracker. Adding a page-number, percentage, or "started on" date field would be scope the
user didn't request, and `CLAUDE.md` explicitly says not to add abstractions beyond
what's asked for in a given cycle. If progress tracking is wanted later, that's a
separate, explicitly-requested cycle.

### `jons_bookshelf` — no separate `owner` field

**Decision: no new field. Pure 5th status value, exactly as instructed.** Recommended
over an `owner: 'me' | 'jon'` field (orthogonal to `status`) because:
- It's simpler — no new field, no new UI to set/display it, no interaction with the
  existing rating-clearing logic to reason about.
- It matches the user's literal instruction ("just another column like the others") —
  a column is driven by `status`, not a second axis.
- The dataset is a personal single-user tool with one household member (Jon) ever
  referenced as a book owner other than the user (per `DECISIONS.md`'s Recipes import —
  "Jon's Porkchops," "Jon's Chicken," "Jon's Potato Soup" — no other named household
  member appears anywhere in the app's data). A general-purpose `owner` field would be
  solving for a multi-person household model nobody has asked for.

See Section 5 for the one concrete limitation this simplicity trades away.

---

## 5. Flagged — accepted limitations (not blockers)

1. **`jons_bookshelf` cannot co-exist with another status on the same record.** Because
   ownership-and-whereabouts ("this is Jon's book") and reading-progress ("I'm currently
   reading it") are both collapsed into the single `status` field, a book that is
   *simultaneously* "Jon's" and "the user is currently reading it" can only be
   represented as one status at a time — moving it to `currently_reading` to reflect
   that the user is reading it loses the "it's Jon's" fact (it'll look like just another
   of the user's in-progress books), and leaving it in `jons_bookshelf` loses the "I'm
   currently reading it" fact. This is a real modeling gap versus a two-axis
   (`status` + `owner`) design, but it's accepted rather than fixed, because the user's
   own literal instruction ("just another column like the others") is a single-axis,
   5-status design, and the household has exactly one relevant non-owner (Jon) with no
   indication a second is coming. If this limitation becomes a real friction point in
   practice (e.g. the user regularly borrows Jon's books and wants to track reading
   progress on them separately from "still Jon's"), that's grounds for a future cycle to
   revisit with an explicit `owner` field — not something to guess at now.
2. **5-column layout is a UI/CSS concern, not a data-model one, but worth flagging so it
   isn't mistaken for an ambiguity:** today's `.columns` layout holds 3 side-by-side
   columns; going to 5 may need a CSS wrapping/sizing adjustment to stay usable on
   narrower viewports. This has no bearing on the data model above and needs no decision
   from the Analyst — it's a straightforward implementation detail for Bob (and, if a
   visual call is needed, the Architect), noted here only so it isn't skipped.

---

## 6. Filter/sort interaction — confirmed, no special-casing

Per `docs/specs/filter-sort-all-collections.md`, Books' sort `<select>`
(`selectedBooksSort` / `BOOK_SORTS`) is applied inside `renderBooks()`'s
`BOOK_STATUSES.forEach((status) => { ...visible.filter((b) => b.status === status).sort(comparator)... })`
loop — one shared comparator, applied per status column, driven entirely by iterating
`BOOK_STATUSES`. Since this loop already iterates the array rather than hardcoding
column names, **adding `currently_reading` and `jons_bookshelf` to `BOOK_STATUSES` means
they automatically get the same sort applied with no code change to the sort logic
itself** — only the array literal and the corresponding HTML (columns, labels, move-select
options, add-form status options) need updating. Confirmed: yes, the same sort options
(Author A–Z / Title A–Z / Date Added newest/oldest) should apply uniformly to the two new
columns, for the same consistency reasoning as the rest of that spec. No new sort key is
needed or requested.

---

## 7. Existing 218-book dataset — confirmed purely additive

Per `DECISIONS.md`'s 2026-09-15 personal-data-import entry, all 218 imported books were
placed into only `owned_unread` (174) or `want_to_buy` (44) — explicitly, zero were
imported as `owned_read` because the source tracked ownership, not reading progress.
None were imported as anything that would now need to become `currently_reading` or
`jons_bookshelf` either (the source was the user's own book collection, not a mixed
household one).

**Confirmed:** this change is purely additive to the enum. No existing book record
needs its `status` value touched, migrated, or reinterpreted as part of this rollout —
the two new columns simply start empty and are populated only as the user manually moves
or adds books into them going forward.

---

## 8. Edge cases (uniform across all 5 statuses — no new edge cases introduced)

These all inherit unchanged from the existing 3-status behavior; called out explicitly
so nothing is assumed to need new handling:

- **Duplicate title/author across statuses** (e.g. same title added to both
  `owned_read` and, mistakenly, `jons_bookshelf`): no dedup logic exists today for any
  status pair; this remains a pre-existing, unfixed gap, not something this cycle
  introduces or is expected to fix.
- **Empty/missing `author`**: valid for all 5 statuses, sorts after items with an author
  present (per the existing `compareByField` null-handling convention referenced in
  `docs/specs/filter-sort-all-collections.md` §0.3). No status-specific override.
- **Very long lists**: `currently_reading` and `jons_bookshelf` are expected to stay
  small in practice (a handful of items), but nothing in the render/sort/filter pipeline
  scales differently per column — same single `Array.prototype.sort()` over an
  already-filtered array as the other three columns handle 218 real records today.
- **Search** (`matchesBookSearch`): matches title + author only, unaffected by the
  status enum change — a `jons_bookshelf` book is found by the same title/author search
  as any other book, with no separate "owner" text to match against (consistent with
  Section 4's decision not to add an `owner` field).
- **First run / empty collection**: all 5 columns render with a `0` count badge and the
  existing single shared empty-state message ("No books yet — add your first one
  above.") continues to cover "no books in any column," not per-column messaging — no
  change from today's 3-column behavior.
- **`renderBooksStats()` summary line**: today's format string
  (`` `${total} book${...} · ${want_to_buy count} want to buy · ${owned_unread count} unread · ${owned_read count} read` ``)
  hardcodes 3 of the (soon) 5 statuses. This is a display-text detail, not a data-model
  ambiguity — Bob should extend it to mention `currently_reading` and `jons_bookshelf`
  counts for consistency, but the exact wording is an implementation choice, not
  something this spec needs to pin down further.

---

## 9. Nothing left open

Every point raised in this cycle's brief has a concrete answer above. The one item in
Section 5.1 is recorded as an accepted, intentional limitation of the single-axis design
the user explicitly chose — not an unresolved question — and should not block Bob from
implementing this spec as written.
