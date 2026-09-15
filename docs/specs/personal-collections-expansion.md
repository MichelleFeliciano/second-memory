# Spec: Personal Collections Expansion (To-Do, Shopping List, Notes, Resume &
Portfolio, Degree & Coursework)

Status: **Validated by Analyst, with flagged decisions the Architect must confirm before
Builder starts** (see Section 7). Everything else in this document is safe to build
against as-is.

Reference sources read for this spec: `CLAUDE.md`, `DECISIONS.md`,
`docs/specs/multi-tab-tracker.md`, current `index.html`, current `app.js`.

This cycle adds five new collections to the existing four (Books, Recipes, Medications,
Diagnoses), bringing the sidebar to nine items total. It follows the exact conventions
established by the prior spec and its implementation: `secondMemory.<name>.v1` storage
keys, one independent array + one independent `localStorage` key per collection (no
shared state), the shared `makeId()` / `loadCollection()` / `saveCollection()` helpers
already in `app.js`, the `TABS` array + `data-tab` sidebar-button + `${tab}-collection`
section pattern in `setActiveTab()`, and status-conditional dependent fields following
the Books `rating` precedent.

---

## 1. Navigation scaling — sidebar grouping

### 1.1 Decision: group the sidebar into three labeled sections

Nine flat, un-differentiated buttons in one `<ul class="nav-list">` asks the user to
visually parse a single undifferentiated list to find, e.g., "Shopping list" among
Books/Recipes/Medications/Diagnoses/To-Do/Notes/Resume/Degree. That's a real usability
cost that grouping fixes essentially for free (it's a markup/CSS change, not a data or
behavior change). Flat lists work fine at 4 items; at 9, a scan cost appears.

The grouping is chosen to reflect what these nine collections are actually *for*, not an
arbitrary split into three even piles:

| Group label | Collections | Rationale |
|---|---|---|
| **Personal** | To-Do, Shopping List, Notes | Day-to-day, high-churn, no long-term structure — things you check off or jot down and move on. |
| **Health** | Medications, Diagnoses | Unchanged from the existing implicit grouping; both track ongoing medical state. |
| **Career & Academics** | Resume & Portfolio, Degree & Coursework | Both are about credentials/professional presentation, looked at far less often than the "Personal" group. |

**Books and Recipes do not fit cleanly into any of the three groups above** — they are
personal-interest collections but not "day-to-day churn" like a to-do or shopping list,
and grouping them under "Personal" alongside To-Do/Shopping/Notes would make that group
five items wide while the other two stay at two, undermining the point of grouping at
all. Default: add a fourth group, **"Library"**, containing Books and Recipes. This gives
four evenly-sized groups (3/2/2/2) instead of forcing a lopsided split. *This is a
judgment call, not dictated by the request — flagged in Section 7.a.*

### 1.2 Markup change (concrete, for the Builder)

Inside `<ul class="nav-list">`, replace the flat list of `<li>` buttons with grouped
sub-lists, each preceded by a non-interactive heading. Exact structure:

```html
<ul class="nav-list">
  <li class="nav-group">
    <p class="nav-group-label">Library</p>
    <ul class="nav-group-items">
      <li><button type="button" class="nav-item" data-tab="books">…Books</button></li>
      <li><button type="button" class="nav-item" data-tab="recipes">…Recipes</button></li>
    </ul>
  </li>
  <li class="nav-group">
    <p class="nav-group-label">Personal</p>
    <ul class="nav-group-items">
      <li><button type="button" class="nav-item" data-tab="todo">…To-Do</button></li>
      <li><button type="button" class="nav-item" data-tab="shopping">…Shopping List</button></li>
      <li><button type="button" class="nav-item" data-tab="notes">…Notes</button></li>
    </ul>
  </li>
  <li class="nav-group">
    <p class="nav-group-label">Health</p>
    <ul class="nav-group-items">
      <li><button type="button" class="nav-item" data-tab="medications">…Medications</button></li>
      <li><button type="button" class="nav-item" data-tab="diagnoses">…Diagnoses</button></li>
    </ul>
  </li>
  <li class="nav-group">
    <p class="nav-group-label">Career &amp; Academics</p>
    <ul class="nav-group-items">
      <li><button type="button" class="nav-item" data-tab="resume">…Resume &amp; Portfolio</button></li>
      <li><button type="button" class="nav-item" data-tab="coursework">…Degree &amp; Coursework</button></li>
    </ul>
  </li>
</ul>
```

Every `.nav-item` button keeps its existing `data-tab` attribute and click handler
wiring — grouping is a **DOM nesting/CSS change only**. `document.querySelectorAll('.nav-item')`
still selects all nine buttons regardless of the new wrapper `<li>`/`<ul>` structure, so
`setActiveTab()`'s existing `querySelectorAll('.nav-item')` loop in `app.js` requires
**no change**. The `TABS` array must be extended to all nine slugs (Section 1.3).

