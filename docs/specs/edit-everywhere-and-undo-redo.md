# Spec: Edit-everywhere + Global Undo/Redo

Status: ready for Bob. Builds on `docs/research/edit-and-undo-redo.md` (all seven
recommendations there are treated as settled, not re-derived here).

**Architect's decision on the one open question the Researcher left:** single-open-edit-form
exclusivity is **per-collection**, not app-wide. Opening a Books edit form does not force-close
an already-open Notes (or Recipes, or Medications, ...) edit form. Only forms *within the same
collection* are mutually exclusive — exactly like Notes today, just widened (per §6 below) to
search across every list container that collection renders into, not just one.

---

## 0. Collection name reference

All code below uses the exact `SYNC_COLLECTIONS[].name` strings already established in
`app.js` (do not invent new ones — sync/import both key off these):

| Collection | `SYNC_COLLECTIONS` name | Array variable | localStorage key |
|---|---|---|---|
| Books | `books` | `books` | `BOOKS_KEY` |
| Recipes | `recipes` | `recipes` | `RECIPES_KEY` |
| Medications | `medications` | `medications` | `MEDICATIONS_KEY` |
| Diagnoses | `diagnoses` | `diagnoses` | `DIAGNOSES_KEY` |
| To-Do | `todos` | `todos` | `TODOS_KEY` |
| Shopping List | `shoppingList` | `shoppingItems` | `SHOPPING_KEY` |
| Notes | `notes` | `notes` | `NOTES_KEY` |
| Resume & Portfolio | `links` | `links` | `LINKS_KEY` |
| Coursework | `courses` | `courses` | `COURSES_KEY` |

---

## 1. Undo/redo stack design

### 1.1 Data shape (module-level, in-memory only — never persisted)

```js
let undoStack = [];   // oldest at index 0, most recent at the end
let redoStack = [];
let isApplyingHistory = false; // guard, see §3
const MAX_UNDO_DEPTH = 50;
```

Each entry:

```js
{
  collection: 'books',        // one of the 9 names in §0
  id: 'uuid-...',              // record id, stable across the entry's lifetime
  before: { ... } | null,      // deep clone (structuredClone) of the record before the
                                // mutation, or null if the mutation was an add
  after: { ... },               // deep clone of the record after the mutation — never null
  timestamp: '2026-09-15T...',  // ISO string, new Date().toISOString() at record time
}
```

- `before`/`after` must be produced with `structuredClone()`, never a live reference into
  `books`/`notes`/etc. (Researcher §2 — confirmed real risk, every mutation function mutates
  in place).
- Add is modeled as `before: null`. Delete is modeled as `after` having `deleted: true`.
- **No whole-array snapshots, ever** — one changed record per entry (Researcher §3).

### 1.2 Max depth: 50, and what happens on overflow

Recommend **50**, matching Researcher's own worked example (§3: ~15–35 KB total at that
depth, three orders of magnitude cheaper than a whole-array approach). Justification beyond
just matching the estimate: 50 actions covers realistic "I want to walk back a few things I
just did" recovery without letting an all-day session's history grow unbounded in memory.
On pushing past 50, drop the **oldest** entry: `if (undoStack.length > MAX_UNDO_DEPTH)
undoStack.shift();`. Apply the same cap to `redoStack` (defensive — in practice it can never
exceed what was popped from `undoStack`, but cap it anyway for symmetry and to avoid ever
relying on that invariant holding forever).

### 1.3 New action after undo(s) discards the redo tail — confirmed standard behavior

Yes, standard "linear" undo/redo, not a branching history. Concretely: **only genuine new
mutations clear `redoStack`— applying an undo or a redo must NOT clear it.** This is enforced
structurally, not by a special case: `redoStack = []` lives inside `recordUndo()` (§1.4), and
`recordUndo()` is a no-op whenever `isApplyingHistory` is true. Since `undo()`/`redo()` always
set that flag before invoking any mutation function and clear it after, nothing they trigger
internally can clear the redo stack. Any real new action (the user editing/adding/deleting
something) runs with the flag false, so it clears `redoStack` normally.

### 1.4 The `recordUndo` helper and the guard

```js
function recordUndo(collectionName, id, before, after) {
  if (isApplyingHistory) return; // undo/redo replays never re-record themselves
  undoStack.push({
    collection: collectionName,
    id,
    before: before === null ? null : structuredClone(before),
    after: structuredClone(after),
    timestamp: new Date().toISOString(),
  });
  if (undoStack.length > MAX_UNDO_DEPTH) undoStack.shift();
  redoStack = [];
  updateUndoRedoButtons(); // §4
}
```

