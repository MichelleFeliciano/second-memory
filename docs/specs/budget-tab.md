# Spec: Budget tab — rolling 5-week bill calendar

Validated against `docs/research/budget-calendar.md` (facts/recommendations — not
re-derived here), `app.js` (existing conventions: `SYNC_COLLECTIONS`, the undo/redo
engine, the generic `.X-view`/`.X-edit-form` edit pattern, `isTodoOverdue()`/
`renderBooksStats()` precedents), `index.html` (nav-group structure, template/markup
conventions), and `DECISIONS.md` (project history). Five Architect decisions on the
research brief's open questions are treated as settled per the dispatch message and are
not reopened here (yearly frequency included; manual number is untotaled/unvalidated
free-form; bill-edit-after-paid is allowed with silent orphaning; all three suggested
additions approved; Bills is a full 10th citizen of the generic collection
infrastructure).

---

## 1. Data shape

### 1.1 Bill record

Storage key: `secondMemory.bills.v1`. Module-level array: `bills`.

```
{
  id: string,                // makeId()
  name: string,               // required, trimmed, non-empty
  amount: number,             // required, > 0 (Number, not a string)
  dueDate: string,            // required, 'YYYY-MM-DD' — the anchor/first occurrence
  frequency: string,          // one of BILL_FREQUENCIES (see below), required
  category: string,           // optional, trimmed, '' if none — free text, chip-filterable
  paidDates: string[],        // 'YYYY-MM-DD' occurrence dates marked paid, for THIS bill only
  dateAdded: string,          // ISO timestamp, standard
  updatedAt: string,          // ISO timestamp, standard
  deviceId: string,           // standard
  deleted: boolean,           // standard, tombstone convention
  version: number,            // standard, server-assigned, starts at 0
}
```

```
const BILL_FREQUENCIES = ['one_time', 'weekly', 'biweekly', 'monthly', 'yearly'];
```

**`one_time` is a required 5th frequency value**, not an afterthought bolted onto the
recurring ones. The user's own list ("this bill is monthly and this one is biweekly,
etc.") implies recurring bills, but a real bill list needs one-off entries (a single
medical bill, a one-time fee) — leaving this out would force the user to fake it with a
`weekly`/`monthly` bill they have to remember to delete after one payment, which is
worse than just supporting it. A `one_time` bill occurs exactly once, on `dueDate`,
and never recurs (see §2).

**`paidDates` is an array on the bill record, not a separate global map keyed by
`billId+date`.** This matches the research brief's recommendation in spirit (a
composite `billId + date` key identifies a paid occurrence) while keeping the
implementation simpler: since `paidDates` already lives *on* the bill record, the
`billId` half of the composite key is implicit (it's whichever bill's array you're
looking at), and the `date` half is the array entry itself. No separate collection or
map is needed. This also means `paidDates` participates automatically in the existing
undo/redo engine's generic `Object.keys(snapshot).forEach(...)` copy in
`applyEntrySnapshot()` with zero special-casing, since it's just another field on the
record (see §7).

**Amount validation:** required, must parse to a finite number `> 0`. Bills with a
$0 or negative amount are rejected with a form error (matching the `addMedication`/
`updateMedication` `{ ok, error }` return-value convention, not the simpler
`addBook`-style silent-no-op-on-invalid-input convention) — amount feeds directly into
arithmetic totals, so silently accepting garbage here is worse than for a text field.

### 1.2 Per-day manual number — NOT a Bills field, NOT a synced collection

Storage key: `secondMemory.budgetDailyNumbers.v1`. Shape: a plain object map, not an
array of records:

```
{ "2026-09-14": 42.5, "2026-09-16": -12, ... }
```

Loaded/saved via plain `localStorage.getItem`/`setItem` + `JSON.parse`/`stringify`,
the same lightweight pattern already used for `UI_STORAGE_KEY`/`loadUiState`/
`saveUiState` (a flat settings-shaped object, not a collection array) — **not** via
`loadCollection`/`saveCollection`/`migrateSyncFields`, which all assume an array of
`{id, ...}` records.

- A blank/cleared input **removes the key from the map** (`delete map[dateKey]`) —
  never stores `0`. `0` is a real, distinguishable user-entered value from "nothing
  entered," exactly like Coursework's `credits` field treats `0` as real (per the
  2026-09-15 filter/sort cycle's `compareByField` null-check precedent: check for
  `null`/`undefined`/`''` explicitly, never falsy).