`data-tab` slugs (new): `todo`, `shopping`, `notes`, `resume`, `coursework`. These are
the exact strings to use for `${tab}-collection` section IDs, `nav-item[data-tab="…"]`
matching, and the `TABS` array — chosen to be short and match the storage-key stems in
1.3 below (mostly; see note on `resume`/`coursework` naming in 1.3).

### 1.3 Storage keys (extends the existing table)

| Collection | localStorage key | `data-tab` slug |
|---|---|---|
| Books (unchanged) | `secondMemory.books.v1` | `books` |
| Recipes (unchanged) | `secondMemory.recipes.v1` | `recipes` |
| Medications (unchanged) | `secondMemory.medications.v1` | `medications` |
| Diagnoses (unchanged) | `secondMemory.diagnoses.v1` | `diagnoses` |
| To-Do | `secondMemory.todos.v1` | `todo` |
| Shopping List | `secondMemory.shoppingList.v1` | `shopping` |
| Notes | `secondMemory.notes.v1` | `notes` |
| Resume & Portfolio | `secondMemory.links.v1` | `resume` |
| Degree & Coursework | `secondMemory.courses.v1` | `coursework` |

Naming notes: the Resume & Portfolio storage key is `links` (plural, generic), not
`resumePortfolio`, because the underlying data shape is a generic list of labeled links
(Section 5) — the key should name the *shape*, matching how `books`/`recipes`/etc. name
collections of records, not the UI label. Similarly the Degree & Coursework key is
`courses` since the record-level unit is a course (Section 6) and there is no separate
"Degree" record in this spec (Section 6.1). The `TABS` array in `app.js` and the
`data-tab` attributes use the shorter UI-facing slugs (`resume`, `coursework`) since
those map to section IDs/nav buttons, not storage.

`TABS` in `app.js` becomes:
```js
const TABS = ['books', 'recipes', 'medications', 'diagnoses', 'todo', 'shopping', 'notes', 'resume', 'coursework'];
```

### 1.4 Active-tab persistence (unchanged mechanism)

