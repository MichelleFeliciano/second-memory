# Spec: Multi-Tab Personal Tracker (Books, Recipes, Medications, Diagnoses)

Status: **Validated by Analyst, with flagged decisions the Architect must confirm before
Builder starts** (see Section 6). Everything else in this document is safe to build
against as-is.

Reference source read for this spec: `CLAUDE.md`, `DECISIONS.md`, `app.js`, `index.html`.

---

## 1. Overall structure

### 1.1 Shell
- One HTML page (`index.html`), one `app.js` (or split into per-collection files loaded
  via plain `<script>` tags — no build step either way, per `CLAUDE.md`'s hard
  constraints). A tab bar with four tab buttons: **Books**, **Recipes**, **Medications**,
  **Diagnoses**.
- Each collection lives in its own `<section class="collection" id="...">`, all present
  in the DOM at once. "Switching tabs" toggles the `hidden` attribute: the active
  section has `hidden` removed, the other three have it set. This mirrors the existing
  `hidden`-attribute pattern already used for `#empty-state` and `.rating-label`.
- **Known landmine (from `DECISIONS.md`):** a prior bug had `.rating-label { display:
  flex }` silently overriding the `hidden` attribute. Whatever CSS rule governs
  `.collection` display (e.g. `display: grid`/`flex` for layout) **must** include a
  `.collection[hidden] { display: none; }` override, or all four tabs will render
  simultaneously. Flagging this explicitly so the Builder doesn't reintroduce the same
  bug class.
- Each collection keeps **fully independent** in-memory state (its own array) and its
  own `localStorage` key. There is no shared array, no shared render() — one render
  function per collection, each reading/writing only its own key. Switching tabs does
  not reload or re-fetch anything; all four collections' in-memory state is loaded once
  at page load (same as Books does today via `let books = loadBooks();` at module load
  time), and only the active tab's DOM is visible.

### 1.2 Storage keys (follow existing `secondMemory.<name>.v1` convention)
| Collection | localStorage key |
|---|---|
| Books (unchanged) | `secondMemory.books.v1` |
| Recipes | `secondMemory.recipes.v1` |
| Medications | `secondMemory.medications.v1` |
| Diagnoses | `secondMemory.diagnoses.v1` |

### 1.3 Required DOM refactor for Books (structure only, not data/behavior)
Today's `index.html`/`app.js` use **unqualified, page-global IDs** because there is only
one collection: `search-input`, `add-book-form`, `title-input`, `author-input`,
`status-input`, `empty-state`. Once three more collections are added, each needs its own
search box, its own add-form, its own empty-state message — so these IDs must be
**namespaced per collection** (e.g. `books-search-input`, `books-empty-state`,
`recipes-search-input`, `recipes-empty-state`, etc.) to avoid duplicate-ID collisions,
and every `document.getElementById(...)` call in `app.js` that currently uses the bare
name must be updated to the namespaced Books ID. This is a required **ID/structure**
change, not a data-model or behavior change — Books' statuses, transitions, and rating
rule are untouched.

### 1.4 Shared helpers
`makeId()` (uuid-or-fallback) and the general shape of `loadX()`/`saveX()` (try/parse,
fall back to `[]` on any error, `Array.isArray` guard) should be written once and reused
by all four collections rather than copy-pasted four times with drift risk. This is an
implementation note for the Builder, not a data-model requirement.

---