Every mutation function calls this **once**, immediately after `saveCollection(...)` and
before its own `renderX()` call, with `before` captured **at the top of the function, before
any field is touched**, and `after` captured **after `stampSync()`/field changes are applied,
before `saveCollection()`** (order between capturing `after` and calling `saveCollection`
doesn't matter functionally, but capture it after the mutation is fully applied to the live
record). This is one uniform rule for all 44 call sites enumerated in §1.5 — no per-function
judgment calls needed.

### 1.5 Every function that must call `recordUndo` — enumerated by name

**Existing functions (27) — add the `recordUndo(...)` call, no other behavior change:**

| Collection | Functions |
|---|---|
| Books | `addBook`, `updateBookStatus`, `updateBookRating`, `deleteBook` |
| Recipes | `addRecipe`, `deleteRecipe` |
| Medications | `addMedication`, `updateMedicationDate`, `deleteMedication` |
| Diagnoses | `addDiagnosis`, `updateDiagnosisStatus`, `deleteDiagnosis` |
| To-Do | `addTodo`, `toggleTodoCompleted`, `deleteTodo` |
| Shopping List | `addShoppingItem`, `toggleShoppingChecked`, `deleteShoppingItem` |
| Notes | `addNote`, `updateNote`, `deleteNote` |
| Resume & Portfolio | `addLink`, `deleteLink` |
| Coursework | `addCourse`, `updateCourseStatus`, `updateCourseGrade`, `deleteCourse` |

**New functions this cycle (17) — also call `recordUndo(...)`:**

| Collection | New `restoreX(id)` (§2) | New edit-form `updateX(id, fields)` (§5) |
|---|---|---|
| Books | `restoreBook` | `updateBook(id, {title, author})` |
| Recipes | `restoreRecipe` | `updateRecipe(id, {title, category, ingredientsText, stepsText, notes})` |
| Medications | `restoreMedication` | `updateMedication(id, {name, dosage, frequency, prescribingDoctor, notes})` |
| Diagnoses | `restoreDiagnosis` | `updateDiagnosis(id, {condition, dateDiagnosed, provider, notes})` |
| To-Do | `restoreTodo` | `updateTodo(id, {task, dueDate})` |
| Shopping List | `restoreShoppingItem` | `updateShoppingItem(id, {item, quantity, category})` |
| Notes | `restoreNote` | *(none — `updateNote` already exists, see §5.7 and §8)* |
| Resume & Portfolio | `restoreLink` | `updateLink(id, {label, url, notes})` |
| Coursework | `restoreCourse` | `updateCourse(id, {title, code, credits, term, notes})` |

That's 27 + 9 + 8 = **44 call sites total.**

### 1.6 Add's `before: null` — what it means downstream

`recordUndo(collectionName, newRecord.id, null, newRecord)` is called from every `addX`. The
`null` is meaningful, not a placeholder — it tells the undo engine "there is no prior state;
undoing this means removing the record" (§3.2).

---

## 2. `restoreX` — nine per-collection functions, matching the existing `addX`/`deleteX` convention

**Decision: nine per-collection `restoreX(id)` functions, not one generic
`restoreRecord(collectionName, id)`.** Reasoning: `deleteX` — the closest existing precedent —
is already structured as nine separate named functions (`deleteBook`, `deleteRecipe`,
`deleteMedication`, `deleteDiagnosis`, `deleteTodo`, `deleteShoppingItem`, `deleteNote`,
`deleteLink`, `deleteCourse`), each hardcoded to its own array/key/render, even though the
generic `SYNC_COLLECTIONS` lookup table already exists. `SYNC_COLLECTIONS` is used *only* for
infrastructure that must be truly generic across all nine (sync, import/export) — never for
the actual per-record mutation logic, which the codebase's convention keeps as named,
collection-specific functions. `restoreX` is exactly that kind of mutation logic, so it should
follow `deleteX`'s pattern, not invent a new generic-function pattern the codebase doesn't
otherwise use.