`secondMemory.ui.v1`'s `activeTab` field already accepts any string; no schema change
needed there. Default fallback (`'books'` if the stored tab isn't in `TABS`) is
unchanged and still valid since `'books'` remains in the expanded `TABS` array.

### 1.5 CSS landmine carried forward

Per the standing constraint in `DECISIONS.md`, any new layout rule for `.nav-group` /
`.nav-group-items` must not fight the existing `[hidden]` attribute pattern used
elsewhere, and any override for group-specific styling must match or exceed the
specificity of whatever base `.nav-list`/`.nav-item` rule it touches (the same
class-of-bug that hit `.add-form-stacked` last cycle). Flagging so Builder/Tester check
this proactively rather than finding it live.

---

## 2. To-Do schema

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes (system-generated) | via shared `makeId()` |
| `task` | string | **yes** | trimmed, non-empty (same validation as Books' `title`) |
| `completed` | boolean | **yes** | default `false` on creation |
| `dueDate` | string (ISO date, `YYYY-MM-DD`) or `null` | no | nullable, default `null` |
| `dateAdded` | string (ISO datetime) | **yes** (system-generated) | set once, never edited |

No `priority` field — see 2.1.

### 2.1 Priority field — default decision (see also Section 7.b)

**Default: omit a `priority` field in this cycle.** A personal to-do list of the kind
this app is built for (per `CLAUDE.md`'s "keep scope tight") is typically short enough
that manual ordering or the due date alone is sufficient signal; adding a
`priority: 'low' | 'medium' | 'high'` enum introduces a field with no requested
behavior (no sort-by-priority UI was asked for, so the field would sit inert). If the
Architect wants priority-based sorting/grouping, that's a small additive change later
(new enum field + column layout, following the Diagnoses `status` precedent) — not
something to build speculatively now. *Flagged as the alternative in 7.b.*

### 2.2 Completed — visual state, not a section move (default decision)

**Default: completed items stay in the same list, struck through, not moved to a
separate section.** This mirrors the "flat list, no columns" precedent used for Recipes
(Section 2 of the prior spec) rather than the Books/Diagnoses column-per-status pattern,
because `completed` is a simple boolean toggle expected to be flipped frequently and
casually — moving an item to a different visual location every time it's checked adds
friction with no clear benefit for a short personal list. Completed items render with a
`completed` CSS class (strikethrough + muted color) but keep their position in the list
(sorted by `dateAdded`, unchanged by toggling).

Toggling `completed` (in either direction) does not affect `dueDate` or any other field
— no dependent-field side effects, same as Diagnoses' status transitions.

*Alternative flagged in 7.c: a two-section "Open" / "Completed" layout, closer to the
Medications current/former pattern, if the Architect prefers items to visibly leave the
active list once done.*

### 2.3 Search

Case-insensitive substring match against `task` only. `dueDate` (a raw ISO date string)
is excluded from search, consistent with the Medications/Diagnoses precedent of
excluding date fields from free-text search.

### 2.4 Edge cases

| Case | Behavior |
|---|---|
| Overdue item (`dueDate` in the past, `completed: false`) | No status field changes automatically — "overdue" is a **derived, display-only** condition (`dueDate < today && !completed`), computed at render time, never written back to the record. Rendered with a visual indicator (e.g. a warning-colored due-date label) but no separate "Overdue" section/column — see 2.2 rationale (avoid list-reorganization on every render/day). |
| No due date | `dueDate: null`. Valid, not an error. UI shows no due-date text (not "N/A" or similar clutter). |
| Empty list (first run) | Empty-state message, same pattern as existing collections' `#<tab>-empty-state` paragraph, e.g. "No to-dos yet — add your first one above." |
| Marking complete/incomplete | Toggles `completed` in place; no data loss, freely reversible in both directions (2.2). |
| Duplicate task text | Allowed, no uniqueness constraint — consistent with the no-dedupe precedent used by every existing collection (Books, Recipes, Medications all permit exact duplicates). |
| Very long task text | No length cap or truncation at the data layer; full string persisted, display may CSS-truncate (same as Recipes' long-instructions precedent). |

---

## 3. Shopping List schema

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes (system-generated) | |
| `item` | string | **yes** | trimmed, non-empty |
| `quantity` | string | no | free text, default `''` — see 3.1 |
| `checked` | boolean | **yes** | default `false` on creation |
| `category` | string | no | free text, default `''` — see 3.2 |
| `dateAdded` | string (ISO datetime) | **yes** (system-generated) | |

### 3.1 Quantity — free text, not a number (default decision)

**Default: free-text string**, not a numeric type. Real shopping items are frequently
not countable integers — "2 lbs," "a bunch," "1 gallon," "a few" are all valid and none
parse cleanly as a `number`. Forcing a numeric field would either reject these common
real-world inputs or require a separate `unit` field (over-engineering for a personal
shopping list, per `CLAUDE.md`). Empty string is valid and means "no quantity specified
— just need one/some."

### 3.2 Category — free text, matching Recipes precedent (default decision)

**Default: single optional free-text string**, exactly mirroring the Recipes `category`
decision (prior spec, Section 2.1) rather than a fixed enum of aisles/departments. A
fixed enum (`produce`/`dairy`/`etc.`) would need to enumerate every possible category
up front and doesn't accommodate a user's own store's layout or naming. Empty category
(`''`) is valid and means "uncategorized" — same convention as Recipes.

### 3.3 Checked items — stay in list, struck through (default decision, see 7.d)

**Default: checked items remain in the same list, visually struck through**, not moved
to a separate "purchased" section — same reasoning as To-Do's `completed` state (2.2):
checking an item off is expected to happen rapidly and repeatedly while walking through
a store, and relocating the DOM node on every check adds friction (and risk of
mis-tapping an adjacent item as the list reflows) with no clear benefit. Sort order is
by `dateAdded`, unaffected by `checked`.

*Alternative flagged in 7.d: some shopping-list apps group checked items into a
collapsed "purchased" section at the bottom, which reduces visual clutter on a long
list. Worth confirming since a shopping list is more actively scanned mid-task (in a
store, on a phone) than a to-do list is.*

### 3.4 Bulk "clear all checked" action — default decision (see 7.e)

**Default: no bulk-clear action in this cycle.** Per `CLAUDE.md`'s "keep scope tight,"
a "Clear checked items" button is a real, reasonable feature (this list is meant to be
emptied out after a shopping trip) but wasn't explicitly requested, and deleting still
requires only the existing per-item delete button (consistent with every other
collection's per-item-only delete pattern — none of the four existing collections have a
bulk action either). *Flagged in 7.e as a likely near-term follow-up given the natural
"empty the cart after shopping" use case, but not built speculatively now.*

### 3.5 Search

Case-insensitive substring match against `item` and `category`. `quantity` is included
in search scope (unlike dates, quantity is free text a user might plausibly search for,
e.g. "gallon") — matches the "search everything free-text" precedent from Recipes.

### 3.6 Edge cases

| Case | Behavior |
|---|---|
| Checked item | Stays in list, struck through (3.3); `checked: true` persists across reload. |
| Clearing all checked at once | Not built this cycle (3.4) — use per-item delete. |
| No quantity | `quantity: ''`. Valid; UI shows no quantity text. |
| No category | `category: ''`. Valid; flat list (no columns), same as Recipes. |
| Empty list (first run) | Empty-state message, e.g. "Your shopping list is empty — add an item above." |
| Duplicate item names | Allowed (e.g. "milk" added twice for two separate trips or because the first was already checked) — no dedupe, consistent with app-wide precedent. |
| Very long item name | No cap at the data layer; display may truncate visually. |

---

## 4. Notes schema

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes (system-generated) | |
| `title` | string | no | free text, default `''` — see 4.1 |
| `body` | string | no* | freeform plain text, default `''` — see 4.1, 4.2 |
| `dateAdded` | string (ISO datetime) | **yes** (system-generated) | set once, never edited |
| `dateModified` | string (ISO datetime) | **yes** (system-generated) | see 4.3 |

\* At least one of `title`/`body` must be non-empty after trimming to save the note (a
completely blank note is rejected — see 4.4's edge case), but neither field individually
is required.

### 4.1 Title optional, body freeform plain text (default decision)

**Default: `title` is optional.** The request explicitly notes "some notes are just a
paragraph with no natural title" — forcing a required title would mean either rejecting
that valid use case or auto-generating a title (e.g. from the first line of `body`),
which is an extra behavior not asked for. Default: `title: ''` is valid; when empty, the
UI displays the note using a truncated snippet of `body` as its list-view label instead
of a title.

**Default: `body` is plain text (a `<textarea>`, single string field)**, not any
lightweight structured format (no markdown rendering, no rich-text/contentEditable).
Per the instruction to avoid a rich-text editor and `CLAUDE.md`'s scope discipline, a
freeform string stored and displayed as-is (with line breaks preserved via CSS
`white-space: pre-wrap`, not by parsing markup) is the correct level of complexity.

### 4.2 Structure within `body` — none

No sub-structure (no checklist-inside-a-note, no embedded tags parsed out of the text).
If the user types `- item` or `#tag` in the body, it is stored and displayed as literal
text, not parsed. This is a deliberate simplicity choice, not an oversight — flag if
wrong in 7.f.

### 4.3 `dateModified` — new field, distinct from `dateAdded` (default decision, see 7.g)

**Default: yes, add a `dateModified` field**, updated every time a note's `title` or
`body` is edited and saved. This is a departure from every other collection in the app
(none of Books/Recipes/Medications/Diagnoses/To-Do/Shopping track a last-edited
timestamp) — justified specifically for Notes because editing an existing note's text
body (as opposed to toggling a status enum or a boolean) is the note collection's
*primary* interaction, and "when did I last touch this" is meaningfully useful for a
freeform text collection in a way it isn't for e.g. a book's status field. `dateAdded`
remains fixed at creation and is never touched by edits, exactly like every other
collection's `dateAdded` semantics.

On creation, `dateModified` is set equal to `dateAdded`. It updates only on an explicit
save of an edit to `title` or `body` — not on every render, not on merely opening a note
to view it.

*Flagged in 7.g since this is a new field shape (a second timestamp) not seen elsewhere
in the app — confirm the Architect wants this asymmetry rather than Notes matching the
other collections' single-timestamp convention exactly.*

### 4.4 Search scope

Case-insensitive substring match against **both** `title` and `body`. Rationale
(matching the Recipes "match everything, dataset is small" precedent): a user
remembering a phrase from inside a note's body but not its title (or vice versa) is the
primary reason search exists on a Notes collection at all.

### 4.5 Edge cases

| Case | Behavior |
|---|---|
| Empty `title`, non-empty `body` | Valid (4.1). List-view label falls back to a truncated `body` snippet. |
| Empty `body`, non-empty `title` | Valid — a bare heading/reminder with no elaboration is a legitimate note. |
| Both `title` and `body` empty after trim | **Rejected at save time** — same "guard before writing to the array" pattern as Books' empty-title rejection. A completely blank note has nothing to display or search and provides no value. |
| Very long note body | No length cap or truncation at the data layer; full string persisted. List view may show a truncated preview (e.g. first ~150 characters via CSS line-clamp or JS substring), full text always available in a detail/edit view. |
| Search scope | `title` + `body`, both (4.4). |
| Editing a note | Updates `body`/`title` in place and refreshes `dateModified` (4.3); `dateAdded` untouched. |
| Duplicate titles | Allowed, no uniqueness constraint (app-wide precedent). |

---

## 5. Resume & Portfolio schema

### 5.1 Shape: free-form list of links, not fixed slots (default decision, see 7.h)

**Default: a free-form list of arbitrary `{label, url, notes}` records**, not a fixed
set of named slots (e.g. hardcoded "Resume" / "Portfolio" / "LinkedIn" fields on a
single record). A fixed-slot model would need to anticipate every link type the user
might want up front and would treat "add a second portfolio link" or "add a GitHub
profile" as an unsupported case unless every conceivable slot were pre-declared. A
free-form list is consistent with how every other collection in this app works (an
open-ended array of independent records, per `CLAUDE.md`'s general pattern) and directly
supports the request's own example list ("Resume," "Portfolio," "GitHub," "LinkedIn" —
already four distinct items, suggesting the set isn't meant to be fixed at two).

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes (system-generated) | |
| `label` | string | **yes** | trimmed, non-empty (e.g. "Resume", "Portfolio", "GitHub") |
| `url` | string | **yes** | trimmed, non-empty — see 5.2 for validation rule |
| `notes` | string | no | free text, default `''` (e.g. "updated Sept 2026") |
| `dateAdded` | string (ISO datetime) | **yes** (system-generated) | |

No `dateModified` here — unlike Notes (4.3), editing a link's URL is an infrequent
correction, not the collection's primary ongoing interaction; adding it would be
inconsistent scope creep for this specific collection. (Contrast intentionally drawn
against 4.3's reasoning, not a contradiction — the two collections have different usage
patterns.)

### 5.2 URL validation — accept as entered, no rejection or auto-correction (default decision, see 7.i)

**Default: accept the `url` field as entered, with no format validation, rejection, or
auto-correction** (e.g. not silently prepending `https://` if missing). Justification:
- **Auto-correcting** (silently prepending a scheme) is a hidden mutation of what the
  user typed — if they intended something unusual, silent rewriting could produce a
  broken link with no visible indication anything changed.
- **Rejecting** malformed URLs requires picking a validation rule (must have a scheme?
  must have a valid TLD? must resolve?) that inevitably rejects some legitimate edge
  case for a low-stakes personal tool (e.g. a `mailto:`, an internal-network URL, or a
  URL missing `https://` that the user will fix themselves), for no real benefit — this
  isn't a shared/public form.
- **Rendering**: when displaying the link as a clickable `<a href>`, if `url` has no
  recognizable scheme (`doesn't match /^[a-z][a-z0-9+.-]*:/i`), the render layer
  (display concern, not data concern) prepends `https://` **only for the `href`
  attribute**, leaving the stored `url` value and the displayed link text unchanged.
  This makes "example.com" clickable without silently rewriting the user's stored data.

*Flagged in 7.i: this is a judgment call favoring "accept low-friction personal input"
over "guard against malformed data." Confirm this is the right trade-off, or whether
save-time rejection of unparseable strings is preferred instead.*

### 5.3 Duplicate labels — allowed (no special handling)

Allowed, no uniqueness constraint — consistent with the app-wide no-dedupe precedent
(e.g. two "Portfolio" entries pointing to two different sites, such as a design
portfolio and a code portfolio, is a legitimate real case). No special disambiguation
UI is added for this cycle.

### 5.4 Search

Case-insensitive substring match against `label`, `url`, and `notes`.

### 5.5 Edge cases

| Case | Behavior |
|---|---|
| Malformed/schemeless URL (e.g. `"example.com"`) | Accepted as entered (5.2); `https://` prepended only in the rendered `href`, stored value untouched. |
| Empty list (first run) | Empty-state message, e.g. "No links yet — add your resume, portfolio, or other professional links above." |
| Duplicate labels | Allowed (5.3). |
| Empty `url` | **Rejected at save time** — a link record with no destination has no purpose; same "guard before writing" pattern as required-field validation elsewhere. `label` alone is not sufficient to save a record. |
| Empty `label` | **Rejected at save time** — mirrors Books' required-`title` treatment; an unlabeled link gives the user no way to identify it in a list. |

---

## 6. Degree & Coursework schema

### 6.1 Decision: one `courses` collection with a `status` enum — no separate Degree record

**Default: a single flat `courses` collection**, each record carrying its own `status`
enum (`completed` | `in_progress` | `planned`), directly mirroring the Diagnoses
three-value status-enum pattern already implemented in this app (prior spec Section
4.1) rather than introducing a separate top-level "Degree" record (degree name,
institution, total credits required) that individual course records would reference.

Justification, per `CLAUDE.md`'s explicit "keep scope tight" instruction and the task's
own steer toward the simpler option absent a real reason not to:
- The request describes **three states of courses**, not a request to track multiple
  degree programs, institutions, or a formal total-credit requirement. A "Degree" parent
  record is a plausible *future* extension but isn't what was asked for.
- A parent/child (Degree → Courses) shape would be the first relational structure in
  the entire app — every existing collection (Books, Recipes, Medications, Diagnoses)
  is a flat, independent list of records with no foreign-key-style references between
  collections or within one, per the explicit "no relational fields in this cycle"
  precedent already flagged and accepted in the prior spec (Section 6.b of
  `multi-tab-tracker.md`). Introducing one now for Degree & Coursework, without a
  specific request to track multiple degrees or compute progress against a formal
  credit requirement, would be new complexity added speculatively.
- If the user later wants to track credits-remaining-to-graduate against a specific
  program's total requirement, or track two degrees at once, that's a real, addable
  extension (a `degrees` collection + a `degreeId` foreign key on `courses`) — but it
  should be built when actually requested, not guessed at now.

*This is an explicit call, not a default buried in a field table — flagged in 7.j in
case the Architect anticipated the parent-record shape from the start (e.g. because a
"percent complete toward degree" view was an implicit expectation).*

### 6.2 Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes (system-generated) | |
| `title` | string | **yes** | trimmed, non-empty — course name (e.g. "Intro to Statistics") |
| `code` | string | no | free text, default `''` (e.g. "STAT 101") |
| `credits` | number or `null` | no | default `null` — see 6.3 |
| `term` | string | no | free text, default `''` — see 6.4 |
| `status` | enum: `completed` \| `in_progress` \| `planned` | **yes** | default `planned` on creation — see 6.5 |
| `grade` | string or `null` | no | default `null`; **only meaningful when `status === 'completed'`** — see 6.6 |
| `notes` | string | no | free text, default `''` |
| `dateAdded` | string (ISO datetime) | **yes** (system-generated) | |

### 6.3 Credits — nullable number

`credits` is a `number` (not a string) since it's the one field here with genuine
arithmetic meaning (a future credit-total feature, if ever built, would need to sum
it) — but it's optional/nullable because not every course record needs it tracked (e.g.
a placeholder for a not-yet-scheduled requirement). No validation beyond "must be a
non-negative number if provided" (reject negative values at save time, same
guard-before-write pattern used elsewhere); no upper bound.

### 6.4 Term — free text, not structured year+season (default decision, see 7.k)

**Default: free text** (e.g. `"Fall 2024"`), not a structured `{year: number, season:
enum}` pair. Justification: a structured field adds validation complexity (What are
valid seasons — does the user's institution use quarters, trimesters, "Summer I/II"?)
for a field that's purely descriptive/display text in this cycle — nothing in the
request asks for chronological sorting or filtering by term. Empty string (`''`) is
valid and expected for planned courses with no scheduled term yet (6.7). *Flagged in
7.k: if term-based sorting or a semester-by-semester grouped view is wanted later, a
structured field would need to be introduced then — noting it now so it's not a
surprise migration.*

### 6.5 Status enum — exact meanings and default

- **`planned`** — not yet started; still needed to finish the degree. **Default value
  for a newly-added course**, since the natural first entry for "what's left" matches
  this state, and the request's own ordering (taken → currently enrolled → what's left)
  places "not yet done" as the residual/default case, mirroring how Diagnoses defaults
  to `active` (its most common real-world entry point).
- **`in_progress`** — currently enrolled, course is underway this term.
- **`completed`** — finished; grade (if any) is recorded and meaningful.

### 6.6 Grade — status-conditional field, mirrors Books' rating precedent

`grade` is a free-text string (not a numeric GPA field — no GPA calculation is in scope
per the task's explicit instruction), meaningful **only** when `status === 'completed'`.
This directly mirrors the Books `rating`-only-when-`owned_read` rule:

**Every transition of a course's `status` away from `completed`** (i.e. `completed →
in_progress` or `completed → planned`) **clears `grade` back to `null`**, exactly as
moving a book away from `owned_read` clears `rating`. Justification: a stale grade value
sitting on a course that's no longer marked `completed` (e.g. after a correction "I
actually need to retake this") is the same kind of desynced-field risk the Books rule
was designed to prevent — a `grade` visible on an `in_progress` or `planned` course would
be misleading.

Moving **into** `completed` (`in_progress → completed` or `planned → completed`) does
**not** auto-populate `grade` — it stays `null` until the user explicitly enters one
(a course can be marked completed before a grade is posted, e.g. finished the term but
grade not yet released).

### 6.7 Total-credits-progress display — out of scope this cycle (default decision, see 7.l)

**Default: no derived progress bar / credits-remaining calculation is built.** Per the
task's explicit steer ("lean toward not building a derived progress bar... since that's
a feature not explicitly requested") and `CLAUDE.md`'s scope discipline, and consistent
with 6.1's decision not to introduce a total-credits-required field at all (there is no
"total needed" number to compute progress against, since there's no Degree record to
hold it) — this is a natural consequence of 6.1, not an independent gap. If a future
cycle adds a Degree record with a total-credits target, a progress display becomes a
small additive feature at that point. *Flagged in 7.l as the natural first ask if the
Architect confirms 6.1's "no Degree record" call — worth deciding together.*

### 6.8 Search

Case-insensitive substring match against `title`, `code`, `term`, `grade`, and `notes`.
`credits` (a number) and `status` (filtered/grouped visually — see 6.9) are excluded
from free-text search, consistent with the app's precedent of excluding non-prose
fields.

### 6.9 Layout

Three columns by `status` (`planned` / `in_progress` / `completed`), directly mirroring
the Diagnoses three-column-by-status layout (prior spec Section 6.j), since `status` is
a fixed 3-value enum here too. Suggested column order left-to-right matches the natural
narrative: `completed` → `in_progress` → `planned` (taken, then current, then
remaining) — the mirror image of Diagnoses' order, but flagged as a display-only choice
the Architect/Builder can adjust freely without a spec change.

### 6.10 Edge cases

| Case | Behavior |
|---|---|
| Planned course with no term yet | `term: ''`. Valid — expected for courses that are known-needed but not yet scheduled. UI shows no term text rather than a placeholder like "TBD." |
| Moving a course between statuses | Freely bidirectional between all three values. `grade` clears to `null` on any transition **away from** `completed` (6.6); no other field is affected by any transition (`code`, `credits`, `term`, `notes` all persist unchanged, matching the Diagnoses no-side-effect precedent). |
| Grade entered, then status moved away from `completed` | `grade` is cleared per 6.6 — this discards the previously entered grade with no undo, exactly like Books discarding a rating on a status move. Not flagged as a gap since it's a direct, precedented pattern reuse, not a new ambiguity. |
| Total-credits-progress / percent-to-degree display | Not built this cycle (6.7). |
| Course with no credits value | `credits: null`. Valid; UI shows no credit count. |
| Negative credits entered | Rejected at save time (6.3). |
| Duplicate course entries (e.g. retaking a failed course) | **Allowed as two separate flat records** (e.g. one `completed` with a failing grade, one `in_progress` or `planned` for the retake) — directly analogous to the Diagnoses "recurring condition = two flat records" precedent (prior spec Section 4.4), for the same reason: no collection in this app models an episode-history sub-list on a single record. |
| Empty list (first run) | Empty-state message, e.g. "No courses yet — add one above." |

---

## 7. Flagged ambiguities — default call made for each, confirmation needed from Architect

These are genuine judgment calls made to unblock the Builder. None should be treated as
silently settled.

**a. Sidebar grouping: four groups (Library / Personal / Health / Career & Academics),
or a different split — or stay flat at nine?**
Default: four labeled groups as specified in Section 1.1, chosen because Books/Recipes
didn't fit cleanly into any group implied by the five new collections and forcing them
in would produce a lopsided grouping. *Confirm the group boundaries and labels — "Library"
in particular is the Analyst's own added category, not requested, and a different label
or a merge (e.g. folding Library into a renamed "Personal") is equally reasonable.*

**b. To-Do: no `priority` field, or add one?**
Default: omit (2.1) — no priority-based UI was requested and a personal to-do list this
size likely doesn't need it. *Confirm, or specify a `priority: 'low'|'medium'|'high'`
enum plus what UI behavior (sorting? a visual badge? both?) it should drive if added.*

**c. To-Do: completed items stay in place (struck through) vs. move to a separate
"Completed" section?**
Default: stay in place (2.2), matching the Recipes flat-list precedent and avoiding
list-reorganization friction on a frequent toggle action. *Confirm — a two-section
Open/Completed layout (closer to the Medications pattern) is a reasonable alternative if
the Architect wants completed items visually separated from the active list.*

**d. Shopping List: checked items stay in place (struck through) vs. move to a
"purchased" section?**
Default: stay in place (3.3), same reasoning as (c). *Confirm — a shopping list is
scanned more actively mid-task (in-store, on a phone) than a to-do list, so the
in-store-usability argument for a separate purchased section may be stronger here than
it is for To-Do; worth deciding these two independently rather than assuming they must
match.*

**e. Shopping List: is a bulk "clear all checked" action in scope this cycle?**
Default: no (3.4) — per-item delete only, consistent with every existing collection
having no bulk actions. *Flagging as a likely near-term follow-up given the natural
"empty the cart after a shopping trip" use case — confirm whether it should be pulled
into this cycle instead of deferred.*

**f. Notes: is any lightweight structure inside `body` wanted (e.g. markdown rendering,
a simple checklist), or is plain text correct?**
Default: plain text only, no parsing of any kind (4.2), per the explicit "no rich text
editor" instruction. *Confirm this fully covers intent — e.g. if the user specifically
wants to be able to put a checklist inside a note, that's a different (structured) body
type and a different UI, not covered by this default.*

**g. Notes: does `dateModified` (a second timestamp, unique to this collection) belong
in scope, or should Notes match every other collection's single-`dateAdded` convention?**
Default: add `dateModified` (4.3), justified by editing being Notes' primary ongoing
interaction (unlike a status toggle elsewhere in the app). *Confirm — this is a genuine
asymmetry versus every other collection in the app and the Architect may prefer
consistency over per-collection justification.*

**h. Resume & Portfolio: free-form list of links, vs. a small fixed set of named slots
(Resume/Portfolio/Other)?**
Default: free-form list (5.1), consistent with the rest of the app's flexible
independent-record pattern and the request's own four-item example list. *Confirm — if
the intent was specifically "exactly one resume link + one portfolio link" as a fixed
pair, that's a smaller, different shape (two optional URL fields on a single settings-
like record, not a collection at all).*

**i. Resume & Portfolio: accept malformed/schemeless URLs as-is (with a display-only
`https://` prepend), reject them at save time, or auto-correct the stored value?**
Default: accept as entered, display-only correction for the clickable `href` (5.2).
*Confirm this trade-off (favoring low-friction personal input) over stricter save-time
validation.*

**j. Degree & Coursework: one flat `courses` collection with a `status` enum, vs. a
separate parent "Degree" record (name, institution, total credits) referenced by
courses?**
Default: one flat collection, no Degree record (6.1) — the simpler option, per the
task's own steer and `CLAUDE.md`'s scope discipline, and because it avoids introducing
the app's first relational (parent/child) data shape. *Confirm this matches intent,
especially if a "percent toward degree completion" view was an implicit expectation —
that specific feature requires the Degree record this default omits (see 7.l).*

**k. Degree & Coursework: `term` as free text (e.g. "Fall 2024") vs. a structured
`{year, season}` pair?**
Default: free text (6.4), avoiding the need to define a fixed season enum that may not
match every institution's calendar (semesters vs. quarters vs. trimesters). *Confirm —
free text means no chronological sort-by-term is possible without also parsing the
string later.*

**l. Degree & Coursework: is a total-credits-required field and a derived
progress/percent-complete display wanted at all, even as a smaller near-term addition?**
Default: no (6.7), following directly from 6.1's "no Degree record" call and the task's
explicit steer against building a progress bar this cycle. *Confirm — if progress
tracking is actually a core motivation for this collection (not just an afterthought),
it should be scoped explicitly rather than deferred by default, since it changes both
6.1's data shape and this display decision together.*

---

## 8. Summary checklist for the Builder

- [ ] Extend `TABS` in `app.js` to all nine slugs (Section 1.3); no change needed to
      `setActiveTab()`'s `querySelectorAll('.nav-item')` logic since grouping is DOM
      nesting only.
- [ ] Restructure `<ul class="nav-list">` into four `.nav-group` blocks per Section 1.2
      exact markup, preserving every existing `data-tab` attribute and button unchanged.
- [ ] Five new independent `localStorage` keys per Section 1.3 table, five independent
      load/save/render functions using the existing shared `loadCollection()` /
      `saveCollection()` / `makeId()` helpers — no shared array, no cross-collection
      references (per the standing "no relational fields" constraint from
      `DECISIONS.md`).
- [ ] To-Do, Shopping List, Notes, Resume & Portfolio, Degree & Coursework schemas
      exactly as tabled in Sections 2–6, including which fields are nullable vs.
      defaulted vs. required vs. status-conditional.
- [ ] Degree & Coursework: clear `grade` to `null` on any status transition away from
      `completed` (6.6) — same guard pattern as Books' rating-clearing code.
- [ ] Resume & Portfolio: reject empty `label` or empty `url` at save time (5.5); accept
      `url` as entered with no rejection/auto-correction of the stored value, only a
      display-only `https://` prepend for the rendered `href` when no scheme is present
      (5.2).
- [ ] Notes: reject save when both `title` and `body` are empty after trim (4.5); set
      `dateModified = dateAdded` on creation and update `dateModified` only on an
      explicit edit-save (4.3).
- [ ] Apply the same `.collection[hidden] { display: none }` guard (already
      established) to all five new `<section class="collection" id="...">` panels; watch
      for the same `display`-vs-`[hidden]` and CSS-specificity landmine classes noted in
      `DECISIONS.md` when styling `.nav-group`/new form layouts (Section 1.5).
- [ ] Do **not** implement anything in Section 7 without Architect confirmation —
      defaults are there to unblock, not to finalize.