## 2. Recipes schema

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes (system-generated) | via shared `makeId()` |
| `title` | string | **yes** | trimmed, non-empty (identical validation to Books' title: reject/no-op on empty after trim) |
| `category` | string | no | free text, default `''` — see 2.1 |
| `ingredients` | string[] | no | default `[]`; each element trimmed, empty strings dropped — see 2.2 |
| `steps` | string[] | no | default `[]`; each element trimmed, empty strings dropped, one step per element — see 2.2 |
| `notes` | string | no | free text, default `''` |
| `dateAdded` | string (ISO datetime) | **yes** (system-generated) | set once at creation, never edited |

No `status` field — recipes have no workflow/lifecycle in this cycle.

### 2.1 Category (default decision — see also Section 6.c)
Single optional free-text string, not an enum and not a multi-value tag array. Empty
category (`''`) is valid and means "uncategorized."

### 2.2 Ingredients / steps as string arrays (default decision — see Section 6.d)
Both are stored as arrays of trimmed, non-empty strings (one ingredient or one step per
array element — e.g. produced by splitting a textarea on newlines at save time). An
empty array is valid for either field.

### 2.3 Search
Case-insensitive substring match (same `.toLowerCase().includes()` pattern as Books)
against the concatenation of: `title`, `category`, all of `ingredients`, all of `steps`,
and `notes`. Rationale: for a small personal recipe box, "find the recipe with
cinnamon in it" is more useful than a narrower match, and dataset size makes the
performance cost irrelevant.

### 2.4 Edge cases
| Case | Behavior |
|---|---|
| Empty ingredient list | Valid. Card/detail view shows "No ingredients listed" (or simply renders nothing for that section) rather than blocking save. |
| Very long instructions | No length cap or truncation at the **data** layer. Storage keeps the full string array as entered. List-view UI may visually truncate (e.g. CSS line-clamp) but that's a display concern, not a data concern — the full text must remain intact in `localStorage` and in any detail/edit view. |
| No category | Stored as `''`. Not treated as an error. See 6.j for how this affects list layout (flat list, not columns, since category is unbounded free text). |
| Duplicate recipe titles | **Allowed**, no uniqueness constraint — consistent with Books, which already permits duplicate title/author pairs (`addBook` has no dedupe check today). |

---

## 3. Medications schema

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes (system-generated) | |
| `name` | string | **yes** | trimmed, non-empty |
| `dosage` | string | no | free text (e.g. `"10mg"`, `"1 tablet"`) — not a structured amount+unit pair, per "don't over-engineer" |
| `frequency` | string | no | free text (e.g. `"twice daily"`, `"as needed"`) |
| `prescribingDoctor` | string | no | free text |
| `startDate` | string (ISO date, `YYYY-MM-DD`) or `null` | no | nullable — see 3.2 |
| `endDate` | string (ISO date, `YYYY-MM-DD`) or `null` | no | nullable — `null` means currently taking, see 3.1 |
| `notes` | string | no | free text |
| `dateAdded` | string (ISO datetime) | **yes** (system-generated) | record-creation metadata, distinct from `startDate` |

### 3.1 "Currently taking" vs "no longer taking" — decision
**Derived from `endDate === null`, not an explicit status field.**

Justification: this mirrors the pattern already established for Books (`rating` is
cleared automatically as a *consequence* of the `status` field rather than tracked
independently and risking desync). An explicit `status: 'current' | 'stopped'` field
alongside a nullable `endDate` creates two sources of truth that can contradict each
other (e.g. `status: 'stopped'` but `endDate: null`). Deriving `isCurrent = endDate ===
null` at render time makes that contradiction structurally impossible.

Trade-off flagged in Section 6.e: this only supports a binary current/stopped state. If
a future cycle needs a "paused, may resume" state distinct from both, that can't be
represented by a nullable date alone and would require revisiting this decision.

UI grouping: display medications in two derived groups — "Currently Taking"
(`endDate === null`) and "No Longer Taking" (`endDate !== null`) — mirroring Books'
column pattern, since it directly answers the current/former distinction.

### 3.2 Validation rules
- `startDate` may be left empty/`null` at any time — no requirement to backfill it.
- If **both** `startDate` and `endDate` are present, `endDate` must not be before
  `startDate`. The add/edit form must reject the save with an inline validation error
  in this case (same "guard before writing to the array" pattern `addBook` uses for
  empty titles) rather than silently accepting an inconsistent record or silently
  swapping the two dates.
- If only one of the two dates is present, no comparison is possible or required —
  valid as entered (e.g. "I stopped taking this" with no recorded start date is a valid
  record, not an error).

### 3.3 Edge cases
| Case | Behavior |
|---|---|
| No start date entered | `startDate: null`. Valid. Does not affect the currently-taking determination (that's based on `endDate` alone). UI shows "start date unknown." |
| End date before start date | Rejected at save time per 3.2 — inline validation error, record not written. |
| Resuming a stopped medication | Handled by **editing** the existing record's `endDate` back to `null` (default decision — see Section 6.g). This reactivates the record but discards the previous stop date; there is no history of past start/stop cycles for the same medication in this schema. If the user wants to preserve that history, they should add a **new** entry rather than edit the old one. **This is flagged as a real gap, not silently resolved** — see 6.g. |
| Duplicate medication names | **Allowed**, no uniqueness constraint (e.g. the same drug at two different times/dosages is a legitimate real-world case — "Metformin AM" and "Metformin PM" as separate entries, or literally the same name twice). Consistent with Books' no-dedupe precedent. |

### 3.4 Search
Case-insensitive substring match against `name`, `dosage`, `frequency`,
`prescribingDoctor`, and `notes`. Dates are excluded from search (matching on a raw ISO
date string like `2024-03-01` against free-text search input has low value).

---

## 4. Diagnoses schema

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes (system-generated) | |
| `condition` | string | **yes** | trimmed, non-empty — the name of the condition |
| `dateDiagnosed` | string (ISO date, `YYYY-MM-DD`) or `null` | no | nullable — see 4.2 |
| `provider` | string | no | free text (diagnosing doctor/clinic) |
| `status` | enum: `active` \| `monitoring` \| `resolved` | **yes** | default `active` on creation — see 4.1 |
| `notes` | string | no | free text |
| `dateAdded` | string (ISO datetime) | **yes** (system-generated) | record-creation metadata, distinct from `dateDiagnosed` |

### 4.1 Status enum — exact meanings
- **`active`** — currently applies and is being actively managed/treated. Default value
  for a newly-added diagnosis.
- **`monitoring`** — not currently being actively treated, but being watched/observed
  (e.g. "borderline," "watchful waiting," a condition that hasn't required intervention
  yet but is tracked).
- **`resolved`** — no longer applies (cured, resolved, or no longer relevant to track as
  ongoing).

### 4.2 Transitions
All six transitions between the three statuses are freely allowed in both directions
(`active ↔ monitoring ↔ resolved`, plus `active ↔ resolved` directly). Unlike Books'
`rating`, **there is no dependent field to clear on any Diagnoses status transition** —
`dateDiagnosed`, `provider`, and `notes` are all independent of `status` and persist
unchanged through any transition. No confirmation dialog or data loss occurs on any
transition.

### 4.3 Unknown/approximate diagnosis date (default decision — see Section 6.h)
`dateDiagnosed` is a nullable **exact** ISO date. A plain `<input type="date">` cannot
represent a partial/approximate date (e.g. "sometime in 2019"). Default: when the exact
date is unknown, leave `dateDiagnosed: null` and record the approximation as free text
in `notes` (e.g. `"around 2019"`). This is a UI-input-type constraint, not an arbitrary
choice — flagged in 6.h in case the Architect wants a dedicated approximate-date field
instead.

### 4.4 Duplicate/recurring conditions (default decision — see Section 6.i)
A recurring diagnosis (e.g. strep throat diagnosed twice, years apart; a cancer that
returns after remission) is modeled as **two independent flat records**, each with its
own `id`, `dateDiagnosed`, and `status` — not as one record with a nested history of
episodes. This is consistent with the flat, independent-record pattern used everywhere
else in the app (no collection in this spec has a parent/child or history sub-list).
Flagged in 6.i because a "one condition + episode history" model is a legitimately
different, larger data shape that wasn't asked for and shouldn't be assumed.

### 4.5 Edge cases
| Case | Behavior |
|---|---|
| Unknown/approximate diagnosis date | `dateDiagnosed: null` + approximation noted in `notes` (4.3). |
| Status transitions | Freely bidirectional, no dependent-field side effects (4.2). |
| Duplicate condition entries / recurring diagnosis | Allowed as separate flat records (4.4). |

### 4.6 Search
Case-insensitive substring match against `condition`, `provider`, and `notes`. `status`
is not part of free-text search (it's filtered/grouped visually instead — see 6.j).

---

## 5. Books (unchanged — documented here only for shell-integration reference)

No schema or behavior changes. Restated for completeness since the Builder is touching
the surrounding shell:
- Fields: `id`, `title` (required, non-empty after trim), `author` (**optional** — no
  `required` attribute on the input today, stored as `''` if blank), `status` (enum:
  `want_to_buy` \| `owned_unread` \| `owned_read`), `rating` (integer 1–5 or `null`,
  **only meaningful when `status === 'owned_read'`**; every transition away from
  `owned_read` clears it to `null` — standing constraint from `DECISIONS.md`),
  `dateAdded` (ISO datetime, system-generated).
- Search matches `title` + `author` only (unchanged).
- The three statuses remain mutually exclusive (a book has exactly one `status` value at
  all times); this spec introduces no changes to that invariant.

---

## 6. Flagged ambiguities — default call made for each, confirmation needed from Architect

These are genuine gaps in the request. Each has a reasonable default so the Builder
isn't blocked, but none should be treated as silently settled.

**a. Does the active tab persist across reloads?**
Not requested either way. Default: yes — persist the last-active tab in a new small UI
state key, `secondMemory.ui.v1` (e.g. `{ "activeTab": "recipes" }`), separate from the
four collection keys since it's not collection data. If rejected, the simpler fallback
is "always open on the Books tab." *Confirm which behavior is wanted.*

**b. Do Medications/Diagnoses link to each other (e.g. "this medication treats that
diagnosis")?** Not requested. Default: **no relational fields in this cycle** — all four
collections are fully independent, per `CLAUDE.md`'s "keep scope tight" constraint.
*Flagging in case linking was an implicit expectation; treat as a separate future cycle
if so, since it changes the data shape (would need a foreign-key-style reference field).*

**c. Recipes `category`: single free-text string vs. multi-value tags?**
Default: single optional free-text string (2.1). *Confirm if a tag array (multiple
categories per recipe) was actually intended — that's a different field type
(`string[]`) and a different search/filter UI.*

**d. Recipes `ingredients`/`steps`: array of strings vs. one big text blob?**
Default: array of strings for both, one item per line (2.2), chosen for consistency and
because arrays make future per-item features (e.g. checking off ingredients) possible
without a migration. *Confirm — a single freeform textarea per field is simpler to build
and may be all that's wanted for v1.*

**e. Medications current/former state: derived from nullable `endDate` vs. explicit
`status` field?** Default: derived (3.1), justified above. *Flagging the trade-off: this
cannot represent a "paused, may resume" state. If that's needed later, this is a
breaking schema change (would need to add an explicit status enum), not an additive one
— worth deciding now if "paused" is foreseeable.*

**f. Medications: reject `endDate < startDate`, or allow it?**
Default: **reject** at save time with inline validation (3.2). *This is the
Analyst's judgment call in favor of correctness per the project's "accuracy gate"
mandate; confirm the Architect agrees rejection (vs. silently accepting inconsistent
personal data, which is lower-friction but allows garbage-in) is the right trade-off for
a low-stakes personal tool.*

**g. Medications: is "resuming" an edit to the existing record, or a new record?**
Default: edit-in-place, discarding the prior stop date (3.3). **This is flagged as a
real, unresolved gap**, not just a default: the schema as specified has no way to
recover "I took this from Jan–March, then again from Sept–Dec" as two distinct courses
once the edit overwrites the first `endDate`. If medication history matters, this needs
either (1) a `history: {startDate, endDate}[]` sub-array per medication, or (2) explicit
guidance that users should create a new entry for a new course. *Architect should decide
before Builder implements the "resume" interaction, since it determines whether an
edit form even has an "resume" action or whether that's just "add a new medication."*

**h. Diagnoses: unknown/approximate date — overload `notes`, or add a dedicated field?**
Default: overload `notes` (4.3), driven by `<input type="date">`'s inability to store
partial dates. *Confirm — a dedicated `approximateDate: string` free-text field (kept
separate from `notes`) is a small addition if the Architect wants unknown dates to be
searchable/sortable independently of general notes.*

**i. Diagnoses: recurring condition as two flat records, or one record with episode
history?** Default: two flat records (4.4). *Confirm this matches intent — if the user
actually wants "Strep Throat" as a single entity with a list of past episodes, that's a
different (nested) data shape, analogous to gap (g) above for Medications.*

**j. Do Recipes/Medications/Diagnoses get a column-based layout like Books' three
columns?** Default, per collection:
  - **Recipes**: flat list, no columns (category is unbounded free text, so a fixed set
    of columns isn't possible the way it is for Books' 3-value enum).
  - **Medications**: two derived groups, "Currently Taking" / "No Longer Taking" (from
    `endDate`), mirroring Books' column pattern since the current/former split is
    binary and derived, not free text.
  - **Diagnoses**: three columns by `status` (`active` / `monitoring` / `resolved`),
    directly mirroring Books' column-per-enum-value layout since `status` is a fixed
    3-value enum here too.
  *This is a UI-structure default, not just a data-model one — confirm before the
  Builder commits to specific HTML structure per tab, since columns vs. flat list
  changes the markup shape significantly.*

---

## 7. Summary checklist for the Builder

- [ ] Namespace all Books DOM IDs (Section 1.3) before adding the other three tabs.
- [ ] One `.collection[hidden] { display: none }` CSS rule guarding all four tab panels
      (Section 1.1) — verify in-browser exactly like the DECISIONS.md fix did for
      `.rating-label`.
- [ ] Four independent `localStorage` keys per Section 1.2, four independent
      load/save/render functions, no shared array.
- [ ] Recipes, Medications, Diagnoses schemas exactly as tabled in Sections 2–4,
      including which fields are nullable vs. defaulted vs. required.
- [ ] Medications save-time validation: reject `endDate < startDate` when both present
      (3.2/6.f).
- [ ] Do **not** implement anything in Section 6 without Architect confirmation —
      defaults are there to unblock, not to finalize.