Representative implementation (Books; apply the identical shape to the other eight,
substituting that collection's array/key/render):

```js
function restoreBook(id) {
  const book = books.find((b) => b.id === id);
  if (!book || !book.deleted) return; // defensive no-op — nothing to restore
  const before = structuredClone(book);
  book.deleted = false;
  stampSync(book);
  saveCollection(BOOKS_KEY, books);
  recordUndo('books', id, before, structuredClone(book));
  renderBooks();
}
```

`restoreX` only ever un-tombstones (`deleted: false`) + `stampSync()` — it never needs to
touch any other field, because `deleteX` never touches any other field either (Researcher §2:
confirmed every `deleteX` only sets `deleted = true`, nothing else).

**Where these live:** immediately after each collection's `deleteX` definition in `app.js`,
same file section, same ordering convention as everything else.

**Extend `SYNC_COLLECTIONS`** with two more properties per entry so the generic undo/redo
engine (§3) can dispatch to the right delete/restore function without needing its own
9-way switch:

```js
{ name: 'books', label: 'Books', key: BOOKS_KEY, get: () => books, set: (v) => { books = v; },
  render: renderBooks, delete: deleteBook, restore: restoreBook },
```
...and so on for all nine entries. This mirrors the exact pattern the sync/import code
already uses generically (`get`/`set`/`render`) — just two more fields on the same lookup
table, not a new mechanism.

**Scope note:** `restoreX` is added *only* to support undo-of-delete. No user-facing "restore
a deleted item" button/UI is in scope for this cycle — that would be new functionality nobody
asked for (CLAUDE.md: keep scope tight). If a future cycle wants a "trash/recently deleted"
view, `restoreX` is already there to build on, but nothing here should surface deleted records
directly to the user outside of undo.

---

## 3. Undo/redo application mechanics

### 3.1 The core insight: entries move unchanged between stacks — no "reverse entry" construction

`undo()` pops the top entry off `undoStack`, applies its `before` state, and pushes **that
same entry object, unmodified** onto `redoStack`. `redo()` pops the top entry off `redoStack`,
applies its `after` state, and pushes **that same entry, unmodified** back onto `undoStack`.
No new entry is ever synthesized at undo/redo time — only at the original mutation time (§1.4).
This is simpler and more robust than constructing a "reversed" entry, and it's easy to verify
it stays stable under repeated undo→redo→undo cycles (apply `before` → tombstone/restore/set
fields; apply `after` → the exact opposite; repeat indefinitely, always converging back to the
same two states).

```js
function undo() {
  if (undoStack.length === 0) return;
  const entry = undoStack.pop();
  isApplyingHistory = true;
  applyEntrySnapshot(entry, 'before');
  isApplyingHistory = false;
  redoStack.push(entry);
  if (redoStack.length > MAX_UNDO_DEPTH) redoStack.shift();
  updateUndoRedoButtons();
}

function redo() {
  if (redoStack.length === 0) return;
  const entry = redoStack.pop();
  isApplyingHistory = true;
  applyEntrySnapshot(entry, 'after');
  isApplyingHistory = false;
  undoStack.push(entry);
  if (undoStack.length > MAX_UNDO_DEPTH) undoStack.shift();
  updateUndoRedoButtons();
}
```

### 3.2 `applyEntrySnapshot(entry, which)` — the generalized wrapper Researcher §4 sanctioned

Researcher §4 explicitly recommends calling the *existing* `updateX`/`deleteX`/`restoreX`
functions "or the smallest possible generalized wrappers around them" — never a bypass that
writes to `localStorage` directly. This is that wrapper. It reuses `deleteX`/`restoreX` for
the tombstone transition (via the `SYNC_COLLECTIONS` lookup extended in §2), and otherwise
performs the exact same sequence every `updateX` already performs (find record → mutate
fields → `stampSync()` → `saveCollection()` → `render()`) — generalized to an arbitrary field
set instead of one hardcoded field, which is the "smallest possible" amount of new generic
code needed.

```js
function applyEntrySnapshot(entry, which) {
  const target = entry[which]; // 'before' on undo, 'after' on redo
  const cfg = SYNC_COLLECTIONS.find((c) => c.name === entry.collection);
  if (!cfg) return;
  const items = cfg.get();
  const record = items.find((r) => r.id === entry.id);

  if (target === null) {
    // Undoing an "add": there is no prior state, so the record must be
    // removed. Reuse the collection's own deleteX (tombstone), never a splice.
    if (record && !record.deleted) cfg.delete(entry.id);
    return;
  }

  if (!record) return; // defensive: id no longer exists at all — see §7.1

  if (target.deleted && !record.deleted) {
    cfg.delete(entry.id);
    return;
  }
  if (!target.deleted && record.deleted) {
    cfg.restore(entry.id); // un-tombstone via restoreX first
  }

  // Re-clone the target on every application — never assign the stack
  // entry's own nested objects/arrays into the live record. This is the
  // same reference-aliasing risk Researcher §2 flagged for the original
  // mutation functions, applied here to the new engine: without this
  // clone, a field like Recipes' `ingredients` array would end up shared
  // between the live record and the entry still sitting in the opposite
  // stack, so a later in-place mutation could silently corrupt history.
  const snapshot = structuredClone(target);
  Object.keys(snapshot).forEach((key) => {
    // Never restore identity/version bookkeeping from history — id and
    // dateAdded never change; version is server-assigned only (Researcher
    // §4: the client never bumps version itself); updatedAt/deviceId are
    // always freshly stamped below, not replayed from the old snapshot,
    // because this undo/redo action IS a new local mutation, not a replay
    // of the old timestamp. `deleted` was already handled above.
    if (['id', 'dateAdded', 'version', 'updatedAt', 'deviceId', 'deleted'].includes(key)) return;
    record[key] = snapshot[key];
  });
  stampSync(record);
  saveCollection(cfg.key, items);
  cfg.render(); // only this one collection re-renders — never the whole app
}
```

Why no per-field validation (e.g. `BOOK_STATUSES.includes(...)`, `isValidDateRange`,
`parseCredits`) is needed here: every `before`/`after` snapshot was captured from a state that
was already valid when it was first created or edited by the normal `addX`/`updateX` path —
reapplying it can't introduce a new invalid state. This matters concretely for Medications:
`before`/`after` each capture `startDate` **and** `endDate` together as a pair from the same
moment, so replaying either one preserves whatever valid combination existed then; the engine
is never asking `isValidDateRange` to accept a novel partial combination it hasn't already
validated.

### 3.3 Trace confirming stability (add → undo → redo → undo, repeated)

1. `addBook` → `entryA = { before: null, after: R0 }` pushed to `undoStack`.
2. **Undo**: `target = null` → `deleteBook(id)` → record tombstoned. `entryA` pushed
   unchanged to `redoStack`.
3. **Redo**: `target = entryA.after = R0` (not deleted) → record is currently deleted →
   `restoreBook(id)`, then field-copy loop reapplies R0's fields (harmless, already correct)
   → `stampSync`/save/render. `entryA` pushed unchanged back to `undoStack`.
4. **Undo** again: identical to step 2. Stable indefinitely — no drift, no synthesized
   "reverse" entries ever needed.

The same reasoning holds for a plain delete/undo-delete cycle: `before`/`after` differ only in
`deleted` (delete never touches other fields), so the restore branch's field-copy loop is a
harmless no-op re-application of unchanged values.

---

## 4. UI placement

**Location:** a new `<div class="undo-redo-panel" id="undo-redo-panel">` in `index.html`,
placed inside `<nav class="sidebar">`, directly below `.sidebar-header` and above `.nav-list`
— i.e. sidebar chrome, not inside any `<section class="collection">`. The sidebar itself is
never hidden per-tab (only the `.collection` sections toggle `hidden`), so this satisfies
"visible regardless of which collection tab is active" for free, the same way the sync panel
and data-io buttons already are always-visible today.

```html
<div class="undo-redo-panel" id="undo-redo-panel">
  <button type="button" id="undo-btn" disabled>Undo</button>
  <button type="button" id="redo-btn" disabled>Redo</button>
</div>
```

**Disabled, not hidden**, when the respective stack is empty — standard undo/redo UX, and
matches this codebase's existing convention of disabling rather than hiding controls when
they're not currently actionable (e.g. the sync "Change" button pattern doesn't hide/show
based on transient state, it's the setup/status sections that toggle).

**Tooltip/label derivation** — keep it simple per the task's own "your call" allowance:

```js
const RECORD_LABEL_FIELD = {
  books: 'title', recipes: 'title', medications: 'name', diagnoses: 'condition',
  todos: 'task', shoppingList: 'item', notes: 'title', links: 'label', courses: 'title',
};

function describeEntry(entry) {
  const labelField = RECORD_LABEL_FIELD[entry.collection];
  const source = entry.after || entry.before;
  const identifier = source && labelField ? source[labelField] : null;
  let action;
  if (entry.before === null) action = 'added';
  else if (entry.after.deleted && !entry.before.deleted) action = 'deleted';
  else if (!entry.after.deleted && entry.before.deleted) action = 'restored';
  else action = 'edited';
  return identifier ? `${action} '${identifier}'` : `${action} an item`;
}

function updateUndoRedoButtons() {
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');
  const topUndo = undoStack[undoStack.length - 1];
  const topRedo = redoStack[redoStack.length - 1];
  undoBtn.disabled = undoStack.length === 0;
  redoBtn.disabled = redoStack.length === 0;
  undoBtn.title = topUndo ? `Undo: ${describeEntry(topUndo)}` : 'Undo';
  redoBtn.title = topRedo ? `Redo: ${describeEntry(topRedo)}` : 'Redo';
}
```

`action` is derived from the entry's own before/after shape (not which stack it's currently
in), so the label is stable regardless of undo/redo direction — "deleted 'Dune'" always means
the same underlying action whether it's sitting in the undo or redo stack.