- **Not currency-validated, not labeled with any forced meaning** (per Architect
  decision #2) — a plain `<input type="number" step="any">` with no `min`, so negative
  values are allowed (a balance can be negative).
- **Not included in `SYNC_COLLECTIONS`, sync, or export/import in v1.** See §9
  (Flagged/Unresolved) — this is a deliberate scope call I'm making, not something the
  Architect's five decisions addressed, and I'm flagging it for explicit sign-off
  rather than silently deciding it's fine.
- **Not wired into undo/redo** — a consequence of not being a `SYNC_COLLECTIONS`
  member (the undo engine is keyed by collection name; see §9).

---

## 2. Occurrence generation

All date-key values are local-date-derived `YYYY-MM-DD` strings (never
`toISOString()`-derived — see the explicit warning below). Comparisons between two
date keys use plain string comparison (`<`, `<=`), which is correct for this fixed
zero-padded format, matching the existing `isTodoOverdue()` convention of comparing
`dueDate < today` as strings.

**Do not copy `isTodoOverdue()`'s `new Date().toISOString().slice(0, 10)` literally.**
That derives *UTC* today, not local today — a real, already-flagged latent bug in the
existing To-Do/export code that the research brief explicitly says the new Budget code
must not propagate. Use the local-field-derived helper below instead.

### 2.1 Date helpers

```
function dateKeyFromParts(year, monthIndex, day) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dateKeyFromLocalDate(date) {
  return dateKeyFromParts(date.getFullYear(), date.getMonth(), date.getDate());
}

function todayKey() {
  return dateKeyFromLocalDate(new Date());
}

function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m: m - 1, d }; // m is 0-indexed to match Date's convention
}

function daysInMonth(year, monthIndex) {
  // The "day 0" trick: day 0 of month M+1 is the last day of month M.
  return new Date(year, monthIndex + 1, 0).getDate();
}

function utcDayDiff(fromKey, toKey) {
  const a = parseDateKey(fromKey);
  const b = parseDateKey(toKey);
  // UTC-anchored per the research brief — never diff local-millisecond timestamps,
  // that's DST-unsafe. Every UTC day is exactly 86,400,000ms by definition.
  return Math.round((Date.UTC(b.y, b.m, b.d) - Date.UTC(a.y, a.m, a.d)) / 86400000);
}

// Local calendar-day arithmetic (safe from the DST pitfall above because it
// increments the day-of-month FIELD, letting Date's constructor normalize
// month/year rollover — the same technique the calendar window math uses).
function shiftDateKey(key, deltaDays) {
  const { y, m, d } = parseDateKey(key);
  return dateKeyFromLocalDate(new Date(y, m, d + deltaDays));
}
```

### 2.2 `occursOnDate(bill, dateKey)` — does this bill have an occurrence on this exact date?

Used for calendar-cell rendering (checking each of the 35 window days against each
bill) and for filtering `paidDates` entries that still correspond to a real occurrence
(§2.3, §4).

```
function occursOnDate(bill, dateKey) {
  if (bill.frequency === 'one_time') return dateKey === bill.dueDate;

  const anchor = parseDateKey(bill.dueDate);
  const candidate = parseDateKey(dateKey);

  if (bill.frequency === 'weekly' || bill.frequency === 'biweekly') {
    const period = bill.frequency === 'weekly' ? 7 : 14;
    const dayDiff = utcDayDiff(bill.dueDate, dateKey);
    return dayDiff >= 0 && dayDiff % period === 0;
  }

  if (bill.frequency === 'monthly') {
    const monthOffset = (candidate.y - anchor.y) * 12 + (candidate.m - anchor.m);
    if (monthOffset < 0) return false;
    const expectedDay = Math.min(anchor.d, daysInMonth(candidate.y, candidate.m));
    return candidate.d === expectedDay;
  }

  if (bill.frequency === 'yearly') {
    const yearOffset = candidate.y - anchor.y;
    if (yearOffset < 0 || candidate.m !== anchor.m) return false;
    const expectedDay = Math.min(anchor.d, daysInMonth(candidate.y, candidate.m));
    return candidate.d === expectedDay;
  }

  return false;
}
```

Notes on correctness (validated against the research brief's confirmed facts):
- Weekly/biweekly use the UTC-anchored day-diff + modulo check exactly as recommended
  in §1a of the research brief; `dayDiff >= 0` guards against a negative modulo result
  for any window date before the bill's anchor (a bill can't have occurred before it
  was due).
- Monthly/yearly use the day-0-trick clamp (`daysInMonth`) exactly as recommended in
  §1b/§1c. Because `expectedDay` is compared against the *candidate's own* day, a
  31st-of-month bill correctly shows on the 30th of a 30-day month and nowhere else in
  that month (never on the 1st/2nd of the following month, which is what the naive
  `setMonth()` bug the research brief flagged would produce).
- Yearly's Feb 29 anchor recurring into a non-leap year clamps to Feb 28 for free,
  since `daysInMonth(candidate.y, 1)` (February) already returns 28 or 29 correctly
  for the *candidate's* year.

### 2.3 `occurrenceCountThrough(bill, throughKey)` — closed-form count, no day-by-day loop

Needed for the weekly-total carry-forward formula (§4), which must be able to ask
"how many occurrences has this bill had, on or before this date" for a bill whose
anchor could be arbitrarily far in the past. Rather than iterating every day from the
anchor to `throughKey` (which is unbounded and unnecessary), this is computed in
closed form directly from the recurrence math — O(1) per bill per week, not O(days
since anchor):

```
function occurrenceCountThrough(bill, throughKey) {
  if (throughKey < bill.dueDate) return 0;
  if (bill.frequency === 'one_time') return 1;

  const anchor = parseDateKey(bill.dueDate);
  const through = parseDateKey(throughKey);

  if (bill.frequency === 'weekly' || bill.frequency === 'biweekly') {
    const period = bill.frequency === 'weekly' ? 7 : 14;
    const dayDiff = utcDayDiff(bill.dueDate, throughKey);
    return Math.floor(dayDiff / period) + 1;
  }

  if (bill.frequency === 'monthly') {
    const monthOffsetMax = (through.y - anchor.y) * 12 + (through.m - anchor.m);
    const expectedDay = Math.min(anchor.d, daysInMonth(through.y, through.m));
    const lastOccurrenceKey = dateKeyFromParts(through.y, through.m, expectedDay);
    // If this month's occurrence hasn't happened yet as of throughKey, don't count it.
    return lastOccurrenceKey <= throughKey ? monthOffsetMax + 1 : monthOffsetMax;
  }

  if (bill.frequency === 'yearly') {
    const yearOffsetMax = through.y - anchor.y;
    const expectedDay = Math.min(anchor.d, daysInMonth(anchor.y + yearOffsetMax, anchor.m));
    const lastOccurrenceKey = dateKeyFromParts(anchor.y + yearOffsetMax, anchor.m, expectedDay);
    return lastOccurrenceKey <= throughKey ? yearOffsetMax + 1 : yearOffsetMax;
  }

  return 0;
}
```

### 2.4 `unpaidAmountThrough(bill, throughKey)` — dollar amount still owed as of a date

```
function unpaidAmountThrough(bill, throughKey) {
  const totalOccurrences = occurrenceCountThrough(bill, throughKey);
  if (totalOccurrences === 0) return 0;
  const paidCount = (bill.paidDates || [])
    .filter((d) => d <= throughKey && occursOnDate(bill, d))
    .length;
  return Math.max(0, totalOccurrences - paidCount) * bill.amount;
}
```

The `occursOnDate(bill, d)` filter on `paidDates` is what makes Architect decision #3
(silent orphaning on edit) actually inert rather than a live bug: if a bill's
`dueDate`/`frequency` is edited after some dates were marked paid, any now-stale
`paidDates` entry that no longer matches the new recurrence rule is simply excluded
from `paidCount` here — it neither reduces nor inflates the total, it's just dead data
sitting harmlessly in the array. No reconciliation code needed, per the settled
decision.

---

## 3. Calendar window computation

Formalizing the research brief's §2 algorithm as a function:

```
function getCalendarWindowDays(today = new Date()) {
  const dow = today.getDay(); // 0 = Sunday (confirmed via MDN)
  const startOfThisWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow);
  const windowStart = new Date(
    startOfThisWeek.getFullYear(),
    startOfThisWeek.getMonth(),
    startOfThisWeek.getDate() - 14
  );
  const days = [];
  for (let i = 0; i < 35; i++) {
    days.push(new Date(windowStart.getFullYear(), windowStart.getMonth(), windowStart.getDate() + i));
  }
  return days.map(dateKeyFromLocalDate); // 35 date-key strings, Sunday-start
}
```

- Returns 35 `YYYY-MM-DD` strings. Index `[0..6]` = week 0 (2 weeks ago), `[7..13]` =
  week 1 (last week), `[14..20]` = week 2 (**this week — the middle**), `[21..27]` =
  week 3 (next week), `[28..34]` = week 4 (2 weeks from now).
- Each week's **week-end key** (Saturday) is index `7*weekIndex + 6`.
- Crosses month/year boundaries automatically via `Date`'s day-of-month rollover
  normalization — no manual month-length/leap-year logic needed, confirmed safe per
  the research brief's §2.
- **Recompute fresh on every `renderBudget()` call** (tab switch, add/edit/delete a
  bill, toggle paid, page load) — never cached, never driven by a `setInterval`, per
  the research brief's explicit recommendation. This matches the existing
  `isTodoOverdue()` precedent (recomputes "today" fresh every call) rather than the
  sync-status label's ticking-interval precedent.
- **Optional, not required:** hooking the existing `visibilitychange` listener (already
  used for `runSync()`) to also call `renderBudget()` when the tab regains visibility,
  so a tab left open overnight shows the correct rolled-forward window without the user
  needing to switch tabs away and back. Flagging as a cheap nice-to-have per the
  research brief — Bob should not build this unless the Architect asks for it
  explicitly, to keep this cycle's scope to what was asked.

### Month/year header

Shows **today's actual month and year only** (e.g. "September 2026"), never a
computed span of the window (which would sometimes need an awkward "Aug–Oct 2026"
label). No locale API dependency — a plain lookup array:

```
const MONTH_NAMES = ['January','February','March','April','May','June','July',
  'August','September','October','November','December'];
```

Rendered as `` `${MONTH_NAMES[today.getMonth()]} ${today.getFullYear()}` `` into
`#budget-month-label`.

---

## 4. Weekly total computation

```
function weekTotal(weekEndKey, allBills) {
  return allBills
    .filter((b) => !b.deleted)
    .reduce((sum, b) => sum + unpaidAmountThrough(b, weekEndKey), 0);
}
```

**Explicitly intentional, not a bug to "fix" later:** this is a cumulative
"total currently owed as of the end of this week" figure, so the *same* unpaid
occurrence contributes to every week's total from the week it's due through every
subsequent week, for as long as it stays unpaid. An unpaid bill due in week 0 (2 weeks
ago) still adds to week 0's, week 1's, week 2's, week 3's, and week 4's totals
simultaneously. This is directly required by the user's own wording ("i want that to
include an[y] past weeks bills that haven't been marked as paid") and is confirmed
correct by the research brief §5 — a future cycle must not "deduplicate" this without
re-reading this section first.

The overall unpaid summary line (§6, an approved suggested addition) uses the exact
same function anchored at today instead of a week-end: `weekTotal`-equivalent logic
computed per-bill via `unpaidAmountThrough(bill, todayKey())` and summed — see §6.2.

---

## 5. UI layout

### 5.1 Nav placement

**Budget goes in the existing "Personal" nav group**, alongside To-Do, Shopping List,
and Notes — placed last in that group. Reasoning: Budget is everyday personal-life
admin tracking, the same category as a to-do list or shopping list, not a health
record or a career/academic artifact. It doesn't warrant a new nav group for one tab,
per CLAUDE.md's scope-discipline rule ("don't add abstractions... beyond what's been
asked for").

### 5.2 HTML structure

New `<section class="collection" id="budget-collection" hidden>` added to
`index.html`'s `<main class="content">`, and a new nav button:

```html
<li>
  <button type="button" class="nav-item" data-tab="budget">
    <svg class="nav-icon" ...></svg>
    Budget
  </button>
</li>
```

`app.js`'s `TABS` array gains `'budget'` — `setActiveTab()` is already fully generic
over `TABS` (looks up `${t}-collection` and `.nav-item[data-tab="${t}"]`), so no
changes to `setActiveTab()` itself are needed.

Section structure, top to bottom:

```html
<section class="collection" id="budget-collection" hidden>
  <div class="collection-toolbar">
    <h2 id="budget-month-label">September 2026</h2>
  </div>

  <div class="budget-calendar" id="budget-calendar">
    <!-- weekday header row: Sun/Mon/Tue/Wed/Thu/Fri/Sat, static markup -->
    <div class="budget-weekday-row">
      <span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span>
      <span>Thu</span><span>Fri</span><span>Sat</span>
    </div>
    <!-- 5 x .budget-week rows rendered by renderBudget(), see 5.3 -->
  </div>

  <p class="stats-line" id="budget-stats"></p>

  <div class="collection-toolbar">
    <h2>Bills</h2>
    <input type="search" id="budget-search-input" placeholder="Search bills…" aria-label="Search bills">
    <select id="budget-sort-input" aria-label="Sort bills">
      <option value="due_date_asc">Sort: Due Date (Soonest first)</option>
      <option value="due_date_desc">Sort: Due Date (Latest first)</option>
      <option value="name_asc">Sort: Name (A–Z)</option>
      <option value="amount_desc">Sort: Amount (High to Low)</option>
      <option value="amount_asc">Sort: Amount (Low to High)</option>
    </select>
  </div>

  <form id="budget-add-form" class="add-form add-form-stacked">
    <input type="text" id="budget-name-input" placeholder="Bill name" required aria-label="Bill name">
    <input type="number" id="budget-amount-input" placeholder="Amount" min="0.01" step="0.01" required aria-label="Bill amount">
    <label class="date-field">Due date
      <input type="date" id="budget-duedate-input" required aria-label="Due date">
    </label>
    <select id="budget-frequency-input" aria-label="Frequency">
      <option value="monthly">Monthly</option>
      <option value="weekly">Weekly</option>
      <option value="biweekly">Biweekly</option>
      <option value="yearly">Yearly</option>
      <option value="one_time">One-time (no recurrence)</option>
    </select>
    <input type="text" id="budget-category-input" placeholder="Category (optional)" aria-label="Bill category">
    <p class="form-error" id="budget-form-error" hidden></p>
    <button type="submit">Add bill</button>
  </form>

  <div class="chip-row" id="budget-category-filters"></div>

  <ul class="card-list flat-list" id="budget-list"></ul>

  <p class="empty-state" id="budget-empty-state" hidden>No bills yet — add your first one above.</p>
</section>
```

The calendar (`#budget-calendar`) is **always rendered**, including at zero bills —
mirroring the existing convention where Books' column grid always renders (0-count
columns, not hidden) and `#books-empty-state` is *additive*, not a replacement. The
manual per-day number is useful on its own even with no bills entered yet, so hiding
the whole calendar behind "no bills" would be wrong.

