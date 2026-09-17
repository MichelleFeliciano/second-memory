# Spec: Home dashboard tab — "what needs attention today"

Validated against `app.js` (`TABS`/`setActiveTab()`, `isTodoOverdue()`, the Budget
date/occurrence helpers `todayKey()`/`shiftDateKey()`/`occursOnDate()`/
`unpaidAmountThrough()`, `renderBooksStats()`/`renderCoursesStats()`/
`renderBudgetStats()`, `SYNC_COLLECTIONS`, every collection's `addX()` function for its
real field shape), `index.html` (nav-group structure, `.collection`/template
conventions, existing empty-state wording), `style.css` (`.stats-line`, `.chip`,
`.card-list`, `.columns` grid, `.todo-due.overdue`, `--accent-2`, the shared card-visual
selector block), and `DECISIONS.md` (project history — in particular the two prior
cycles that fixed a stale-render bug from a collection not re-rendering after a
cross-collection change, and the still-open, deliberately-not-fixed
`isTodoOverdue()` UTC-vs-local latent bug).

**No new data is stored anywhere by this feature.** Home is a pure, render-only view
computed fresh from the live `bills`, `todos`, and `books` arrays already held in
memory by the existing Budget/To-Do/Books code. There is no new `localStorage` key, no
new record shape, no new `SYNC_COLLECTIONS` entry, and nothing for undo/redo to track,
because nothing is ever created, edited, or deleted from the Home tab itself.

---

**Analyst validation pass (this revision):** cross-checked every code sketch below
line-by-line against the real `app.js`/`index.html`/`style.css` (function signatures,
field names, CSS class list membership, the `.columns` grid's breakpoint, `.nav-group`
markup — confirmed it renders correctly with no `.nav-group-label` child) — no
fabricated fields or functions found. Three concrete issues were caught and fixed in
this revision rather than left for Bob to discover or guess around:
1. **§4 vs §8/§9 contradiction:** §4 originally described Currently Reading as a single
   merged text line (`renderBooksStats()`-style); §8/§9 already specified it as a panel
   of individually clickable rows. Resolved in favor of the panel treatment (see §4's
   correction note) — only that version satisfies §9's per-item click-through
   requirement; a single merged line can't say which book was clicked.
2. **Bills panel row-shape gap:** `overdue` and `dueSoon` bill items are different
   shapes (`{bill, amount}` — a cumulative total — vs. `{bill, dateKey}` — one specific
   occurrence) and need different display text; the original draft didn't specify this.
   Added §2.1.
3. **Unsorted overdue todos:** `computeHomeTodos()`'s `overdue` array had no sort,
   inconsistent with `dueSoon`'s explicit soonest-first sort right next to it. Added an
   oldest-due-date-first sort for consistency (§3).

No other gaps were found beyond what §11 already flags as open/deliberate.

---

## 1. What each collection contributes (and why the rest contribute nothing)

Per-collection verdict, decided against the actual field shapes read directly from
`app.js`'s `addX()` functions — not guessed:

| Collection | Verdict | Why |
|---|---|---|
| **Budget/Bills** | **Yes** — overdue + due-soon | Has a real `dueDate`/`frequency`/`paidDates`, i.e. an actual concept of "owed as of today." Most dashboard-relevant collection by construction. |
| **To-Do** | **Yes** — overdue + due-soon | Has `dueDate` + `completed`, and already has a working, tested "is this overdue" function (`isTodoOverdue`) to reuse directly. |
| **Books** | **Yes, but lightweight** — Currently Reading callout only | No due date, so not "time-sensitive" in the same sense as Bills/To-Do. Included anyway as a small non-actionable reminder, because it names actual titles the user might otherwise forget they're mid-book on — matching the app's whole "second memory" premise — and the task explicitly asked for a judgment call here. Kept deliberately minimal (a few rows, no counts-as-stats padding) so it doesn't set a precedent for every collection getting a callout "for symmetry." |
| **Medications** | **No** | `startDate`/`endDate` describe a *range already in effect*, not a future deadline. "Currently taking" has no due-today concept — that's exactly what the Medications tab's own "Currently Taking" column already shows, one click away. A Home callout would just duplicate that column's count with zero new information. |
| **Diagnoses** | **No** | `dateDiagnosed` is a historical fact, not a future date. `status` (active/monitoring/resolved) has no deadline attached. Nothing to be "on time" or "late" for. |
| **Recipes** | **No** | No dates of any kind on a recipe record (`title`/`category`/`ingredients`/`steps`/`notes`). Nothing to surface. |
| **Shopping List** | **No** | `checked`/`item`/`quantity`/`category` — an evergreen list with no deadline. An "N unchecked items" count would be stats-for-stats-sake noise the task explicitly warned against, and the Shopping List tab itself is one click away for that. |
| **Notes** | **No** | `dateModified` tracks *when something was last edited*, not a due date. "Recently edited notes" is exactly the generic "recent activity" widget the task said not to invent. |
| **Resume & Portfolio** | **No** | `label`/`url`/`notes` — static reference links, never time-sensitive. |
| **Coursework** | **No** | Tempting parallel to Books' Currently Reading (`status: 'in_progress'`), but declined: unlike a book someone might genuinely forget they're mid-way through, in-progress courses already have a prominent, permanent "In Progress" column with its own live count directly in the Coursework tab — a Home callout would be pure duplication, not new information, and would start eroding "don't force a widget for symmetry." No `dueDate`/deadline field exists on a course record either. |

Three widgets total: **Bills**, **To-Do**, **Currently Reading**. Seven of ten
collections deliberately contribute nothing — that's the expected, correct outcome for
a "what needs attention" dashboard, not a gap.

---

## 2. Bills widget — exact query

Reuses the Budget tab's existing date/occurrence helpers directly
(`todayKey()`, `shiftDateKey()`, `occursOnDate()`, `unpaidAmountThrough()`) — no new
date math is invented.

```js
function computeHomeBills(nonDeletedBills) {
  const todayK = todayKey();
  const yesterdayK = shiftDateKey(todayK, -1);

  // Overdue: bills with a real unpaid balance strictly BEFORE today. Deliberately
  // uses unpaidAmountThrough (closed-form, O(1)-ish) — NOT oldestUnpaidOccurrence,
  // which is an unbounded day-by-day walk the Budget cycle's Tester explicitly found
  // was too expensive to run on every render for every bill and restricted to only
  // the "mark oldest unpaid" button's click handler. Home re-renders on every
  // add/edit/delete/undo/redo/sync across three collections (see §5), so it must
  // stay on the cheap side of that already-learned lesson.
  const overdue = nonDeletedBills
    .map((bill) => ({ bill, amount: unpaidAmountThrough(bill, yesterdayK) }))
    .filter((x) => x.amount > 0)
    .sort((a, b) => b.amount - a.amount); // worst offender first

  // Due soon: unpaid occurrences landing on any of the next 7 days (today
  // inclusive). A bounded 8-iteration-per-bill loop, same technique
  // renderBudgetCalendar() already uses (occursOnDate per day-key) — not a new
  // date-math primitive, just a much smaller window than the calendar's 35 days.
  const dueSoon = [];
  nonDeletedBills.forEach((bill) => {
    for (let i = 0; i <= 7; i++) {
      const dateKey = shiftDateKey(todayK, i);
      if (occursOnDate(bill, dateKey) && !(bill.paidDates || []).includes(dateKey)) {
        dueSoon.push({ bill, dateKey });
      }
    }
  });
  dueSoon.sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));

  return { overdue, dueSoon };
}
```

**N = 7 days, justified:** short enough to keep the dashboard genuinely about "this
week," long enough to give real lead time on a weekly/biweekly bill. Reused as the same
threshold for To-Do's due-soon window (§3) so the whole dashboard shares one "this
week" mental model instead of two different arbitrary numbers.