Wire `undo-btn`/`redo-btn` clicks to `undo()`/`redo()`. Call `updateUndoRedoButtons()` once at
init (both stacks start empty → both start disabled), alongside the existing `renderBooks()`
... `renderCourses()` calls at the bottom of `app.js`.

**Explicitly out of scope for this cycle:** keyboard shortcuts (Ctrl+Z/Ctrl+Y). Researcher
mentions Ctrl+Z only as general undo/redo *convention*, not as a requirement, and the task's
UI ask is specifically "a persistent Undo/Redo button pair." Adding shortcuts is easy to layer
on later but is new scope nobody asked for this cycle (CLAUDE.md: keep scope tight) — flagging
so Bob doesn't build it unprompted, not because it would be wrong to have.

---

## 5. Edit-form additions for the 8 collections without one today

Notes' existing pattern (`.note-view` / `.note-edit-form`, toggled by `.edit-btn`/
`.cancel-btn`, per-card capture/restore keyed by id) is the template. For all eight new
collections: wrap the card's existing display content in a new `.X-view` div (including that
collection's **dedicated always-visible controls** — move-select, rating-select, grade-input,
checkboxes, medication date inputs — which stay exactly where they are today and hide/show
**together with** the rest of the view block, not independently). Add a sibling
`<form class="X-edit-form" hidden>` containing only the fields listed below, plus Save/Cancel
buttons, plus a per-card `.X-edit-error` element **only where that collection's own add-form
already uses the `{ok, error}` pattern** (see rationale column) — this keeps each collection's
edit-form validation style consistent with its own existing add-form style rather than forcing
a uniform pattern the codebase doesn't currently have.