Bill card template, following the exact `.X-card`/`.X-view`/`.X-edit-form` triplet
convention used by all 9 existing collections (closest structural precedent: the
Recipes card, since Bills also has an optional category badge; no move-select needed,
Bills has no status field):

```html
<template id="budget-card-template">
  <li class="bill-card">
    <div class="bill-view">
      <div class="bill-info">
        <strong class="bill-name"></strong>
        <span class="bill-amount"></span>
        <span class="bill-due"></span>
        <span class="bill-frequency"></span>
        <span class="bill-category badge" hidden></span>
      </div>
      <div class="bill-actions">
        <button type="button" class="edit-btn">Edit</button>
        <button type="button" class="delete-btn" aria-label="Delete bill">Delete</button>
      </div>
    </div>
    <form class="bill-edit-form" hidden>
      <input type="text" class="bill-edit-name" placeholder="Bill name" required aria-label="Edit bill name">
      <input type="number" class="bill-edit-amount" placeholder="Amount" min="0.01" step="0.01" required aria-label="Edit bill amount">
      <label class="date-field">Due date
        <input type="date" class="bill-edit-duedate" required aria-label="Edit due date">
      </label>
      <select class="bill-edit-frequency" aria-label="Edit frequency">
        <option value="monthly">Monthly</option>
        <option value="weekly">Weekly</option>
        <option value="biweekly">Biweekly</option>
        <option value="yearly">Yearly</option>
        <option value="one_time">One-time (no recurrence)</option>
      </select>
      <input type="text" class="bill-edit-category" placeholder="Category (optional)" aria-label="Edit bill category">
      <p class="form-error bill-edit-error" hidden></p>
      <div class="bill-actions">
        <button type="submit">Save</button>
        <button type="button" class="cancel-btn">Cancel</button>
      </div>
    </form>
  </li>
</template>
```