**A bill can legitimately appear in both `overdue` and `dueSoon` simultaneously** (an
old unpaid weekly occurrence plus a new one due this week), and a weekly bill can
appear **twice** in `dueSoon` if its 7-day period places two distinct occurrences
inside the 8-day lookahead window (e.g. due every Monday, checked on a Monday: today
and 7 days out both qualify). Both are correct, not bugs — they're two genuinely
distinct facts about the same bill, in the same spirit as Budget's already-accepted
"same bill contributes to multiple weeks' totals" precedent (see DECISIONS.md,
2026-09-16 Budget entry, §4). Do not deduplicate.

### 2.1 — Bills panel: two different row shapes, and combined list order

`computeHomeBills()` returns two arrays whose items are shaped differently — this must
not be flattened into "one row template for bills" without accounting for that:

- **`overdue` items** are `{ bill, amount }`, where `amount` is
  `unpaidAmountThrough(bill, yesterdayKey)` — a *cumulative* unpaid total that can
  represent more than one missed occurrence (e.g. a weekly bill unpaid for the last 3
  weeks). There is no single "the" missed date to show here without calling
  `oldestUnpaidOccurrence()`, which is already excluded from render-time code above for
  cost reasons. **Render:** `bill.name` + `` `$${amount.toFixed(2)} overdue` `` inside
  a `.bill-due.overdue` span. No per-occurrence date is shown on Home for this row —
  the click-through to Budget (§9) is where the user finds/marks the specific missed
  date via the existing "Mark oldest unpaid as paid" button.
- **`dueSoon` items** are `{ bill, dateKey }`, where `dateKey` is one specific real,
  unpaid occurrence date straight from the bounded 8-iteration loop. **Render:**
  `bill.name` + `` `$${bill.amount.toFixed(2)} due ${dateKey}` `` inside a plain
  (non-`.overdue`) `.bill-due` span — note this uses `bill.amount` (the
  single-occurrence amount), not the aggregate `amount` field the overdue row uses.

Both amounts use `.toFixed(2)`, matching every existing currency display in this app
(`renderBudgetStats`, `renderBudgetList`, `renderBudgetCalendar` all do the same).

`#home-bills-list` is rendered as one flat list, not two visually-separated
sub-lists: append all `overdue` rows first (already sorted worst-amount-first), then
all `dueSoon` rows (already sorted soonest-first) — the `.overdue` class's existing
color/weight treatment is what visually distinguishes the two groups within the single
list, the same way `renderTodos()` already relies on `.overdue` alone (no
sub-headings) to mark urgency within one flat `#todo-list`. A bill that's both overdue
(on an old missed occurrence) and due soon (on a new upcoming one) correctly produces
two separate rows, per §2's "do not deduplicate" rule — no `.bill-amount` element is
used on Home; the amount is folded directly into each row's `.bill-due` text as shown
above.

## 3. To-Do widget — exact query

Reuses `isTodoOverdue()` **directly, unmodified** — not reimplemented:

```js
function computeHomeTodos(nonDeletedTodos) {
  const overdue = nonDeletedTodos
    .filter((t) => !t.completed && isTodoOverdue(t))
    .sort(compareByField((t) => t.dueDate, 1, { text: false })); // oldest due date (most overdue) first

  // "Today" here is deliberately derived the exact same way isTodoOverdue() derives
  // it internally (UTC, via toISOString().slice(0,10)) — NOT Budget's corrected
  // local-date todayKey(). Mixing the two within this one widget would create a
  // boundary mismatch: a todo could register as "due soon" by local reckoning while
  // isTodoOverdue() simultaneously (and correctly, per its own logic) already calls
  // it overdue, or vice versa, for several hours around local midnight in US
  // timezones. Internal consistency with the function this widget is required to
  // reuse wins over "correctness" here — see §11.1 for why this isn't silently fixed.
  const todayUtcKey = new Date().toISOString().slice(0, 10);
  const dueSoonThroughKey = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const dueSoon = nonDeletedTodos
    .filter((t) => !t.completed && t.dueDate && !isTodoOverdue(t) && t.dueDate <= dueSoonThroughKey)
    .sort(compareByField((t) => t.dueDate, 1, { text: false }));

  return { overdue, dueSoon };
}
```