| Collection | Editable in new edit form | Excluded (has its own dedicated control) | Error element? |
|---|---|---|---|
| **Books** | `title`, `author` | `status` (move-select), `rating` (rating-select) | No — mirrors `addBook`'s silent no-op + HTML `required` on title |
| **Recipes** | `title`, `category`, `ingredients` (textarea, newline-separated), `steps` (textarea, newline-separated), `notes` | — (no dedicated controls exist) | No — mirrors `addRecipe`'s silent no-op + HTML `required` on title |
| **Medications** | `name`, `dosage`, `frequency`, `prescribingDoctor`, `notes` | `startDate`/`endDate` (already always-visible date inputs) | **Yes**, `.med-edit-error` — mirrors `addMedication`'s `{ok,error}` pattern (name required) |
| **Diagnoses** | `condition`, `dateDiagnosed`, `provider`, `notes` | `status` (move-select) | No — mirrors `addDiagnosis`'s silent no-op + HTML `required` on condition |
| **To-Do** | `task`, `dueDate` | `completed` (checkbox) | No — mirrors `addTodo`'s silent no-op + HTML `required` on task |
| **Shopping List** | `item`, `quantity`, `category` | `checked` (checkbox) | No — mirrors `addShoppingItem`'s silent no-op + HTML `required` on item |
| **Resume & Portfolio** | `label`, `url`, `notes` | — (no dedicated controls exist) | **Yes**, `.link-edit-error` — mirrors `addLink`'s `{ok,error}` pattern (label + url required) |
| **Coursework** | `title`, `code`, `credits`, `term`, `notes` | `status` (move-select), `grade` (grade-input) | **Yes**, `.course-edit-error` — mirrors `addCourse`'s `{ok,error}` pattern; **reuse the existing shared `parseCredits()` helper** for credits validation, don't reimplement it |