Editing a bill **never touches `paidDates`** — the edit form only writes
`name`/`amount`/`dueDate`/`frequency`/`category`. `paidDates` is only ever mutated by
`toggleBillPaid` (§7).

### 5.3 Calendar grid markup (rendered by `renderBudget()`, not a static template)

Each of the 5 weeks renders as:

```html
<div class="budget-week" data-week-index="2"> <!-- add .budget-week-current when index === 2 -->
  <div class="budget-week-cells">
    <!-- 7 x .budget-day-cell -->
    <div class="budget-day-cell" data-date-key="2026-09-16">
      <div class="budget-day-header"><span class="budget-day-date">16</span></div>
      <ul class="budget-day-occurrences scroll-block">
        <li class="budget-occurrence">
          <label>
            <input type="checkbox" class="budget-occurrence-checkbox" data-bill-id="..." data-date-key="2026-09-16">
            <span class="budget-occurrence-name">Rent</span>
          </label>
        </li>
        <!-- more occurrences, or none -->
      </ul>
      <div class="budget-day-footer">
        <input type="number" class="budget-day-manual-input" step="any" data-date-key="2026-09-16" aria-label="Note for September 16">
      </div>
    </div>
    <!-- ...6 more day cells -->
  </div>
  <p class="budget-week-total">This week: <strong>$347.00</strong></p>
</div>
```

