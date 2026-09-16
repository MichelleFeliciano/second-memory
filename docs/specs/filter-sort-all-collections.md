# Spec: Filter/Sort Across All Nine Collections

Status: **Validated by Analyst.** Everything below is safe to build against as-is except
the items explicitly called out in Section 4 ("Flagged — unresolved"), which need an
Architect/user decision or a schema change before a Builder should touch them.

Reference sources read for this spec: `CLAUDE.md`, `DECISIONS.md`, current `app.js`
(every `addX()` function, every `renderX()` function, every `matchesXSearch()` function),
current `index.html`.

Scope: the user asked for filter/sort "on anything that logically needs it, like all of
the above but also books in each column and recipes, etc." — read as a full pass across
all nine collections, not just Books. Per the mandate, every control proposed below uses
**only fields that already exist in the data model today**. No new fields are proposed;
where a collection has nothing meaningfully filterable/sortable beyond title-ish text and
`dateAdded`, that's stated plainly in that collection's section rather than papered over.

---

## 0. Shared conventions (apply to every collection below)

These are established precedents already in the codebase (Recipes' category filter,
Books' author-sort) generalized into rules so the Builder implements all nine
consistently instead of inventing a new pattern per tab.

1. **Combination order:** for any collection, the render pipeline is
   `nonDeleted → filter(search) → filter(category/status chip, if any) → sort(comparator) → render`.
   This matches Recipes' existing `visible = nonDeleted.filter(search).filter(category)`
   (AND, not OR) with sort added as a final step. Sort is *never* applied before the
   deleted/search/filter steps — it's a display-order transform on whatever set is
   already visible, not a data mutation. No collection's underlying array order changes
   as a side effect of sorting, consistent with the existing `compareByAuthor` comment in
   `app.js` ("`visible` is a fresh array from `.filter()`, so sorting it never touches the
   underlying array").
2. **`.sort()` must stay stable and non-mutating of canonical order:** every new
   comparator sorts a freshly-filtered array (never the live collection array in place),
   exactly like `compareByAuthor` does today. Two items with equal sort keys keep their
   relative insertion order.
3. **Missing/empty sort-key convention:** any optional/freeform field used as a sort key
   (author, dateDiagnosed, term, title-when-blank, etc.) follows the existing
   `compareByAuthor` null-handling convention: items with a missing/empty value for the
   selected key sort **after** every item that has a value, never alphabetically first as
   a raw empty-string comparison would produce. This must be reimplemented per comparator
   (there's no shared generic helper today) but the behavior must match.
4. **Chip-filter pattern (reuse, don't reinvent):** any new "filter by category-like
   field" control follows Recipes' exact pattern in `renderRecipeCategoryFilters()`:
   values derived fresh from the live, non-deleted array every render (`[...new
   Set(items.map(f).filter(Boolean))]`), sorted alphabetically via `localeCompare` with
   `sensitivity: 'base'`, rendered as buttons with a `chip`/`chip-active` class pair, plus
   an always-present "All" chip that is the default and is auto-reselected if the
   currently-selected value disappears from the data (e.g., last item with that value was
   deleted). Reuse the existing `.chip-row`/`.chip`/`.chip-active` CSS classes — do not
   invent new filter-chip styling.
5. **Sort-control pattern (reuse, don't reinvent):** a plain `<select>` in the
   `.collection-toolbar`, next to the search input, following the same unstyled-`<select>`
   convention already used for `books-status-input` / `coursework-status-input`. No new
   CSS class is required for this; it's a form control like any other in the toolbar.
6. **Persistence:** filter/sort selection is a module-level JS variable, **not** persisted
   to `localStorage` — this matches the existing precedent (`selectedRecipeCategory`
   resets to `'all'` on page reload today; it is not written to
   `secondMemory.ui.v1` or any other storage key). New filter/sort state should follow the
   same lightweight, non-persisted pattern unless the Architect explicitly decides
   otherwise — persisting nine more pieces of UI state is a scope expansion this spec does
   not request.
7. **Empty-collection behavior:** sort `<select>` renders regardless of item count (harmless
   with zero items, same as the existing status `<select>`s). Chip-filter containers render
   with only the "All" chip when no items have a value for that field yet — this already
   happens today in `renderRecipeCategoryFilters()` when `categories` is empty, so no new
   logic is needed to handle it.
8. **Duplicate/near-duplicate filter values are a pre-existing, unfixed gap.** Recipes'
   category chips today are exact-string matches with no case-folding or trimming
   normalization beyond what `addRecipe()` already does (`category.trim()`); `"Sides"` and
   `"sides"` would show as two separate chips. This spec reuses that exact pattern for two
   more fields (Coursework `term`, Shopping `category`), so the same latent gap now exists
   in three places instead of one. **Flagged in Section 4** — not fixed here, since fixing
   it would mean changing Recipes' already-shipped behavior, which is out of scope for a
   filter/sort pass.
9. **Large lists:** Books alone has 218 real records today. All proposed sorts are a
   single `Array.prototype.sort()` call over an already-filtered array — no quadratic
   behavior introduced, no pagination needed at this scale.

---

## 1. Books

**Fields** (from `addBook()`, `app.js` lines 118–136): `title` (required), `author`
(optional string), `status` (`want_to_buy` / `owned_unread` / `owned_read`), `rating`
(1–5 or `null`, only ever set — per `updateBookStatus()` — while `status === 'owned_read'`),
`dateAdded` (ISO timestamp).

**Filter:** none proposed. The three status columns are already a structural filter (the
data model's own mutually-exclusive `status` field), and there is no second bounded field
(no genre/tag) to filter on. Adding a redundant status filter on top of the columns
themselves would be pure ceremony.

**Sort:** promote the existing hardcoded `compareByAuthor()` to a user-facing control. One
shared `<select>` in the Books toolbar (not three separate per-column selects — the
current behavior already applies one comparator uniformly to all three columns via
`itemsForStatus.sort(compareByAuthor)`, so a single control is the minimal change that
preserves that symmetry). Options:
- **Author (A–Z)** — default, preserves current shipped behavior exactly (missing author
  sorts last, per Section 0.3).
- **Title (A–Z)**
- **Date Added (Newest first)**
- **Date Added (Oldest first)**

Each option applies identically to all three columns. Selecting a sort option never
changes `status` or any other field — display-order only.

**Edge cases:**
- 218-book real dataset: confirms Section 0.9, no performance concern.
- Duplicate titles/authors: comparator falls through to stable insertion order, same as
  today.
- Empty `author`: sorts last under "Author (A–Z)" per Section 0.3; unaffected by other
  sort options.

**Flagged — not proposed:** a **Rating (High→Low)** sort option, scoped only to the
`owned_read` column, is a reasonable follow-up since the field already exists on every
`owned_read` book. It's deliberately left out of this pass to keep one sort control
uniform in meaning across all three columns rather than having an option that's only
valid/meaningful in one of them. If wanted, this should be a small, explicit follow-up
decision, not silently bundled in here.

---

## 2. Recipes

**Fields** (from `addRecipe()`, lines 264–283): `title` (required), `category` (optional
string — see DECISIONS.md 2026-09-15, now fully backfilled to one of three values:
Puerto Rican / Comfort Food / Sides & Vegetables), `ingredients` (string array),
`steps` (string array), `notes` (string), `dateAdded`.

**Filter:** already implemented (category chips, Section 0.4's source pattern). No change
needed.

**Sort:** currently none — `renderRecipes()` renders `visible` in raw array order, which
is insertion order (≈ ascending `dateAdded`, since `addRecipe()` only ever `push()`es).
Add one `<select>` next to the existing search input:
- **Date Added (Oldest first)** — default; this is a no-op relative to current shipped
  behavior, so choosing it as default introduces zero visible change for existing users.
- **Date Added (Newest first)**
- **Title (A–Z)**

No numeric or other sortable scalar field exists (`ingredients`/`steps` are arrays,
`notes` is free text) — nothing further to propose.

**Edge cases:** combines with the existing category chip via the Section 0.1 pipeline
(search → category → sort), matching the AND semantics already established for
search+category in DECISIONS.md's 2026-09-15 "stale-render race" bugfix note (category
filter recompute must still happen before `visible` is computed — the sort step slots in
*after* that, not before).

---

## 3. Medications

**Fields** (from `addMedication()`, lines 431–458): `name` (required), `dosage`,
`frequency`, `prescribingDoctor` (all free-text strings), `startDate`/`endDate` (date
strings or `null`), `notes`, `dateAdded`. `status` is *not* a stored field — "Currently
Taking" vs. "No Longer Taking" is derived from `endDate === null` (per DECISIONS.md
2026-09-14).

**Filter:** none proposed as a new control. The Current/Former grouping is already a
derived structural filter on `endDate`. `prescribingDoctor` is the only other
plausibly-boundable field, but unlike Recipes' `category` (deliberately curated by the
Architect down to exactly 3 values), `prescribingDoctor` is raw free text with no
curation step — it could produce anywhere from 0 to N distinct chips depending on how
many different doctors are on file, with no guarantee of a small, useful set. **Flagged
in Section 4** as an optional follow-up rather than built here, so it isn't forced onto a
field that may not behave like a clean category.

**Sort:** add one `<select>` per group is unnecessary — both the "Currently Taking" and
"No Longer Taking" lists can share one control, applied identically to both, same
reasoning as Books:
- **Name (A–Z)** — proposed default (medications have no natural chronological
  default the way Recipes does).
- **Start Date (Newest first)**
- **Start Date (Oldest first)**

**Edge cases:** `startDate` can be `null` ("unknown", per the existing `unknown-hint`
UI) — follows Section 0.3 (null `startDate` sorts after every dated record, under either
Start Date option).

---

## 4. Diagnoses

**Fields** (from `addDiagnosis()`, lines 612–631): `condition` (required), `dateDiagnosed`
(date string or `null`), `provider` (free text), `status` (`active`/`monitoring`/
`resolved`), `notes`, `dateAdded`.

**Filter:** none proposed as a new control, same reasoning as Books — the three status
columns are already the structural filter on the collection's one bounded field.
`provider` is free text with the same "no curation, unbounded cardinality" problem as
Medications' `prescribingDoctor` — **flagged in Section 4** alongside it, not built here.

**Sort:** one shared `<select>` applied uniformly across all three status columns:
- **Condition (A–Z)** — proposed default.
- **Date Diagnosed (Newest first)**
- **Date Diagnosed (Oldest first)**

**Edge cases:** `dateDiagnosed` can be `null` (rendered today as the literal text "Date
unknown") — follows Section 0.3, null sorts last under either Date Diagnosed option.

---

## 5. To-Do

**Fields** (from `addTodo()`, lines 720–737): `task` (required), `completed` (boolean),
`dueDate` (date string or `null`), `dateAdded`. There is **no priority field**.

**Filter:** add a chip-style filter on `completed`, reusing the Section 0.4 pattern but
adapted for a boolean instead of an open string set (so it's a fixed 3-chip set, not
dynamically derived): **All** (default) / **Active** / **Completed**. This is a genuinely
useful filter today because, per DECISIONS.md 2026-09-14, completed to-dos stay in the
same flat list with a strikethrough rather than moving to a separate section — a filter
is the only way to hide them without deleting them.

**Sort:** one `<select>`:
- **Due Date (Soonest first)** — proposed default. Note this has a nice side effect: since
  `isTodoOverdue()` already defines "overdue" as `dueDate < today`, sorting ascending by
  due date naturally surfaces overdue items at the top without any extra logic.
- **Due Date (Latest first)**
- **Date Added (Newest first)**
- **Date Added (Oldest first)**

**Edge cases:** `dueDate` can be `null` (no due date set) — follows Section 0.3, sorts
after every dated to-do under either Due Date option, regardless of `completed`.

**Flagged — cannot be built without a schema change:** the user's own framing example
("does To-Do have a due date or priority field?") anticipates this — **there is no
priority field on To-Do today.** A priority-based filter/sort is not proposed here; it
would require the Architect/Researcher to add a `priority` field first, which is outside
this Analyst pass's mandate to invent schema.

---

## 6. Shopping List

**Fields** (from `addShoppingItem()`, lines 819–837): `item` (required), `quantity`
(free-text string, not numeric — e.g., "2 lbs" or "a dozen"), `checked` (boolean),
`category` (optional free-text string), `dateAdded`.

**Filter:** two controls, both justified by existing fields:
- **Category chips**, reusing the exact Recipes pattern (Section 0.4) — `category` here
  is genuinely a bounded-ish field the same way Recipes' curated `category` is, since
  grocery categories (produce, dairy, etc.) naturally cluster into a small set even
  without upfront curation.
- **Checked/Active toggle**, same 3-chip shape as To-Do's Active/Completed (Section 5) —
  useful for the same reason: checked items stay in the flat list with a strikethrough
  rather than moving out.

Both filters combine via AND with each other and with search, per Section 0.1.

**Sort:** one `<select>`:
- **Date Added (Oldest first)** — default, matches current unsorted (insertion-order)
  behavior with zero visible change, same reasoning as Recipes.
- **Date Added (Newest first)**
- **Item (A–Z)**

`quantity` is explicitly **not** proposed as a sort key — it's free text ("2 lbs" vs. "a
dozen" vs. "3"), not a normalized number, so an alphabetical sort on it would be
meaningless (e.g., "10 lbs" would sort before "2 lbs"). Flagged in Section 4 for
completeness, though it's a low-priority gap since quantity isn't a field anyone would
plausibly want to sort by anyway.

---

## 7. Notes

**Fields** (from `addNote()`/`updateNote()`, lines 921–957): `title` (optional string),
`body` (string), `dateAdded`, `dateModified` (updated on every edit — the only collection
with a distinct modified-vs-added timestamp, per DECISIONS.md 2026-09-14).

**Filter:** none proposed — **flagged in Section 4** as a real gap. There is no
tag/category/status field on Notes at all; the only fields are free text and two
timestamps. A filter needs a bounded value to filter *on*, and none exists here without
adding one (e.g., a `tags` field), which this pass is not authorized to invent.

**Sort:** one `<select>`. Notes already surfaces `dateModified` prominently in the UI
("Updated {date}"), so recency-of-edit is the natural default:
- **Last Updated (Newest first)** — proposed default.
- **Last Updated (Oldest first)**
- **Date Added (Newest first)**
- **Date Added (Oldest first)**
- **Title (A–Z)**

**Edge cases:**
- `title` is optional and frequently blank in practice (untitled notes are valid, per
  `addNote()`'s validation which only requires title *or* body). Under "Title (A–Z)",
  blank-titled notes sort last, per Section 0.3.
- Notes has a live, stateful inline edit form that `renderNotes()` already goes out of
  its way to preserve across re-renders (captured/restored via `openEdit`, per
  DECISIONS.md 2026-09-14's fix). **Any sort/filter re-render must preserve that same
  open-edit-capture-and-restore behavior** — changing the sort order must not silently
  discard an in-progress unsaved edit the way the pre-fix bug did. This is a real
  implementation risk worth flagging explicitly to the Builder, not just an incidental
  note.

---

## 8. Resume & Portfolio (links)

**Fields** (from `addLink()`, lines 1084–1104): `label` (required), `url` (required,
stored verbatim per DECISIONS.md 2026-09-14), `notes` (optional), `dateAdded`.

**Filter:** none possible — **flagged in Section 4**. No status/category/type field
exists (e.g., no "GitHub / LinkedIn / Portfolio" kind field), and this list is expected
to stay small (a handful of professional links), so the absence is low-stakes.

**Sort:** one `<select>`:
- **Date Added (Oldest first)** — default, matches current unsorted behavior.
- **Date Added (Newest first)**
- **Label (A–Z)**

No other sortable field exists (`url` and `notes` are free text with no natural order).

---

## 9. Degree & Coursework

**Fields** (from `addCourse()`, lines 1191–1216): `title` (required), `code` (optional),
`credits` (nullable number, validated non-negative by `parseCredits()`), `term` (optional
free-text string, e.g., "Fall 2026"), `status` (`completed`/`in_progress`/`planned`),
`grade` (nullable string, only ever set — per `updateCourseStatus()` — while
`status === 'completed'`), `notes`, `dateAdded`.

**Filter:** add a **Term chip filter**, reusing the Section 0.4 pattern exactly — `term`
is a real, already-populated field (per DECISIONS.md 2026-09-15's transcript import: 48
real courses each carrying a term like "Fall 2026" or a Tarrant County transfer-credit
note). Applies across all three status columns simultaneously (AND with the structural
status split and with search), same combination rule as Section 0.1.

**Sort:** one shared `<select>` applied uniformly across all three status columns:
- **Title (A–Z)** — proposed default.
- **Course Code (A–Z)**
- **Credits (High→Low)**
- **Credits (Low→High)**
- **Date Added (Newest/Oldest)**

**Edge cases:**
- `credits` can be `null` (optional field) — follows Section 0.3, null sorts last under
  either Credits option. `0` is a valid, distinct value from `null` (`parseCredits()`
  already returns them as distinct cases) and must **not** be treated as falsy/missing by
  the comparator — a 0-credit course sorts as the lowest real value, not last.
- `code` and `term` are both optional — follow Section 0.3 where used as sort/filter
  keys.

**Flagged — unresolved, real gap (see Section 4):** a **Term** sort option is
deliberately **not** proposed, even though `term` exists and a Term *filter* is. A term
string like "Fall 2026" has no structured year/season split in the data model, so a
plain `localeCompare` sort on it would be **alphabetical, not chronological** — "Fall
2025" and "Fall 2026" would each sort before every "Spring" term regardless of year,
which is actively misleading for an academic-history use case. Fixing this properly
would require a schema change (e.g., a derived/parsed `termYear` + `termSeason`, or a
normalized sortable key) that this Analyst pass is not authorized to invent. The Term
*filter* (chip selection) doesn't have this problem — chips just need to exist and be
selectable, chip *ordering* is cosmetic — but chronological Term *sorting* is out of
scope until the Architect/Researcher decides how to represent term chronology.

---

## Summary table

| Collection | Filter (new)? | On field | Sort (new)? | Options | Real gap flagged? |
|---|---|---|---|---|---|
| Books | No (status columns already structural) | — | Yes | Author A–Z (default) / Title A–Z / Date Added ↑↓ | Rating sort scoped to `owned_read` only — deliberately deferred |
| Recipes | No (already shipped) | `category` | Yes | Date Added ↑↓ (default: oldest first) / Title A–Z | — |
| Medications | No (Current/Former already structural) | — | Yes | Name A–Z (default) / Start Date ↑↓ | `prescribingDoctor` chip filter deferred (unbounded cardinality) |
| Diagnoses | No (status columns already structural) | — | Yes | Condition A–Z (default) / Date Diagnosed ↑↓ | `provider` chip filter deferred (unbounded cardinality) |
| To-Do | Yes | `completed` (All/Active/Completed) | Yes | Due Date ↑ (default) / Due Date ↓ / Date Added ↑↓ | **No priority field exists — cannot filter/sort by priority without a schema change** |
| Shopping List | Yes | `category` chips + Checked/Active toggle | Yes | Date Added ↑↓ (default: oldest first) / Item A–Z | `quantity` not sortable (free text, not numeric) |
| Notes | **No — real gap** | — (no bounded field exists) | Yes | Last Updated ↑↓ (default: newest first) / Date Added ↑↓ / Title A–Z | **No tag/category field exists**; sort must preserve in-progress open-edit-form state on re-render |
| Resume & Portfolio | **No — real gap** | — (no bounded field exists) | Yes | Date Added ↑↓ (default: oldest first) / Label A–Z | **No status/type field exists** |
| Degree & Coursework | Yes | `term` chips | Yes | Title A–Z (default) / Course Code A–Z / Credits ↑↓ / Date Added ↑↓ | **Term sort deliberately omitted — alphabetical ≠ chronological, needs a schema decision** |

---

## Section 4: Flagged back to the Architect/Researcher — unresolved

These are real gaps, not silently papered over. None should be built as part of this
pass without a separate decision:

1. **To-Do has no priority field.** If priority filtering/sorting is wanted, a
   `priority` field (and its allowed values, e.g., `low`/`medium`/`high`) needs to be
   designed first — that's new schema, outside this Analyst pass's mandate.
2. **Notes has no tag/category field**, so no filter is proposed for it at all. If
   filtering Notes is wanted, the same schema-first caveat applies.
3. **Resume & Portfolio has no status/type field** (e.g., distinguishing "Resume" vs.
   "Portfolio" vs. "GitHub" beyond the free-text `label`), so no filter is proposed.
4. **Medications' `prescribingDoctor` and Diagnoses' `provider`** are structurally
   filterable (both are single free-text fields on every record) but were deliberately
   **not** turned into chip filters in this pass, because — unlike Recipes' `category`,
   which the Architect explicitly curated down to 3 values — these fields have never been
   curated and could produce an unpredictable, possibly-unhelpful number of chips. This is
   a judgment call, not a hard blocker; if the real data turns out to have a small, clean
   set of doctors/providers, this could be revisited cheaply.
5. **Degree & Coursework's `term` field can't be sorted chronologically** as stored
   (free-text like "Fall 2026") — only alphabetically, which is misleading for academic
   history. A real fix needs a schema decision (structured term representation), not a
   sort-control decision.
6. **Chip-filter value normalization is a pre-existing, now-tripled gap** (Section 0.8):
   Recipes' category chips, and the two new chip filters this spec proposes (Shopping
   `category`, Coursework `term`), all do exact-string matching with no case-folding —
   `"Fall 2026"` and `"fall 2026 "` would produce two separate chips. Not a blocker (the
   data is currently clean/curated by hand per DECISIONS.md), but worth the Architect's
   awareness before it's copied a fourth time in some future collection.