Illustrative markup for one collection (Books) — Bob adapts the same shape for the other
seven, substituting field types/names per the table above:

```html
<template id="books-card-template">
  <li class="book-card">
    <div class="book-view">
      <div class="book-info">
        <strong class="book-title"></strong>
        <span class="book-author"></span>
        <span class="book-rating"></span>
      </div>
      <div class="book-actions">
        <label class="rating-label" hidden>...</label>
        <select class="move-select" aria-label="Move to status">...</select>
        <button type="button" class="edit-btn">Edit</button>
        <button type="button" class="delete-btn" aria-label="Delete book">Delete</button>
      </div>
    </div>
    <form class="book-edit-form" hidden>
      <input type="text" class="book-edit-title" placeholder="Title" required aria-label="Edit book title">
      <input type="text" class="book-edit-author" placeholder="Author" aria-label="Edit book author">
      <div class="book-actions">
        <button type="submit">Save</button>
        <button type="button" class="cancel-btn">Cancel</button>
      </div>
    </form>
  </li>
</template>
```

**Validation function shape** — one representative example (Medications, which needs the
`{ok,error}` style):

```js
function updateMedication(id, fields) {
  const med = medications.find((m) => m.id === id);
  if (!med) return { ok: false, error: 'Medication not found.' };
  const trimmedName = fields.name.trim();
  if (!trimmedName) return { ok: false, error: 'Name is required.' };
  const before = structuredClone(med);
  med.name = trimmedName;
  med.dosage = fields.dosage.trim();
  med.frequency = fields.frequency.trim();
  med.prescribingDoctor = fields.prescribingDoctor.trim();
  med.notes = fields.notes.trim();
  stampSync(med);
  saveCollection(MEDICATIONS_KEY, medications);
  recordUndo('medications', id, before, structuredClone(med));
  renderMedications();
  return { ok: true };
}
```

**Save-does-not-auto-close-the-form, replicated deliberately:** Notes' current `editForm`
submit handler has no `else` branch that hides the form / shows the view on success — after a
successful Save, the form stays open (repopulated with the just-saved values on the next
re-render, since the capture/restore logic reads the live DOM before wiping it). This is
existing shipped behavior, not something this cycle should silently "fix" while generalizing
the pattern to eight more collections — replicate it exactly for consistency. **Flagging this
explicitly rather than quietly changing it**: it may be an unintended quirk worth a future,
separately-scoped UX pass (a user might reasonably expect Save to return to the view), but
fixing it now, differently per collection or not, is out of scope for this cycle and wasn't
asked for.

### 5.1 Where new edit-form Save handlers dispatch `.X-edit-error` (per-card, not global)

Every new edit-form's error element must be a **per-card** class inside the `<template>`
(e.g. `.med-edit-error`), exactly like Notes' `.note-edit-error` — never reuse the singular
`#medications-form-error`/`#coursework-form-error`/etc. global-id element, since those belong
to the single add-form, while edit-forms exist once per rendered card (potentially many at
once, even if only one is open at a time per §6).

---

## 6. Status-column capture/restore must search all of a collection's list containers

Per Researcher §7: the open-edit-form search (analogous to Notes'
`list.querySelector('.note-edit-form:not([hidden])')`) must be widened for every
status-column collection to check **all** of that collection's list containers, not just one
— otherwise an open edit form in a column not currently being re-rendered-around could be
silently lost.

Exact container references, taken directly from the real markup/constants:

| Collection | Containers to search | Selector pattern |
|---|---|---|
| Books | 5, one per `BOOK_STATUSES` entry | `` [data-list="${status}"] `` for each of `want_to_buy`, `owned_unread`, `currently_reading`, `owned_read`, `jons_bookshelf` |
| Diagnoses | 3, one per `DIAGNOSIS_STATUSES` entry | `` [data-diagnosis-list="${status}"] `` for `active`, `monitoring`, `resolved` |
| Coursework | 3, one per `COURSE_STATUSES` entry | `` [data-course-list="${status}"] `` for `completed`, `in_progress`, `planned` |
| Medications | 2 (current/former split) | `` [data-med-list="${group}"] `` for `current`, `former` |
| Recipes, To-Do, Shopping List, Notes, Resume & Portfolio | 1 (flat list, already single-container) | `#recipes-list`, `#todo-list`, `#shopping-list`, `#notes-list`, `#resume-list` |