CSS classes needed (new, since no existing 7-column weekly-calendar layout exists to
reuse — every other reuse point below IS an existing class):
- `.budget-calendar`, `.budget-weekday-row`, `.budget-week`, `.budget-week-current`
  (highlight — border/background accent — so "this week is visually in the middle" is
  obvious at a glance, not just positionally true), `.budget-week-cells` (`display:
  grid; grid-template-columns: repeat(7, 1fr);`), `.budget-day-cell` (`display: flex;
  flex-direction: column;`), `.budget-day-header` (`text-align: right;` — date in the
  top-right corner, per the literal request), `.budget-day-footer` (`margin-top: auto;
  text-align: right;` — manual number pinned to the bottom-right corner), `.budget-week-total`.
- `.budget-day-occurrences` **reuses the existing `.scroll-block` class** (already
  used for Recipes' ingredients/steps lists) rather than inventing a new
  overflow-scroll mechanism — this directly reuses the same "cap height, scroll
  internally" precedent DECISIONS.md just logged for the Books columns
  (`03131b4 — Cap Books column height and make it scroll internally`). This answers
  the "3+ bills on one small day cell" edge case: rather than truncating with a "+N
  more" affordance (a new interaction pattern this app doesn't have anywhere else),
  the occurrence list gets a fixed max-height (roughly 3 rows) with internal scroll —
  reusing an established pattern beats inventing a new one.
- `.budget-occurrence-checkbox` — reuse `.todo-completed-checkbox`'s/
  `.shopping-checked-checkbox`'s plain-checkbox styling, no new checkbox visual needed.
- **Overdue occurrences reuse the `.todo-due.overdue` semantic**, not a new color:
  `.budget-occurrence.overdue` gets the same rust/`--accent-2` treatment. Per
  DECISIONS.md's standing constraint, `--accent-2` is now a narrow-purpose
  error/destructive/overdue-only color — this is exactly that role, so Bob must reuse
  it rather than introduce a new hue for "overdue bill."
- Category is **not** shown as a color chip on the tiny calendar cell (too little
  space to do well without inventing a hash-to-color system, which is more machinery
  than this "your call" suggestion is worth) — instead it's surfaced in the
  checkbox label's `title` attribute alongside the amount, e.g. `title="Rent — $1200.00 (Housing)"`,
  so hovering/long-pressing a crowded cell's entries is still informative. Category
  *does* get the full chip-filter treatment on the Bills list column itself (§5.4),
  which is where it's actually useful for a long list.

### 5.4 Bills list column — category chip filter

Reuses the exact `normalizeChipKey`/`deriveChipOptions`/`renderChipFilter` helpers
already shared by Recipes/Shopping List/Coursework — no new filter mechanism:

```js
let selectedBillCategory = 'all';

function renderBillCategoryFilters(nonDeletedBills) {
  const container = document.getElementById('budget-category-filters');
  const options = [{ key: 'all', label: 'All' }, ...deriveChipOptions(nonDeletedBills, (b) => b.category)];
  renderChipFilter(container, options, () => selectedBillCategory,
    (key) => { selectedBillCategory = key; }, renderBudget);
}
```

### 5.5 Search

`matchesBillSearch(bill, term)` checks `` `${bill.name} ${bill.category}` `` — matching
the multi-field-join convention already used by `matchesRecipeSearch`/
`matchesMedicationSearch`.

---

## 6. "Connects to the calendar" — confirmed automatic, no extra plumbing

This is free, by construction, given on-the-fly occurrence generation (§2): the
calendar never stores or caches which bills occur on which day. Every render of
`renderBudget()` re-derives, for each of the 35 window days, which bills occur on it
by calling `occursOnDate(bill, dateKey)` against the live `bills` array. Adding,
editing, or deleting a bill (via `addBill`/`updateBill`/`deleteBill`) already ends with
a call to `renderBudget()` (matching every other collection's `addX`/`updateX`/
`deleteX` → `renderX()` convention) — the moment that render runs, the new/changed/
removed bill's occurrences appear or disappear on the calendar automatically. **There
is no separate "sync the calendar to the bills list" step to build** — Bob should not
add one. This also directly confirms a bill with a `dueDate` far outside today's
5-week window (e.g. a yearly bill due 8 months out) will correctly start appearing
once the window rolls forward to include it, with zero additional code, since
`occursOnDate` is a pure function of `(bill, dateKey)` with no precomputed horizon.

### 6.1 `renderBudget()` render-preservation requirements

`renderBudget()` must generalize the existing "preserve in-progress unsaved input
across a re-render" pattern (already required for every other collection's
`renderX()`, and the exact bug class the Notes fix in the 2026-09-14/15 cycles
addressed) to **two** kinds of in-progress state specific to this tab, not just one:

1. **The Bills list's open edit form** — identical to every other collection: capture
   the open `.bill-edit-form`'s live values before `#budget-list` is cleared, restore
   them after rebuild if that bill is still in the filtered/sorted set. Enforce the
   same single-open-edit-form-at-a-time invariant the other 9 collections already
   enforce (closing any other open form when Edit is clicked).
2. **A focused `.budget-day-manual-input`** — this is a real, non-obvious risk unique
   to this tab: toggling a paid-checkbox on the calendar (§7) calls `renderBudget()`,
   which wipes and rebuilds the *entire* calendar grid, including all 35 manual-number
   `<input>` elements. If the user is mid-typing into a *different* day's manual number
   at that exact moment (not yet blurred, so not yet saved — see §7's "manual number
   saves on `change`, not `input`"), a naive full rebuild would silently discard those
   keystrokes, exactly like the Notes bug DECISIONS.md already logged once. Before
   clearing `#budget-calendar`'s week rows, check `document.activeElement`: if it
   matches `.budget-day-manual-input`, capture its `dataset.dateKey` and current
   `.value`; after rebuild, find the new cell for that date key and restore both the
   value and focus. Since the manual number saves on blur/`change` (not on the wiping
   re-render itself), this restore step is what prevents mid-keystroke data loss.

---

## 7. Checking off a bill occurrence as paid

Direct structural match to `toggleTodoCompleted`/`toggleShoppingChecked` — find
record, snapshot `before`, mutate exactly one field, `stampSync`, `saveCollection`,
`recordUndo`, re-render:

```js
function toggleBillPaid(billId, dateKey, paid) {
  const bill = bills.find((b) => b.id === billId);
  if (!bill) return;
  const before = structuredClone(bill);
  const paidSet = new Set(bill.paidDates || []);
  if (paid) paidSet.add(dateKey); else paidSet.delete(dateKey);
  bill.paidDates = [...paidSet];
  stampSync(bill);
  saveCollection(BILLS_KEY, bills);
  recordUndo('bills', billId, before, structuredClone(bill));
  renderBudget();
}
```

Wired to each occurrence checkbox's `change` event:
`checkbox.addEventListener('change', (e) => toggleBillPaid(billId, dateKey, e.target.checked))`.

**The manual per-day number does NOT call `renderBudget()` on save** (unlike every
other mutation in this tab). Its `change` handler just writes into the
`budgetDailyNumbers` map and calls the plain `localStorage.setItem` save — no
re-render, because no other on-screen value (no other cell, no weekly total, no bill)
ever depends on it (per Architect decision #2, it's excluded from every total). This
is also what keeps §6.1's focus-preservation concern scoped to *cross-cell* churn only
(one checkbox toggle triggering a full rebuild while a *different* cell is being
typed into) rather than every keystroke also triggering the same risk against itself.

**Marking paid is only possible from the calendar, only for occurrences currently
inside the 35-day window.** There is no "mark paid" control on the Bills list card
itself — see §9 for why this is a real, worth-flagging limitation rather than a
finished design.

---

## 8. Bills as the 10th `SYNC_COLLECTIONS` citizen

```js
const BILLS_KEY = 'secondMemory.bills.v1';
let bills = migrateSyncFields(loadCollection(BILLS_KEY), BILLS_KEY, getDeviceId());
```

`addBill`/`updateBill`/`deleteBill`/`restoreBill` follow the exact naming and body
shape of every existing collection's equivalents (`addMedication`-style `{ ok, error }`
returns for `addBill`/`updateBill`, since amount/name/dueDate validation can fail;
`deleteBill`/`restoreBill` are unconditional tombstone flips exactly like
`deleteBook`/`restoreBook`, no validation needed). Each calls `recordUndo('bills', ...)`
at the same point in its body every other collection's mutator does.

```js
{ name: 'bills', label: 'Bills', key: BILLS_KEY, get: () => bills, set: (v) => { bills = v; },
  render: renderBudget, delete: deleteBill, restore: restoreBill }
```
added to `SYNC_COLLECTIONS`. `RECORD_LABEL_FIELD` gains `bills: 'name'`.

This is the entire integration surface — no other change to `applyEntrySnapshot`,
`undo`/`redo`, `runSync`, `importData`, or export is needed. Confirmed by inspection:
`applyEntrySnapshot`'s generic `Object.keys(snapshot).forEach(...)` copy handles
`paidDates` (an array field) with zero special-casing, exactly like it already handles
Recipes' `ingredients`/`steps` arrays — because `recordUndo`/`applyEntrySnapshot` both
`structuredClone` the whole record, array fields are deep-copied automatically, so
there's no reference-aliasing risk between the live `bills` array and whatever's
sitting in the undo/redo stacks. This directly validates Architect decision #5: Bills
plugs into the generic engine with no one-off mechanics needed.

---

## 9. Edge cases

- **Empty bills list:** calendar still renders in full (35 cells, weekday header,
  month label) — only the Bills list column shows `#budget-empty-state`, additive to
  (not replacing) the calendar, matching the Books convention. Every day cell's
  occurrence list is empty; every week total is `$0.00`; the stats line reads
  something like "$0.00 unpaid across 0 bills."
- **First run, zero bills:** identical to the empty-bills-list case above — the
  calendar is useful standalone (manual numbers) even before any bill exists.
- **A bill added with a `dueDate` far outside the current window:** confirmed handled
  for free by on-the-fly generation (§6) — no action needed, no horizon to configure.
- **3+ bills on one day:** `.scroll-block` internal scroll, reusing the just-established
  Books-column precedent (§5.3) — no truncation/"+N more" UI needed.
- **Duplicate bill names:** allowed, no dedup — matches the existing app-wide
  no-dedup convention (Books already allows duplicate titles).
- **Very long bills list:** no virtualization needed, personal-scale data, matches
  every other flat-list collection.
- **Editing a bill's `dueDate`/`frequency` after some occurrences are paid:** per
  settled Architect decision #3, allowed with no warning; any `paidDates` entry that
  no longer matches the new recurrence rule is silently excluded from
  `unpaidAmountThrough`'s `paidCount` (§2.4) — inert, not reconciled, not surfaced.
- **A `one_time` bill whose single occurrence is outside the current window:** it
  simply never appears on the calendar until (if ever) the window rolls to include its
  `dueDate`. If the window rolls past it while still unpaid, it correctly continues
  contributing to every subsequent week's carry-forward total (§4) even though it's no
  longer visible on the calendar to check off — see the flagged concern below, this is
  the same underlying limitation as the trailing-window one.
- **Negative or zero amount / blank name / blank due date:** rejected at both add and
  edit time with a form error (`#budget-form-error` / `.bill-edit-error`), matching
  the Medications validation-with-error convention, not the silent-no-op convention.

---

## 10. Flagged / unresolved — for the Architect, not decided here

These are genuine open points the research brief and the Architect's five settled
decisions don't cover. I'm flagging rather than guessing, per my mandate, since two of
them have real (non-data-loss, but real) UX consequences.

**10.1 — No way to retroactively mark an occurrence paid once it scrolls out of the
trailing 2-week window.** The calendar has no manual back/forward navigation (nothing
in the user's request or the research brief asked for one — it's explicitly a
rolling, always-current window). Once a day cell is more than ~2 weeks in the past, it
permanently leaves the visible 35-day window and there is no UI control anywhere
(including the Bills list) to mark that specific occurrence paid after the fact. The
underlying math (§2.4) will keep counting it as unpaid in every weekly/overall total
forever, with no way to clear it short of directly editing `localStorage`. This isn't
data-loss and isn't something the settled decisions address, but it's a real
"if you don't open the app for 3 weeks, an old bill you actually paid becomes
permanently un-checkable and inflates your totals indefinitely" gap. Two low-risk
mitigation options for a future cycle, not built now: (a) add a lightweight
"mark most recent unpaid occurrence as paid" control directly on the Bills list card
(no calendar navigation needed), or (b) add manual prev/next-week navigation to the
calendar itself. Recommend the Architect pick one for a follow-up cycle rather than
this spec silently declaring the gap out of scope.

**10.2 — The manual per-day number's sync/export/undo exclusion (§1.2, §7) is my
default, not a settled decision.** I chose to keep it local-only (own
`localStorage` key, outside `SYNC_COLLECTIONS`, outside undo/redo, outside
export/import) because it's the simplest option and matches its "free-form personal
scratch value, not part of any total" framing from decision #2. But it IS the one
piece of user-enterable data in this entire app that wouldn't sync across devices,
wouldn't survive an export/import round-trip, and wouldn't be protected by Undo if
misentered — every other field in every other collection has all three. If the
Architect wants the manual number to follow the user across devices (e.g. checking a
running balance on the phone that was entered on the desktop), it should instead be
modeled as its own tiny record-per-day collection (`{ id, dateKey, value, dateAdded,
updatedAt, deviceId, deleted, version }`) and added as an 11th `SYNC_COLLECTIONS`
entry — meaningfully more plumbing than the flat-map approach above, which is why I
didn't default to it, but flagging so it's a conscious choice, not an oversight.

**10.3 — Default frequency in the add-form.** I defaulted the add-form's frequency
`<select>` to `monthly` (arbitrary but matches the most common real bill type: rent,
subscriptions, insurance) with `one_time` listed last. Low-stakes, easily changed,
not worth a decision cycle — noting only so Bob doesn't wonder if the ordering means
something.

No other gaps found. Everything else in this spec is either directly sourced from the
research brief's confirmed facts, one of the Architect's five settled decisions, or a
mechanical, low-risk reuse of an existing app convention (naming, validation shape,
undo/redo wiring, chip-filter helpers, `.scroll-block`, `.todo-due.overdue`) with the
specific reuse justified inline above.