`todayUtcKey` is computed but not separately used beyond documenting the boundary
convention — `dueSoonThroughKey` (today + 7 days, same UTC idiom) is the actual
comparison bound. Completed todos are excluded from both buckets regardless of
`dueDate` (matches `isTodoOverdue`'s own `if (todo.completed) return false` short
circuit).

Unlike Bills (§2.1), both `overdue` and `dueSoon` todo items share the same shape (the
`t` record itself, with its own `t.dueDate`) — no per-row-type rendering split is
needed. `#home-todo-list` is rendered the same way as the Bills panel: `overdue` rows
first (now explicitly sorted oldest-due-date-first), then `dueSoon` rows appended
after, with `.overdue` toggled exactly the way `renderTodos()` already does it
(`dueEl.classList.toggle('overdue', isTodoOverdue(todo))`).

## 4. Currently Reading callout — exact query

```js
function computeCurrentlyReading(nonDeletedBooks) {
  return nonDeletedBooks.filter((b) => b.status === 'currently_reading');
}
```

No date filtering. Sort by author A–Z, reusing `BOOK_SORTS.author_asc`'s comparator
directly (stable, free, and consistent with Books' own default sort).

Rendered as a `.column` panel (matching the Bills and To-Do widgets' shape), one row
per currently-reading book showing `.book-title`/`.book-author` (reusing the exact
classes the Books card template already defines), each row independently clickable
through to Books (§9). If the list is empty, the entire panel — including its `<h3>`
heading — is omitted (`hidden`), not shown with a "not reading anything" placeholder:
it's informational, not a completion signal, so there's nothing calm-and-positive to
say about its absence the way there is for the "nothing overdue" case.

---

## 5. Render-only, wired to fire on every relevant mutation

`renderHome()` is a new function that takes no arguments, reads the live
`bills`/`todos`/`books` arrays directly (module-level, same as every other `renderX()`),
and rebuilds `#home-collection`'s dashboard content from scratch on every call — same
"wipe and rebuild" convention as every other collection, no diffing.

**Wiring requirement (this is the one non-mechanical part of "adding a tab is
mechanical"):** because Home aggregates three *other* collections' data rather than
owning its own, it must be re-rendered whenever any of `bills`, `todos`, or `books`
changes — not just once at page load. This app has no event bus/pub-sub; every existing
cross-cutting update (sync, import) works by calling each collection's own `render`
function directly in a loop (see `SYNC_COLLECTIONS.forEach((c) => c.render())` in
`runSync()`/`importData()`, and the 2026-09-15 "sync/import all-tabs re-render fix" that
exists specifically because a collection was once missed). The correct, minimal-surface
way to keep Home current without hand-hunting every one of the ~15 mutation call sites
across three collections is:

```js
// At the very end of renderBooks(), renderTodos(), and renderBudget() — i.e. the
// three functions that already run after EVERY add/edit/delete/restore/toggle/
// undo/redo/sync/import touching bills, todos, or books — add one line:
renderHome(); // Home aggregates books/todos/bills — keep this in sync
```

This works because every mutation to any of the three source collections *already*
ends by calling its own collection's render function (that's the established, universal
pattern in this codebase) — so hooking into those three existing render functions gives
Home automatic, zero-missed-call-site freshness for free, the same way
`renderBooksStats()` already piggybacks on `renderBooks()` rather than having its own
separate call sites. **Do not add `renderHome()` calls anywhere else** (no new call
sites in `addBill`/`toggleTodoCompleted`/etc. directly) — that would just be the same
result with more places to forget it.

At init, calling `renderHome()` a 3rd, 2nd, and 1st time in a row (once each from the
three hooked functions, all before the user ever sees the tab) is harmless — dashboards
over personal-scale data are cheap to compute repeatedly.

Home is explicitly **not** added to `SYNC_COLLECTIONS` — it has no `get`/`set`, no
storage key, nothing to sync, export, import, or undo. Its `render` entry point
(`renderHome`) is invoked only via the three hooks above, never via the sync/import
loops.

---

## 6. Empty-state handling

Two independent pieces of UI, matching the app's existing "stats-line for populated
state, empty-state for zero state" toggle convention (e.g. `#books-empty-state`):

```html
<p class="stats-line" id="home-stats"></p>
<p class="empty-state" id="home-empty-state" hidden>
  Nothing needs your attention today — you're all caught up.
</p>
```

- `actionableCount = overdueBills.length + dueSoonBills.length + overdueTodos.length + dueSoonTodos.length`.
- If `actionableCount > 0`: show `#home-stats` (e.g. `"3 things need your attention this
  week."`, reusing `renderBooksStats()`'s terse counting style) and the Bills/To-Do
  panels; hide `#home-empty-state`.
- If `actionableCount === 0`: hide `#home-stats` and the Bills/To-Do panels entirely
  (not shown-but-empty — an empty "Overdue Bills" panel with nothing in it is worse
  than not showing the panel), show `#home-empty-state`.
- **The Currently Reading callout is independent of this toggle** — it renders
  whenever `computeCurrentlyReading()` is non-empty, *regardless* of `actionableCount`.
  Showing "Nothing needs your attention today" right next to "Currently reading:
  Priory of the Orange Tree" is not a contradiction — they answer different questions
  (what's urgent vs. what's in progress) — so both can and should be visible together.

Tone matches the existing empty-state voice (`#books-empty-state`: "No books yet — add
your first one above.") — calm, plain, slightly warm, no exclamation marks, no emoji.

---

## 7. Nav placement and default tab

**`TABS` gains `'home'` as its first element:**
```js
const TABS = ['home', 'books', 'recipes', 'medications', 'diagnoses', 'todo', 'shopping', 'notes', 'budget', 'resume', 'coursework'];
```

`setActiveTab()` needs no logic changes — it is already fully generic over `TABS`
(`document.getElementById('${t}-collection')` / `.nav-item[data-tab="${t}"]`). Two
small, deliberate consistency edits alongside adding `'home'`:

1. The invalid-tab fallback inside `setActiveTab()` changes from `'books'` to
   `'home'`: `const activeTab = TABS.includes(tab) ? tab : 'home';` — an unrecognized/
   corrupted saved tab value should fall back to the new landing page, not
   specifically to Books.
2. The init call changes from `setActiveTab(loadUiState().activeTab || 'books')` to
   `setActiveTab(loadUiState().activeTab || 'home')`.

**Home becomes the default landing tab on first run / cleared UI state, but existing
users' saved `activeTab` is respected as-is** — this only changes behavior for (a)
brand-new installs with no `secondMemory.ui.v1` key yet, and (b) anyone who manually
clears that key. A user who was last on, say, Budget keeps opening to Budget after this
change; nothing forces them back to Home. This is the same "we only change the fallback,
never override a real saved preference" pattern the UI-state code already uses
everywhere else.

**Nav placement: a new, ungrouped entry at the very top of `.nav-list`, above the
existing "Library" group** — not folded into Library, Personal, Health, or Career &
Academics, since Home isn't thematically any of those; it's the landing view above all
four groups. Structurally, this is just one more `<li class="nav-group">` (reusing the
exact same wrapper element every other group uses) but with **no `.nav-group-label`**
paragraph inside it — confirmed against `style.css`: `.nav-group` is a plain flex
column with its own `gap`, and `.nav-item` styling has no dependency on a sibling
label element, so this renders correctly with zero new CSS:

```html
<ul class="nav-list">
  <li class="nav-group">
    <ul class="nav-group-items">
      <li>
        <button type="button" class="nav-item" data-tab="home">
          <svg class="nav-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
            <path d="M12 2C7 2 3 6 3 11c0 5 4 9 9 11 5-2 9-6 9-11 0-5-4-9-9-9z" fill="none" stroke="currentColor" stroke-width="1.6"/>
            <path d="M12 4v16" stroke="currentColor" stroke-width="1.4"/>
          </svg>
          Home
        </button>
      </li>
    </ul>
  </li>
  <li class="nav-divider"><div class="leaf-divider" aria-hidden="true"></div></li>
  <li class="nav-group">
    <p class="nav-group-label">Library</p>
    ... (unchanged)
```

The icon reuses the exact same generic leaf-teardrop `<path>` markup every other nav
item already uses (every existing nav icon is visually identical decoration, not a
distinct per-item glyph — matching that existing convention rather than commissioning a
new "house" icon).

---

## 8. HTML/CSS structure

New section, placed **first** among `<section class="collection">` elements in `<main
class="content">` (matching its position as first in `TABS` and first in the nav),
`hidden` in markup (harmless either way since `setActiveTab()` fixes visibility on
load, but matches the convention every non-default section already follows):

```html
<section class="collection" id="home-collection" hidden>
  <div class="collection-toolbar">
    <h2>Home</h2>
  </div>

  <p class="stats-line" id="home-stats"></p>
  <p class="empty-state" id="home-empty-state" hidden>
    Nothing needs your attention today — you're all caught up.
  </p>

  <div class="columns" id="home-widgets">
    <!-- 0-3 of the following .column panels, built by renderHome() -->
    <div class="column" id="home-bills-panel" hidden>
      <h3>Bills</h3>
      <ul class="card-list" id="home-bills-list"></ul>
    </div>
    <div class="column" id="home-todo-panel" hidden>
      <h3>To-Do</h3>
      <ul class="card-list" id="home-todo-list"></ul>
    </div>
    <div class="column" id="home-reading-panel" hidden>
      <h3>Currently Reading</h3>
      <ul class="card-list" id="home-reading-list"></ul>
    </div>
  </div>
</section>
```

No `<form>`, no search input, no sort `<select>` — Home has nothing to create and
nothing worth filtering/sorting beyond the fixed "overdue first, then soonest" ordering
already baked into each widget's query (§2–§4). This matches the Budget tab's own
month-label toolbar precedent (a `.collection-toolbar` containing only an `<h2>`, no
controls, is already an established shape in this app, not a new pattern).

**Reuses the existing `.columns` grid wholesale** (`grid-template-columns: repeat(3,
1fr)`, collapsing to one column under 700px per the existing `@media (max-width: 700px)`
rule) — zero new layout CSS needed; the three widget panels are just three more
`.column` elements dropped into a grid mechanism the app already has.

**One new CSS class needed** (everything else is reuse): `.home-item-link`, an
unstyled full-width button so each row is a real, keyboard-focusable clickable target
without inventing new visual language:

```css
.home-item-link {
  background: none;
  border: none;
  width: 100%;
  text-align: left;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
```

Each `<li>` row's outer wrapper class should be **added to the existing shared
card-visual selector list** in `style.css` (the block currently listing `.book-card,
.recipe-card, .med-card, .diagnosis-card, .todo-item, .shopping-item, .note-card,
.link-card, .course-card, .bill-card` for border/radius/padding/background/shadow/hover)
— e.g. add `.home-item` to that list — rather than duplicating those six properties a
12th time. Row content inside each `.home-item-link` reuses the *source* collection's
own text classes directly, for visual consistency with each item's real tab:

- Bills rows: reuse `.bill-name` for the name; the amount/due text's exact format
  differs by row type — see §2.1 — but both render inside a `.bill-due` span, with
  `.overdue` added only for overdue rows (reusing `--accent-2`, the app's established
  error/destructive/overdue-only color per the 2026-09-15 redesign's standing
  constraint). Extend the existing `.todo-due.overdue` CSS rule's selector list to also
  match `.bill-due.overdue` (a one-line selector-list addition, not a new color) — no
  separate `.bill-amount` element is used on Home (§2.1's overdue row has no single
  per-occurrence amount to put there).
- To-Do rows: reuse `.todo-task`/`.todo-due` directly, with `.overdue` applied the same
  way `renderTodos()` already applies it (`dueEl.classList.toggle('overdue',
  isTodoOverdue(todo))`).
- Currently Reading rows: reuse `.book-title`/`.book-author` directly.

---

## 9. Interaction: click-through to source tab

Every row across all three widgets is clickable and switches to that item's own tab —
mechanically simple, using the existing `setActiveTab()` function directly, exactly as
the task anticipated:

```js
// Bills row
btn.addEventListener('click', () => setActiveTab('budget'));
// To-Do row
btn.addEventListener('click', () => setActiveTab('todo'));
// Currently Reading row
btn.addEventListener('click', () => setActiveTab('books'));
```

**Confirmed this needs nothing more complex.** No deep-linking to a specific record
inside the target tab (e.g. scrolling to or highlighting the exact bill/todo/book that
was clicked) — that would require every target tab to expose a "scroll to/highlight
record by id" capability that doesn't exist anywhere in this app today (Books' 218-item
columns, Bills' flat list, etc. have no such addressing mechanism), which is real,
avoidable scope creep for what the task itself frames as a low-risk usability win. A
plain tab switch is enough: the clicked bill/todo/book is virtually always visible
immediately (Budget's "due soon"/"overdue" sort already surfaces it near the top of its
own default `due_date_asc` sort; To-Do's default `due_date_asc` sort does the same;
Currently Reading is typically a handful of items in one column).

---

## 10. Edge cases

- **First run, all ten collections empty:** `actionableCount === 0`,
  `computeCurrentlyReading()` empty too — Home shows only `#home-empty-state`
  ("Nothing needs your attention today — you're all caught up."), no panels, no stats
  line. Calm, not broken-looking.
- **Every bill paid, no overdue/due-soon todos, nothing currently reading:** same as
  above — this is the expected steady state for a well-maintained list, not an edge
  case to treat as suspicious.
- **A bill with `frequency: 'one_time'` whose single occurrence is already paid:**
  `unpaidAmountThrough` returns 0 for both the overdue and due-soon checks (once paid,
  `occurrenceCountThrough` minus `paidCount` is 0) — correctly never appears again,
  matching Budget's own existing behavior.
- **Very long overdue/due-soon lists** (e.g. someone hasn't opened the app in months
  and has a dozen overdue bills): no truncation/pagination is specified — personal-scale
  data, matching every other flat-list collection's "no virtualization needed"
  precedent. If this ever becomes a real problem in practice, an internal-scroll cap
  (`.scroll-block`, already used for Recipes/Budget-calendar-cells) is the established
  fallback pattern to reach for, not something to build preemptively here.
- **A todo due exactly today:** `isTodoOverdue` returns `false` for it (strict `<`, not
  `<=`), so it correctly lands in `dueSoon`, not `overdue` — matches the existing
  function's own semantics exactly, not reinterpreted.
- **A bill due exactly today, unpaid:** symmetric to the above — `unpaidAmountThrough`
  through *yesterday* is 0 (not overdue yet), and it's picked up by the `dueSoon` loop's
  `i = 0` iteration (today). Correct, and deliberately mirrors the To-Do boundary
  convention for consistency across the two widgets.
- **A currently-reading book gets moved to a different status (e.g. `owned_read`)
  while the user is sitting on the Home tab:** covered automatically by §5's wiring —
  `updateBookStatus()` already ends with `renderBooks()`, which now also calls
  `renderHome()`, so the callout updates immediately without a manual refresh.
- **Deleted records:** every query filters `!x.deleted` first, matching the tombstone
  convention used everywhere else — a soft-deleted bill/todo/book never appears on
  Home, exactly as it wouldn't in its own tab.

---

## 11. Flagged / unresolved — for the Architect, not decided here

**11.1 — This inherits, and slightly extends, the existing UTC-vs-local
`isTodoOverdue()` boundary quirk, by design, not by oversight.** DECISIONS.md already
records this as a known, deliberately-not-fixed latent bug (`isTodoOverdue()`/
`todayForFilename()` derive "today" via `toISOString().slice(0,10)`, which is UTC, not
local — "today" can flip several hours before local midnight for US timezones), with an
explicit standing note that fixing it is "an explicit follow-up decision, not something
silently done as part of this cycle." Per the task's own instruction to reuse
`isTodoOverdue()` directly rather than reimplementing it, §3 above does exactly that —
and then deliberately extends the *same* UTC idiom to the new due-soon boundary check,
specifically so the two buckets partition cleanly against each other without a
same-widget seam. **If a future cycle ever does fix `isTodoOverdue()`'s UTC bug, Home's
`computeHomeTodos()` due-soon boundary must be updated in the same cycle**, or the two
will silently drift apart again at the exact midnight edge. Flagging this dependency now
so it isn't rediscovered from scratch later.

**11.2 — The `renderHome()` cross-collection wiring (§5) is a new kind of coupling in
this codebase.** Every existing `renderX()` today depends only on its own collection's
array. Home is the first case where one collection's render function needs to also
trigger another, unrelated-looking function's re-render as a side effect
(`renderBooks()`/`renderTodos()`/`renderBudget()` each also calling `renderHome()`).
This is the pragmatic choice given the app has no event/pub-sub system anywhere, and
it's a small, contained, three-call-site addition — but it's worth the Architect's
explicit awareness (and worth a one-line comment at each of the three call sites,
e.g. `renderHome(); // Home aggregates books/todos/bills — keep this in sync`) so a
future refactor of any of those three functions doesn't accidentally drop the hook and
silently reintroduce a stale-dashboard bug of exactly the shape the 2026-09-15
sync/import all-tabs fix was written to prevent.

**11.3 — Currently Reading's inclusion is the one deliberate exception to "only
genuinely time-sensitive items."** It isn't due-dated the way Bills/To-Do are. Flagging
explicitly (rather than quietly folding it in as if it met the same bar) so if the
Architect disagrees with including it, removing it is a one-panel deletion with no
knock-on effects elsewhere in this spec.

**11.4 — N = 7 days for both "due soon" buckets is my chosen default, not derived from
any existing app precedent** (Budget's own calendar shows a 5-week/35-day window for a
different purpose — full visibility/planning — which is not the same job as a "needs
attention now" filter). 7 was picked for the reasons in §2; easy to change to a
different single shared number later if the user wants a shorter/longer look-ahead, but
I'd recommend keeping Bills and To-Do on the *same* number rather than picking two
different ones, to keep the dashboard's mental model ("what's due this week") coherent.

No other gaps found. Everything else above is either a direct, unmodified reuse of an
existing function/class/pattern (`isTodoOverdue`, `todayKey`/`shiftDateKey`/
`occursOnDate`/`unpaidAmountThrough`, `compareByField`, `.columns`/`.card-list`/
`.stats-line`/`.empty-state`/`.todo-due.overdue`/`--accent-2`, `setActiveTab`) or a
small, explicitly-justified mechanical extension of one (the one new `.home-item-link`
button-reset class, the one new `.bill-due.overdue` selector addition).