Recommended (not mandatory-signature) shared helper, following this codebase's own precedent
of generalizing a repeated shape into one helper (`compareByField`/`renderChipFilter`), rather
than writing the same capture/restore logic nine times:

```js
// `lists` is an array of one or more <ul> elements to search — flat-list
// collections pass a 1-element array, status-column collections pass one
// element per status/group.
function captureOpenEdit(lists, formSelector, fieldSelectors) {
  for (const list of lists) {
    if (!list) continue;
    const form = list.querySelector(`${formSelector}:not([hidden])`);
    if (!form) continue;
    const card = form.closest('[data-record-id]');
    const captured = { id: card.dataset.recordId };
    Object.entries(fieldSelectors).forEach(([key, selector]) => {
      captured[key] = form.querySelector(selector).value;
    });
    return captured;
  }
  return null;
}
```

This requires every card's root `<li>` to expose a stable `data-record-id` attribute (Notes
currently uses `dataset.noteId` specifically). **Bob's implementation choice, not mandated
either way:** either (a) standardize all nine cards, including retrofitting Notes' existing
`note-card.dataset.noteId` to `data-record-id`, so one shared helper truly serves all nine, or
(b) keep Notes' existing attribute name as-is and either parameterize the helper with a
per-collection dataset key, or simply replicate Notes' inline capture/restore style per
collection (which is what Notes itself does today — it doesn't use an extracted helper either).
Both are behaviorally equivalent; pick whichever is less risk to the already-working Notes
code.

### 6.1 Per-collection Edit-button exclusivity, widened the same way

The existing Notes behavior ("clicking Edit closes any other note's open form first") must be
replicated per new collection, **searching across that collection's own multiple containers**
(§ table above) — e.g., opening Edit on a Book card in the "owned_unread" column must close an
already-open Book edit form sitting in the "currently_reading" column (same collection,
different column) — but must never touch an open Notes (or any other collection's) edit form.
This is the concrete mechanical expression of the Architect's per-collection decision.

---

## 7. Edge cases

### 7.1 Undo/redo targets a record changed or deleted elsewhere since the action was recorded

**No confirmation dialog — proceed anyway.** Researcher §4 already traced the worst case as
safe: because the client never bumps `version` (only the server/import-merge does), an
undo/redo action is byte-for-byte indistinguishable from any other local edit to the sync
algorithm. If another device's edit/delete has already pushed a newer `version` to the server
by the time this device's undo/redo syncs, `merge_collection()`/`_content_matches()` on the
server treats it as a genuine conflict and keeps **both** — the server's version untouched,
this device's version as a new duplicate record — never a silent overwrite, never silent data
loss. This is the exact same "confusing-but-safe" outcome this app already ships and already
surfaces via the sync status line's conflict message
(`setSyncStatus('Synced — N conflicts merged as duplicates...')`). **No new UI copy is
required** — the existing conflict-surfacing mechanism already covers this generically,
regardless of whether the cause of a given conflict was an old undo/redo or an ordinary edit
collision. Adding a new confirmation dialog before Undo/Redo would be new, unrequested
friction (CLAUDE.md: keep scope tight).

One sub-case not fully covered by "safe worst-case is a duplicate": if the record's `id` is
**entirely absent** from `SYNC_COLLECTIONS[...].get()` at apply time (not just tombstoned —
truly missing), `applyEntrySnapshot` finds `record === undefined` and returns without doing
anything (§3.2's `if (!record) return;`). Per current code, this should not actually be
reachable under today's sync/import design — `deleteX` only ever tombstones (never splices),
`runSync()`'s `c.set(incoming)` replaces the array with the server's data but the server never
drops rows either (same "never silently discard" invariant), and `mergeCollectionFromImport`
only ever adds/updates/duplicates, never removes. Still: the engine must not throw if this
somehow happens — it silently no-ops that one apply (the entry is still popped off its source
stack and not re-pushed to the opposite stack in this specific dead-record case, since there's
nothing meaningful left to reverse). **Flagging this as a defensive guard against a case that
shouldn't occur given the current architecture, not a scenario expected to happen in practice.**

### 7.2 Undo/Redo clicked while a record's edit form happens to be open

**No new special-case UI — rely on the same re-render mechanism that already exists.**
`applyEntrySnapshot` (or `deleteX`/`restoreX`) ends by calling `cfg.render()`, which is the
exact same `renderX()` every search/sort/filter/sync/import call already triggers. The
existing (or newly-generalized, §6) capture/restore-open-edit-form logic runs on every
`renderX()` call regardless of what triggered it:

- **Undo/redo affects a different record than the one being edited:** that other card
  re-renders with its new values; the open edit form (keyed by id, not DOM position) is
  preserved untouched, exactly as it is today when e.g. the sort dropdown changes.
- **Undo/redo affects the very record currently being edited:** the capture step reads the
  **live, in-progress, unsaved values straight out of the open form's DOM inputs** (that's
  what `captureOpenEdit` always does — it never reads from the record itself). So the user's
  unsaved in-progress edit is preserved untouched by the undo, exactly as it would be
  preserved across any other re-render today. The user will see the new (post-undo) committed
  value once they Cancel (returning to the view block) or Save (which would then overwrite the
  undone value with whatever they were mid-typing — an accepted, unforced consequence of "no
  new special-case behavior," not a new bug introduced by this feature; the same race already
  exists today between two browser tabs editing the same note).

### 7.3 Tab-switching on undo/redo

**Explicitly not auto-switching the active tab.** If the user undoes a Books action while
viewing the Notes tab, the fix applies correctly in the background (in-memory array +
`localStorage` + a hidden-but-still-rendered DOM update) — the user sees it whenever they next
visit the Books tab. Auto-navigating the user away from what they're currently looking at
would be a surprising, unrequested UI behavior change (CLAUDE.md: keep scope tight). **Flagging
this as an assumption**, not something explicitly settled by the Researcher or the task
description either way — easy to revisit if the Architect wants different behavior.

---

## 8. Notes' `stampSync()` inconsistency

`updateNote()` currently manually inlines what `stampSync()` already does:

```js
// current
const now = new Date().toISOString();
note.title = trimmedTitle;
note.body = trimmedBody;
note.dateModified = now;
note.updatedAt = now;
note.deviceId = getDeviceId();
```

Change to:

```js
// required
const before = structuredClone(note);
note.title = trimmedTitle;
note.body = trimmedBody;
note.dateModified = new Date().toISOString(); // Notes-specific field, kept as its own step
stampSync(note); // sets updatedAt + deviceId via the shared helper
saveCollection(NOTES_KEY, notes);
recordUndo('notes', id, before, structuredClone(note));
renderNotes();
return { ok: true };
```

Accepted, negligible side effect: `dateModified` and `updatedAt` are now set by two separate
`new Date().toISOString()` calls a fraction of a millisecond apart instead of sharing one `now`
variable — functionally irrelevant, and arguably more correct since `dateModified` is a
Notes-specific display concept while `updatedAt` is sync bookkeeping; they don't need to be
byte-identical.

---

## Summary of what Bob needs to build

1. Module-level `undoStack`/`redoStack`/`isApplyingHistory`/`MAX_UNDO_DEPTH = 50` (§1).
2. `recordUndo()` (§1.4), wired into all 44 enumerated mutation call sites (§1.5).
3. Nine new `restoreX(id)` functions (§2), plus two new properties (`delete`, `restore`) on
   every `SYNC_COLLECTIONS` entry.
4. `applyEntrySnapshot()`, `undo()`, `redo()` (§3).
5. Undo/Redo buttons in the sidebar, `updateUndoRedoButtons()`/`describeEntry()` (§4).
6. New `.X-view`/`.X-edit-form` markup in all eight non-Notes card `<template>`s, plus eight
   new `updateX(id, fields)` functions, per the exact field/error-element table in §5.
7. Per-collection (not app-wide) open-edit-form exclusivity and capture/restore, widened
   across all list containers for Books/Diagnoses/Coursework/Medications (§6).
8. `updateNote()` calling `stampSync()` instead of inlining it (§8).

## Flagged to the Architect (not decided here, not to be quietly assumed by Bob)

- §5: Notes' "Save doesn't auto-close the form" quirk is being deliberately replicated for
  consistency across all nine collections, not fixed — worth a separate, explicitly-scoped UX
  pass if the Architect wants it fixed, but doing so silently as part of this cycle would be
  scope creep in either direction (fixing it only for the new eight would be inconsistent with
  Notes; fixing it everywhere including Notes wasn't asked for).
- §4: keyboard shortcuts (Ctrl+Z/Ctrl+Y) are out of scope this cycle — flagged so it isn't
  built unprompted, not because it would be wrong to add later.
- §7.3: undo/redo never auto-switches the active tab — an assumption, not something the
  Researcher or task settled explicitly either way.
