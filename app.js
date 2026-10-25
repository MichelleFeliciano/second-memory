// Second Memory — a personal, local-first set of lists (books, recipes, health, to-dos, journal, ...)
// All persistence is local (localStorage). No network calls, no dependencies.
//
// How this file is organised (top to bottom, one section per area):
//   Shared helpers, filter/sort helpers, keyboard-focus keeping, device identity & sync
//   metadata, undo/redo, UI state (active tab), then one section per list: Books, Recipes,
//   Medications, Weight, Diagnoses, To-Do, Shopping List, Notes, Resume &
//   Portfolio, shared date helpers,
//   Journal (plus trends, therapy summary, backup reminders), Search everything, Home,
//   Device Sync, undo/redo application, data export/import, day rollover, theme/text size,
//   Reminders (device notifications), Health summary, App lock, and Init.
//
// Every list is an array of plain records kept in memory and saved whole to its own
// localStorage key. A record looks like:
//   { id, ...its own fields..., dateAdded, updatedAt, deviceId, deleted, version }
// - updatedAt / deviceId are stamped on every change (see stampSync).
// - Deleting never removes a record: it sets deleted:true (a "tombstone") so a later sync
//   can tell "deleted here" apart from "never existed here". Screens skip deleted records.
// - version is the server's counter for the record; 0 means the server hasn't confirmed it yet.
//
// Syncing between devices happens when the user presses "Sync now", and (unless switched off in the Menu) on its
// own: once when the app opens and a few seconds after something changes. A data-free wake-up request also goes to
// the server when the app opens. The journal is the exception to all of the above: it is local-only,
// has no sync fields, and is never synced (it can only be backed up and restored by file).

// ---- Shared helpers ----

// A unique id for a new record (falls back to time + random where randomUUID is missing).
function makeId() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Coursework and Appointments were removed from the app. Clear whatever they left on this device.
['secondMemory.courses.v1', 'secondMemory.deadlines.v1', 'secondMemory.appointments.v1'].forEach((key) => {
  try { localStorage.removeItem(key); } catch { /* storage unavailable: nothing to clear */ }
});

// Reads a saved list from localStorage; anything missing or corrupt becomes an empty list.
function loadCollection(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    // Keep only real records; a stray null or number in the saved list would otherwise crash the load.
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) : [];
  } catch {
    return [];
  }
}

// Shown when the browser refuses to save (storage full, blocked, or private mode).
// Without this the change would stay on screen and quietly vanish on reload.
function reportStorageProblem() {
  if (document.getElementById('storage-warning')) return;
  const box = document.createElement('div');
  box.id = 'storage-warning';
  box.className = 'storage-warning';
  box.setAttribute('role', 'alert');
  const text = document.createElement('span');
  text.textContent = "Couldn't save: this browser's storage is full or blocked. Your latest change is only on " +
    'screen and will be lost if you close or reload. Use Export data, then free up space.';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Dismiss';
  close.addEventListener('click', () => box.remove());
  box.append(text, close);
  document.body.appendChild(box);
}

// Writes a whole list to localStorage. Returns false (and shows the warning) if the browser refuses.
function saveCollection(key, items) {
  try {
    localStorage.setItem(key, JSON.stringify(items));
    scheduleSyncPending();
    return true;
  } catch {
    reportStorageProblem();
    return false;
  }
}

// ---- Shared filter/sort helpers ----
// Reused by every collection's sort <select> and chip filter so the
// null-last convention and chip-grouping logic are implemented once instead
// of per comparator/filter.

// Builds a comparator for Array.prototype.sort() from a value-extractor.
// Missing values (null/undefined/empty string — never a falsy-but-real value
// like 0) always sort last, regardless of `direction`. `direction` is 1 for
// ascending, -1 for descending. By default, string values compare
// case-insensitively via localeCompare (for genuine text fields like title/
// author/name). Pass `{ text: false }` for ISO date/timestamp strings (and
// numbers) so they compare directly with `<`/`>` instead — locale collation
// is unnecessary for fixed-format dates and safer to avoid entirely. Sorts a
// fresh, already-filtered array — never mutates it in a way that touches the
// underlying collection's insertion order.
function compareByField(getValue, direction = 1, { text = true } = {}) {
  return (a, b) => {
    const valueA = getValue(a);
    const valueB = getValue(b);
    const missingA = valueA === null || valueA === undefined || valueA === '';
    const missingB = valueB === null || valueB === undefined || valueB === '';
    if (missingA && missingB) return 0;
    if (missingA) return 1;
    if (missingB) return -1;
    if (text && typeof valueA === 'string' && typeof valueB === 'string') {
      return direction * valueA.localeCompare(valueB, undefined, { sensitivity: 'base' });
    }
    if (valueA < valueB) return -direction;
    if (valueA > valueB) return direction;
    return 0;
  };
}

// Trims and case-folds a free-text chip value so near-duplicates ("Fall
// 2026" vs. "fall 2026 ") group into one chip instead of two.
function normalizeChipKey(value) {
  return (typeof value === 'string' ? value : '').trim().toLowerCase();
}

// Derives the distinct chip groups from a live, non-deleted array: one entry
// per normalized key, displayed using the first-seen original casing/spacing
// for that group, sorted alphabetically. Blank/missing values are excluded —
// the caller adds the "All" option on top of this.
function deriveChipOptions(items, getValue) {
  const byKey = new Map();
  items.forEach((item) => {
    const value = getValue(item);
    const raw = (typeof value === 'string' ? value : '').trim();
    if (!raw) return;
    const key = normalizeChipKey(raw);
    if (!byKey.has(key)) byKey.set(key, raw);
  });
  return [...byKey.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

// Shared chip-filter renderer (dynamic category-like chips and fixed
// boolean-toggle chips alike): renders one chip per option, auto-resets the
// current selection to 'all' if it disappeared from `options` (e.g. the last
// item with that value was deleted), and wires click handlers via the
// caller's own get/set for its module-level selection variable. `options`
// must include the `{ key: 'all', label: 'All' }` entry itself.
function renderChipFilter(container, options, getSelected, setSelected, onSelect) {
  if (!container) return;
  const keys = options.map((o) => o.key);
  if (getSelected() !== 'all' && !keys.includes(getSelected())) {
    setSelected('all');
  }

  container.innerHTML = '';
  options.forEach(({ key, label }) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = label;
    chip.classList.toggle('chip-active', getSelected() === key);
    chip.setAttribute('aria-pressed', String(getSelected() === key));
    chip.addEventListener('click', () => {
      setSelected(key);
      onSelect();
    });
    container.appendChild(chip);
  });
}

// ---- Keep keyboard focus when a list redraws ----
// Every screen rebuilds its cards from scratch after a change. That used to throw away the
// control you were on (tick a to-do box with Space and focus fell back to the top of the page).
// withFocusRestore() remembers which control had focus, lets the screen redraw, then puts
// focus back on the equivalent control in the new cards.

// What counts as one card/row when working out where focus was.
const FOCUS_UNIT = 'li, tr';

// A control's visible text with whitespace collapsed, used to recognise it after a redraw.
function focusText(node) {
  return (node.textContent || '').replace(/\s+/g, ' ').trim();
}

// A fingerprint of what kind of control this is (tag, classes, label, input type). The
// "selected" class is left out: pressing a chip switches it on, which must not make it a different kind.
function focusKind(node) {
  const classes = [...node.classList].filter((c) => c !== 'chip-active').sort().join('.');
  return [node.tagName, classes, node.getAttribute('aria-label') || '', node.type || ''].join('|');
}

// Identifies one card/row by its date (calendar cells) and the start of its text. Recipe and book
// cards are matched by id instead, because their text changes while the control is used (the
// scale buttons rewrite the amounts, Pin rewrites its own label) and the card would not be found.
function focusUnitSignature(unit) {
  const stableId = unit.dataset.recipeId || unit.dataset.bookId;
  if (stableId) return 'id:' + stableId;
  return (unit.dataset.dateKey || '') + '|' + focusText(unit).slice(0, 160);
}

// Notes down which control currently has focus (and where it sits) so it can be found again
// after the screen redraws. Returns null when focus isn't inside a list screen.
function describeFocus() {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  const section = el.closest('[id$="-collection"]');
  if (!section) return null;
  const chip = el.closest('.chip');
  if (chip && chip.parentElement && chip.parentElement.id) {
    return { sectionId: section.id, mode: 'chip', containerId: chip.parentElement.id, label: focusText(chip) };
  }
  const unit = el.closest(FOCUS_UNIT);
  if (unit && section.contains(unit)) {
    const units = [...section.querySelectorAll(FOCUS_UNIT)];
    const signature = focusUnitSignature(unit);
    const unitIndex = units.indexOf(unit);
    const kind = focusKind(el);
    return {
      sectionId: section.id,
      mode: 'unit',
      signature,
      sameBefore: units.slice(0, unitIndex).filter((u) => focusUnitSignature(u) === signature).length,
      unitIndex,
      kind,
      controlIndex: Math.max(0, [...unit.querySelectorAll('*')].filter((n) => focusKind(n) === kind).indexOf(el)),
    };
  }
  if (el.id) return { sectionId: section.id, mode: 'id', id: el.id };
  return { sectionId: section.id, mode: 'loose', kind: focusKind(el), label: focusText(el) };
}

// Puts focus back on the control described by describeFocus, trying the closest match first.
function restoreFocus(d) {
  if (!d) return;
  const active = document.activeElement;
  // Something already put focus back.
  if (active && active !== document.body && document.contains(active)) return;
  const section = document.getElementById(d.sectionId);
  if (!section || section.hidden) return;
  let target = null;
  if (d.mode === 'chip') {
    const container = document.getElementById(d.containerId);
    const chips = container ? [...container.querySelectorAll('.chip')] : [];
    target = chips.find((c) => focusText(c) === d.label) || chips[0] || null;
  } else if (d.mode === 'id') {
    target = document.getElementById(d.id);
  } else if (d.mode === 'unit') {
    const units = [...section.querySelectorAll(FOCUS_UNIT)];
    const same = units.filter((u) => focusUnitSignature(u) === d.signature);
    const unit = same[d.sameBefore] || same[0] || null;
    if (unit) {
      const matches = [...unit.querySelectorAll('*')].filter((n) => focusKind(n) === d.kind);
      target = matches[d.controlIndex] || matches[0] || null;
    } else if (units.length) {
      // The card is gone (deleted, or filtered out). Land on the first control of the card now
      // in its place, never on its Delete button, so pressing Enter again can't remove the next item.
      const next = units[Math.min(d.unitIndex, units.length - 1)];
      target = next.querySelector('input:not([type=hidden]), select, textarea, a[href], button:not(.delete-btn)');
    }
  } else if (d.mode === 'loose') {
    target = [...section.querySelectorAll('button, input, select, textarea, a[href]')]
      .find((n) => focusKind(n) === d.kind && focusText(n) === d.label) || null;
  }
  if (target && !target.disabled && !target.hidden) target.focus({ preventScroll: true });
}

// Wraps a render function so keyboard focus survives the redraw.
function withFocusRestore(render) {
  return function wrappedRender(...args) {
    const snapshot = describeFocus();
    const result = render.apply(this, args);
    restoreFocus(snapshot);
    return result;
  };
}

// Used after the user jumps to another screen from Home or the reminder banner, so keyboard
// and screen-reader users land on the new screen instead of a control that just disappeared.
function focusSectionHeading(tab) {
  const heading = document.querySelector(`#${tab}-collection h2`);
  if (!heading) return;
  heading.tabIndex = -1;
  heading.focus();
}

// Switches screen and moves keyboard focus to its heading.
function goToTab(tab) {
  setActiveTab(tab);
  focusSectionHeading(tab);
}

// Install the focus-keeping wrappers (function declarations are hoisted, so this is safe at the top).
renderBooks = withFocusRestore(renderBooks);
renderRecipes = withFocusRestore(renderRecipes);
renderNotes = withFocusRestore(renderNotes);
renderLinks = withFocusRestore(renderLinks);
renderJournalTrends = withFocusRestore(renderJournalTrends);
renderJournal = withFocusRestore(renderJournal);


// ---- Device identity & sync metadata ----

const DEVICE_KEY = 'secondMemory.device.v1';
let cachedDeviceId = null;

// This browser's permanent random id (created on first use); stamped onto every record it edits.
function getDeviceId() {
  if (cachedDeviceId) return cachedDeviceId;
  try {
    const raw = localStorage.getItem(DEVICE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed.deviceId === 'string') {
      cachedDeviceId = parsed.deviceId;
      return cachedDeviceId;
    }
  } catch {
    // fall through and generate a new one
  }
  cachedDeviceId = makeId();
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify({ deviceId: cachedDeviceId, createdAt: new Date().toISOString() }));
  } catch {
    // Storage unavailable: this device id just won't persist across reloads.
  }
  return cachedDeviceId;
}

// Marks a record as just changed on this device. Call on every add/edit/delete/restore.
function stampSync(record) {
  record.updatedAt = new Date().toISOString();
  record.deviceId = getDeviceId();
}

// Backfills sync metadata onto records written before sync existed. Presence
// checks (not truthiness) so it's idempotent and never re-derives a value
// that's already there. `version: 0` means "never confirmed by the server."
function migrateSyncFields(items, key, deviceId) {
  let changed = false;
  items.forEach((item) => {
    if (!('updatedAt' in item)) {
      // Oldest records only had dateModified (Notes) or dateAdded; reuse whichever exists.
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
    if (!('version' in item)) {
      item.version = 0;
      changed = true;
    }
  });
  if (changed) saveCollection(key, items);
  return items;
}

// ---- Undo/Redo ----
// In-memory only, never persisted. One entry per changed record (never a
// whole-array snapshot).

// Each entry is { collection, id, before, after, timestamp }; before is null for a brand-new record.
let undoStack = [];
let redoStack = [];
let isApplyingHistory = false; // guard: undo/redo replays never re-record themselves
const MAX_UNDO_DEPTH = 50;

// ---- Undo toast ----
// A short message with an Undo button, shown for a few seconds after something is deleted
// (the Undo button in the Menu is easy to miss, especially on a phone where the Menu is folded away).

let toastTimer = null;

// Shows the toast; withUndo adds the Undo button. A newer toast replaces an older one.
function showToast(message, withUndo) {
  document.getElementById('toast-text').textContent = message;
  document.getElementById('toast-undo').hidden = !withUndo;
  document.getElementById('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 7000);
}

// Hides the toast (also called when anything else is done, so it never offers a stale Undo).
function hideToast() {
  clearTimeout(toastTimer);
  document.getElementById('toast').hidden = true;
}

document.getElementById('toast-undo').addEventListener('click', () => {
  undo();
  hideToast();
});


// Remembers one change (the record before and after) so it can be undone; clears the redo list.
function recordUndo(collectionName, id, before, after) {
  if (isApplyingHistory) return;
  undoStack.push({
    collection: collectionName,
    id,
    before: before === null ? null : structuredClone(before),
    after: structuredClone(after),
    timestamp: new Date().toISOString(),
  });
  if (undoStack.length > MAX_UNDO_DEPTH) undoStack.shift();
  redoStack = [];
  updateUndoRedoButtons();
  // A delete offers an immediate Undo; any other change clears an older offer.
  if (before !== null && after.deleted && !before.deleted) {
    const said = describeEntry(undoStack[undoStack.length - 1]);
    showToast(said.charAt(0).toUpperCase() + said.slice(1), true);
  } else {
    hideToast();
  }
}

// ---- UI state (active tab) ----

const UI_STORAGE_KEY = 'secondMemory.ui.v1';
// Every screen id; each has a matching "<id>-collection" section and a sidebar button.
const TABS = ['home', 'passwords', 'books', 'recipes', 'journal', 'notes', 'resume'];

// Reads the saved screen state (which tab was open), tolerating missing or damaged data.
function loadUiState() {
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch {
    return {};
  }
}

// Remembers which tab is open so the app reopens on it.
function saveUiState(state) {
  try {
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(state));
  } catch { /* storage full or blocked: the screen still switches, it just is not remembered */ }
}

// Shows one screen and hides the rest (unknown names fall back to Home); closes the phone sidebar.
function setActiveTab(tab) {
  const activeTab = TABS.includes(tab) ? tab : 'home';
  const showingJournal = activeTab === 'journal';
  TABS.forEach((t) => {
    document.getElementById(`${t}-collection`).hidden = t !== activeTab;
    const navItem = document.querySelector(`.nav-item[data-tab="${t}"]`);
    navItem.classList.toggle('active', t === activeTab);
    if (t === activeTab) navItem.setAttribute('aria-current', 'page'); else navItem.removeAttribute('aria-current');
  });
  // Phone bottom bar: highlight the current screen when it is one of the four shortcuts.
  document.querySelectorAll('.bottom-bar [data-quick-tab]').forEach((btn) => {
    const on = btn.dataset.quickTab === activeTab;
    btn.classList.toggle('active', on);
    if (on) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
  });
  saveUiState({ activeTab });
  if (showingJournal) renderJournal(); // the tab is visible now, so widths (and the scroll position) are real
  if (activeTab === 'passwords') renderVault(); // shows create, locked or open depending on the vault

  if (window.matchMedia('(max-width: 700px)').matches) {
    const sidebar = document.querySelector('.sidebar');
    sidebar.classList.remove('sidebar-open');
    const toggleBtn = document.getElementById('sidebar-toggle');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
  }
}

// Phone bottom bar: the shortcut buttons switch screens; Menu opens the folded-away sidebar at the top.
document.querySelectorAll('.bottom-bar [data-quick-tab]').forEach((btn) => {
  btn.addEventListener('click', () => setActiveTab(btn.dataset.quickTab));
});
document.getElementById('bottom-more').addEventListener('click', () => {
  if (!document.querySelector('.sidebar').classList.contains('sidebar-open')) document.getElementById('sidebar-toggle').click();
  window.scrollTo({ top: 0 });
});

// Sidebar buttons: each switches to its screen.
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
});

// Phone menu button: opens/closes the sidebar and tells screen readers which state it is in.
const sidebarToggleBtn = document.getElementById('sidebar-toggle');
if (sidebarToggleBtn) {
  sidebarToggleBtn.addEventListener('click', () => {
    const sidebar = document.querySelector('.sidebar');
    const isOpen = sidebar.classList.toggle('sidebar-open');
    sidebarToggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });
}

// ---- Books ----

const BOOKS_KEY = 'secondMemory.books.v1';
// Shelves that count as "finished" for the reading goal and get a finished date.
const READ_STATUSES = ['owned_read', 'jons_bookshelf_read'];
// Every shelf a book can be on; stored in each book's status field (also the order of the columns).
const BOOK_STATUSES = ['want_to_buy', 'owned_unread', 'currently_reading', 'owned_read', 'textbook', 'textbook_read', 'jons_bookshelf', 'jons_bookshelf_read'];

let books = migrateSyncFields(loadCollection(BOOKS_KEY), BOOKS_KEY, getDeviceId());

// Adds a book to the list; a blank title is refused (returns false).
function addBook(title, author, status) {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) return false;
  const now = new Date().toISOString();
  const book = {
    id: makeId(),
    title: trimmedTitle,
    author: author.trim(),
    status: BOOK_STATUSES.includes(status) ? status : 'want_to_buy',
    rating: null,
    dateFinished: READ_STATUSES.includes(status) ? todayKey() : null,
    dateAdded: now,
    updatedAt: now,
    deviceId: getDeviceId(),
    deleted: false,
    version: 0,
  };
  books.push(book);
  saveCollection(BOOKS_KEY, books);
  recordUndo('books', book.id, null, structuredClone(book));
  renderBooks();
  return true;
}

// Moves a book to another shelf (status), e.g. from owned/unread to owned/read.
function updateBookStatus(id, newStatus) {
  const book = books.find((b) => b.id === id);
  if (!book || !BOOK_STATUSES.includes(newStatus)) return;
  const before = structuredClone(book);
  book.status = newStatus;
  if (newStatus !== 'owned_read') book.rating = null;
  // Moving onto a read shelf stamps today as the finished date (unless it already has one);
  // moving off a read shelf clears it.
  if (READ_STATUSES.includes(newStatus)) {
    if (!isRealDateKey(book.dateFinished)) book.dateFinished = todayKey();
  } else {
    book.dateFinished = null;
  }
  stampSync(book);
  saveCollection(BOOKS_KEY, books);
  recordUndo('books', id, before, structuredClone(book));
  renderBooks();
}

// Sets a book's star rating.
function updateBookRating(id, rating) {
  const book = books.find((b) => b.id === id);
  if (!book) return;
  const before = structuredClone(book);
  book.rating = rating ? Number(rating) : null;
  stampSync(book);
  saveCollection(BOOKS_KEY, books);
  recordUndo('books', id, before, structuredClone(book));
}

// Soft-deletes a book (keeps a tombstone so syncing can tell it was deleted).
function deleteBook(id) {
  const book = books.find((b) => b.id === id);
  if (!book) return;
  const before = structuredClone(book);
  book.deleted = true;
  stampSync(book);
  saveCollection(BOOKS_KEY, books);
  recordUndo('books', id, before, structuredClone(book));
  renderBooks();
}

// Brings a deleted book back (used by undo).
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

// Saves edits to a book's title and author; a blank title is refused (returns false).
function updateBook(id, fields) {
  const book = books.find((b) => b.id === id);
  if (!book) return;
  const trimmedTitle = fields.title.trim();
  if (!trimmedTitle) return false;
  // The finished date is only edited when the form offers it (a read shelf); blank clears it.
  // It is checked BEFORE anything changes, so a refused edit leaves the book exactly as it was.
  let newFinished;
  if (fields.dateFinished !== undefined) {
    if (fields.dateFinished === '') newFinished = null;
    else if (isRealDateKey(fields.dateFinished) && fields.dateFinished <= todayKey()) newFinished = fields.dateFinished;
    else return false;
  }
  const before = structuredClone(book);
  book.title = trimmedTitle;
  book.author = fields.author.trim();
  if (fields.dateFinished !== undefined) book.dateFinished = newFinished;
  stampSync(book);
  saveCollection(BOOKS_KEY, books);
  recordUndo('books', id, before, structuredClone(book));
  renderBooks();
}

// True if the search text appears in the book's title or author (an empty search matches all).
function matchesBookSearch(book, term) {
  if (!term) return true;
  const haystack = `${book.title} ${book.author || ''}`.toLowerCase();
  return haystack.includes(term.toLowerCase());
}

// The chosen sort for the Books screen; 'author_asc' is the default.
let selectedBooksSort = 'author_asc';

// Sort options by the value of the Books sort dropdown.
const BOOK_SORTS = {
  author_asc: compareByField((b) => (b.author || '').trim(), 1),
  title_asc: compareByField((b) => b.title, 1),
  date_added_desc: compareByField((b) => b.dateAdded, -1, { text: false }),
  date_added_asc: compareByField((b) => b.dateAdded, 1, { text: false }),
};

// Fills in the count summary at the top of the Books screen.
function renderBooksStats(nonDeletedBooks) {
  const el = document.getElementById('books-stats');
  if (!el) return;
  const total = nonDeletedBooks.length;
  const countFor = (status) => nonDeletedBooks.filter((b) => b.status === status).length;
  el.textContent = `${total} book${total === 1 ? '' : 's'} · ${countFor('want_to_buy')} want to buy · ` +
    `${countFor('owned_unread')} unread · ${countFor('currently_reading')} currently reading · ` +
    `${countFor('owned_read')} read · ${countFor('textbook')} textbooks (unread) · ` +
    `${countFor('textbook_read')} textbooks (read) · ` +
    `${countFor('jons_bookshelf')} on Jon's Bookshelf (unread) · ${countFor('jons_bookshelf_read')} on Jon's Bookshelf (read)`;
}

// ---- Reading goal ----
// A yearly goal ("12 of 24 books") counted from the finished dates on books on a read shelf.
// Goals are kept on this device, one per year, and travel in the full backup.

const READING_GOALS_KEY = 'secondMemory.readingGoals.v1';

// The saved goals as { '2026': 24 }; anything damaged is dropped.
function loadReadingGoals() {
  const goals = {};
  try {
    const parsed = JSON.parse(localStorage.getItem(READING_GOALS_KEY) || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      Object.entries(parsed).forEach(([year, n]) => {
        if (/^\d{4}$/.test(year) && Number.isInteger(n) && n > 0 && n <= 1000) goals[year] = n;
      });
    }
  } catch { /* unreadable: no goals */ }
  return goals;
}

// Sets (a whole number) or clears (null) the goal for one year. Returns false if it could not be saved.
function saveReadingGoal(year, count) {
  const goals = loadReadingGoals();
  if (count === null) delete goals[String(year)]; else goals[String(year)] = count;
  try {
    localStorage.setItem(READING_GOALS_KEY, JSON.stringify(goals));
    return true;
  } catch {
    return false;
  }
}

// How many of these books were finished in the year (read shelf plus a finished date in that year).
function booksFinishedInYear(list, year) {
  return list.filter((b) => !b.deleted && READ_STATUSES.includes(b.status)
    && typeof b.dateFinished === 'string' && b.dateFinished.startsWith(`${year}-`)).length;
}

// Redraws the goal box: the count, the progress bar, the "no finish date" hint and the goal field.
function renderReadingGoal(nonDeletedBooks) {
  const year = new Date().getFullYear();
  const done = booksFinishedInYear(nonDeletedBooks, year);
  const goal = loadReadingGoals()[String(year)] || null;
  const text = document.getElementById('reading-goal-text');
  const bar = document.getElementById('reading-goal-bar');
  if (goal) {
    text.textContent = done >= goal
      ? `${year}: ${done} of ${goal} books finished. Goal reached!`
      : `${year}: ${done} of ${goal} books finished (${goal - done} to go)`;
    bar.max = goal;
    bar.value = Math.min(done, goal);
    bar.hidden = false;
  } else {
    text.textContent = `${year}: ${done} book${done === 1 ? '' : 's'} finished. Set a goal to track your progress.`;
    bar.hidden = true;
  }
  const undated = nonDeletedBooks.filter((b) => READ_STATUSES.includes(b.status) && !isRealDateKey(b.dateFinished)).length;
  const hint = document.getElementById('reading-goal-undated');
  hint.hidden = undated === 0;
  if (undated > 0) hint.textContent = `${undated} finished book${undated === 1 ? ' has' : 's have'} no finish date, so ${undated === 1 ? 'it is' : 'they are'} not counted. Tap Edit on a book to add one.`;
  document.getElementById('reading-goal-label').textContent = `Books to read in ${year}`;
  const input = document.getElementById('reading-goal-input');
  if (document.activeElement !== input) input.value = goal === null ? '' : String(goal);
}

// Set goal: accepts a whole number from 1 to 1000 for this year and shows a message otherwise.
document.getElementById('reading-goal-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('reading-goal-error');
  const raw = document.getElementById('reading-goal-input').value.trim();
  const value = Number(raw);
  if (raw === '' || !Number.isInteger(value) || value < 1 || value > 1000) {
    errorEl.textContent = 'Enter a whole number from 1 to 1000, or tap Clear.';
    errorEl.hidden = false;
    return;
  }
  errorEl.hidden = true;
  if (!saveReadingGoal(new Date().getFullYear(), value)) {
    errorEl.textContent = 'Could not save the goal (the browser refused to store it).';
    errorEl.hidden = false;
    return;
  }
  renderReadingGoal(books.filter((b) => !b.deleted));
});

// Clear: removes this year's goal.
document.getElementById('reading-goal-clear').addEventListener('click', () => {
  const errorEl = document.getElementById('reading-goal-error');
  errorEl.hidden = true;
  if (!saveReadingGoal(new Date().getFullYear(), null)) {
    errorEl.textContent = 'Could not clear the goal (the browser refused to store it).';
    errorEl.hidden = false;
    return;
  }
  document.getElementById('reading-goal-input').value = '';
  renderReadingGoal(books.filter((b) => !b.deleted));
});

// Redraws the whole Books screen: filter, search, sort and the book cards.
function renderBooks() {
  const searchTerm = document.getElementById('books-search-input').value;
  const nonDeleted = books.filter((b) => !b.deleted);
  const visible = nonDeleted.filter((b) => matchesBookSearch(b, searchTerm));
  const comparator = BOOK_SORTS[selectedBooksSort] || BOOK_SORTS.author_asc;
  const template = document.getElementById('books-card-template');

  renderBooksStats(nonDeleted);

  // One <ul> per shelf, in BOOK_STATUSES order (index-matched with the forEach below).
  const lists = BOOK_STATUSES.map((status) => document.querySelector(`[data-list="${status}"]`));

  // Read any in-progress (unsaved) edit straight from the live DOM, across
  // every status column, before wiping them out below.
  let openEdit = null;
  for (const list of lists) {
    const openForm = list.querySelector('.book-edit-form:not([hidden])');
    if (openForm) {
      openEdit = {
        id: openForm.closest('.book-card').dataset.bookId,
        title: openForm.querySelector('.book-edit-title').value,
        author: openForm.querySelector('.book-edit-author').value,
        finished: openForm.querySelector('.book-edit-finished').value,
      };
      break;
    }
  }

  BOOK_STATUSES.forEach((status, index) => {
    const list = lists[index];
    list.innerHTML = '';
    // .sort() is a stable sort in all modern JS engines (ES2019+), so books
    // with equal sort keys (e.g. same author, entered in a deliberate order
    // like a series) keep their relative order. `visible` is a fresh array
    // from .filter(), so sorting it never touches the underlying `books`
    // array or its order.
    const itemsForStatus = visible.filter((b) => b.status === status).sort(comparator);
    document.querySelector(`[data-count="${status}"]`).textContent = itemsForStatus.length;

    itemsForStatus.forEach((book) => {
      const node = template.content.cloneNode(true);
      const card = node.querySelector('.book-card');
      card.dataset.bookId = book.id;
      const viewSection = node.querySelector('.book-view');
      const editForm = node.querySelector('.book-edit-form');

      node.querySelector('.book-title').textContent = book.title;
      node.querySelector('.book-author').textContent = book.author || '';
      const finishedEl = node.querySelector('.book-finished');
      if (READ_STATUSES.includes(book.status) && isRealDateKey(book.dateFinished)) {
        finishedEl.textContent = `Finished ${formatDateKeyLong(book.dateFinished)}`;
        finishedEl.hidden = false;
      }
      // The finished-date box only exists in the edit form of books on a read shelf.
      const finishedField = node.querySelector('.book-edit-finished-field');
      const showFinished = READ_STATUSES.includes(book.status);
      finishedField.hidden = !showFinished;

      const ratingLabel = node.querySelector('.rating-label');
      const ratingSelect = node.querySelector('.rating-select');
      const ratingDisplay = node.querySelector('.book-rating');

      // Only the plain "read" shelf is rated (moving off it clears the rating).
      if (status === 'owned_read') {
        ratingLabel.hidden = false;
        ratingSelect.value = book.rating ? String(book.rating) : '';
        ratingDisplay.textContent = book.rating ? '★'.repeat(book.rating) : '';
        ratingSelect.addEventListener('change', (e) => {
          updateBookRating(book.id, e.target.value);
          ratingDisplay.textContent = e.target.value ? '★'.repeat(Number(e.target.value)) : '';
        });
      }

      const moveSelect = node.querySelector('.move-select');
      moveSelect.value = book.status;
      moveSelect.addEventListener('change', (e) => updateBookStatus(book.id, e.target.value));

      const editTitleInput = node.querySelector('.book-edit-title');
      const editAuthorInput = node.querySelector('.book-edit-author');
      const editFinishedInput = node.querySelector('.book-edit-finished');
      editFinishedInput.max = todayKey(); // a book cannot be finished in the future

      node.querySelector('.edit-btn').addEventListener('click', () => {
        // Only one book (across every status column) can be in edit mode at
        // a time — close any other open book edit form first.
        lists.forEach((otherList) => {
          const otherOpenForm = otherList.querySelector('.book-edit-form:not([hidden])');
          if (otherOpenForm && otherOpenForm !== editForm) {
            otherOpenForm.hidden = true;
            otherOpenForm.closest('.book-card').querySelector('.book-view').hidden = false;
          }
        });
        editTitleInput.value = book.title;
        editAuthorInput.value = book.author || '';
        editFinishedInput.value = book.dateFinished || '';
        viewSection.hidden = true;
        editForm.hidden = false;
      });

      node.querySelector('.cancel-btn').addEventListener('click', () => {
        editForm.hidden = true;
        viewSection.hidden = false;
      });

      editForm.addEventListener('submit', (e) => {
        e.preventDefault();
        // Hide the form BEFORE calling updateBook — if the save succeeds,
        // updateBook's internal re-render captures "is there an open edit
        // form" from live DOM state, and must see this one as already
        // closed, or it reopens the very form that just successfully saved
        // (confirmed bug: the data saved correctly but the form stayed
        // open, indistinguishable from the button doing nothing). This same
        // fix is applied at every collection's edit-form submit handler.
        editForm.hidden = true;
        viewSection.hidden = false;
        const fields = { title: editTitleInput.value, author: editAuthorInput.value };
        if (showFinished) fields.dateFinished = editFinishedInput.value;
        if (updateBook(book.id, fields) === false) {
          viewSection.hidden = true;
          editForm.hidden = false;
        }
      });

      node.querySelector('.delete-btn').addEventListener('click', () => deleteBook(book.id));

      if (openEdit && openEdit.id === book.id) {
        editTitleInput.value = openEdit.title;
        editAuthorInput.value = openEdit.author;
        editFinishedInput.value = openEdit.finished;
        viewSection.hidden = true;
        editForm.hidden = false;
      }

      list.appendChild(node);
    });
  });

  document.getElementById('books-empty-state').hidden = nonDeleted.length !== 0;
  renderReadingGoal(nonDeleted);

  renderHome(); // Home aggregates books/todos/medications — keep this in sync
}

// Add book: clears the title/author boxes only if it was saved (keeps the chosen shelf for the next one).
document.getElementById('books-add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const titleInput = document.getElementById('books-title-input');
  const authorInput = document.getElementById('books-author-input');
  const statusInput = document.getElementById('books-status-input');
  if (addBook(titleInput.value, authorInput.value, statusInput.value)) {
    titleInput.value = '';
    authorInput.value = '';
  }
  titleInput.focus();
});

// Search box: filters the cards as you type.
document.getElementById('books-search-input').addEventListener('input', renderBooks);

// Sort dropdown: remembers the choice and redraws.
document.getElementById('books-sort-input').addEventListener('change', (e) => {
  selectedBooksSort = e.target.value;
  renderBooks();
});

// ---- Recipes ----

const RECIPES_KEY = 'secondMemory.recipes.v1';

let recipes = migrateSyncFields(loadCollection(RECIPES_KEY), RECIPES_KEY, getDeviceId());

// ---- Recipe list (add, edit, delete, search, screen) ----

// Turns a block of text into a list of non-empty trimmed lines.
function splitLines(text) {
  return text.split('\n').map((s) => s.trim()).filter(Boolean);
}

// Adds a recipe (ingredients and steps are typed one per line); a blank title is refused.
function addRecipe(title, category, ingredientsText, stepsText, notes) {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) return false;
  const now = new Date().toISOString();
  const recipe = {
    id: makeId(),
    title: trimmedTitle,
    category: category.trim(),
    ingredients: splitLines(ingredientsText),
    steps: splitLines(stepsText),
    notes: notes.trim(),
    dateAdded: now,
    updatedAt: now,
    deviceId: getDeviceId(),
    deleted: false,
    version: 0,
  };
  recipes.push(recipe);
  saveCollection(RECIPES_KEY, recipes);
  recordUndo('recipes', recipe.id, null, structuredClone(recipe));
  renderRecipes();
  return true;
}

// Soft-deletes a recipe (keeps a tombstone so syncing can tell it was deleted).
function deleteRecipe(id) {
  const recipe = recipes.find((r) => r.id === id);
  if (!recipe) return;
  const before = structuredClone(recipe);
  recipe.deleted = true;
  stampSync(recipe);
  saveCollection(RECIPES_KEY, recipes);
  recordUndo('recipes', id, before, structuredClone(recipe));
  renderRecipes();
}

// Brings a deleted recipe back (used by undo).
function restoreRecipe(id) {
  const recipe = recipes.find((r) => r.id === id);
  if (!recipe || !recipe.deleted) return;
  const before = structuredClone(recipe);
  recipe.deleted = false;
  stampSync(recipe);
  saveCollection(RECIPES_KEY, recipes);
  recordUndo('recipes', id, before, structuredClone(recipe));
  renderRecipes();
}

// Saves edits to a recipe.
function updateRecipe(id, fields) {
  const recipe = recipes.find((r) => r.id === id);
  if (!recipe) return;
  const trimmedTitle = fields.title.trim();
  if (!trimmedTitle) return false;
  const before = structuredClone(recipe);
  recipe.title = trimmedTitle;
  recipe.category = fields.category.trim();
  recipe.ingredients = splitLines(fields.ingredientsText);
  recipe.steps = splitLines(fields.stepsText);
  recipe.notes = fields.notes.trim();
  stampSync(recipe);
  saveCollection(RECIPES_KEY, recipes);
  recordUndo('recipes', id, before, structuredClone(recipe));
  renderRecipes();
}

// True if the search text appears in the recipe's title, category, ingredients, steps or notes.
function matchesRecipeSearch(recipe, term) {
  if (!term) return true;
  const haystack = [recipe.title, recipe.category, ...(recipe.ingredients || []), ...(recipe.steps || []), recipe.notes]
    .join(' ')
    .toLowerCase();
  return haystack.includes(term.toLowerCase());
}

// 'all' is the default/initial state and always shows every recipe. Stores
// the *normalized* key (see normalizeChipKey), not the raw display string,
// so "Sides" and "sides" are treated as the same selected chip.
let selectedRecipeCategory = 'all';

// True if the recipe belongs to the selected category chip ('all' matches everything).
function matchesRecipeCategory(recipe, categoryKey) {
  return categoryKey === 'all' || normalizeChipKey(recipe.category) === categoryKey;
}

// Derived fresh from the live `recipes` array every render — never a
// hardcoded category list — so new categories the user adds later show up
// automatically.
function renderRecipeCategoryFilters(nonDeletedRecipes) {
  const container = document.getElementById('recipes-category-filters');
  const options = [{ key: 'all', label: 'All' }, ...deriveChipOptions(nonDeletedRecipes, (r) => r.category)];
  renderChipFilter(
    container,
    options,
    () => selectedRecipeCategory,
    (key) => { selectedRecipeCategory = key; },
    renderRecipes
  );
}

// The chosen sort for the Recipes screen; 'date_added_asc' (oldest first) is the default.
let selectedRecipesSort = 'date_added_asc';

// Sort options by the value of the Recipes sort dropdown.
const RECIPE_SORTS = {
  date_added_asc: compareByField((r) => r.dateAdded, 1, { text: false }),
  date_added_desc: compareByField((r) => r.dateAdded, -1, { text: false }),
  title_asc: compareByField((r) => r.title, 1),
};

// Redraws the whole Recipes screen: filters, search, sort and the recipe cards.
function renderRecipes() {
  const searchTerm = document.getElementById('recipes-search-input').value;
  const nonDeleted = recipes.filter((r) => !r.deleted);
  const list = document.getElementById('recipes-list');
  const template = document.getElementById('recipes-card-template');

  renderRecipeCategoryFilters(nonDeleted);

  const comparator = RECIPE_SORTS[selectedRecipesSort] || RECIPE_SORTS.date_added_asc;
  const visible = nonDeleted
    .filter((r) => matchesRecipeSearch(r, searchTerm))
    .filter((r) => matchesRecipeCategory(r, selectedRecipeCategory))
    .sort(comparator);

  const openForm = list.querySelector('.recipe-edit-form:not([hidden])');
  const openEdit = openForm
    ? {
        id: openForm.closest('.recipe-card').dataset.recipeId,
        title: openForm.querySelector('.recipe-edit-title').value,
        category: openForm.querySelector('.recipe-edit-category').value,
        ingredientsText: openForm.querySelector('.recipe-edit-ingredients').value,
        stepsText: openForm.querySelector('.recipe-edit-steps').value,
        notes: openForm.querySelector('.recipe-edit-notes').value,
      }
    : null;

  list.innerHTML = '';

  visible.forEach((recipe) => {
    const node = template.content.cloneNode(true);
    const card = node.querySelector('.recipe-card');
    card.dataset.recipeId = recipe.id;
    const viewSection = node.querySelector('.recipe-view');
    const editForm = node.querySelector('.recipe-edit-form');

    node.querySelector('.recipe-title').textContent = recipe.title;

    const categoryEl = node.querySelector('.recipe-category');
    if (recipe.category) {
      categoryEl.textContent = recipe.category;
      categoryEl.hidden = false;
    }

    const ingredientsSection = node.querySelector('.recipe-ingredients-section');
    if ((recipe.ingredients || []).length) {
      const ingredientsList = node.querySelector('.recipe-ingredients');
      recipe.ingredients.forEach((ing) => {
        const li = document.createElement('li');
        li.textContent = ing;
        ingredientsList.appendChild(li);
      });
      ingredientsSection.hidden = false;
    }
    const stepsSection = node.querySelector('.recipe-steps-section');
    if ((recipe.steps || []).length) {
      const stepsList = node.querySelector('.recipe-steps');
      recipe.steps.forEach((step) => {
        const li = document.createElement('li');
        li.textContent = step;
        stepsList.appendChild(li);
      });
      stepsSection.hidden = false;
    }

    const notesEl = node.querySelector('.recipe-notes');
    if (recipe.notes) {
      notesEl.textContent = recipe.notes;
      notesEl.hidden = false;
    }

    const editTitleInput = node.querySelector('.recipe-edit-title');
    const editCategoryInput = node.querySelector('.recipe-edit-category');
    const editIngredientsInput = node.querySelector('.recipe-edit-ingredients');
    const editStepsInput = node.querySelector('.recipe-edit-steps');
    const editNotesInput = node.querySelector('.recipe-edit-notes');

    node.querySelector('.edit-btn').addEventListener('click', () => {
      const otherOpenForm = list.querySelector('.recipe-edit-form:not([hidden])');
      if (otherOpenForm && otherOpenForm !== editForm) {
        otherOpenForm.hidden = true;
        otherOpenForm.closest('.recipe-card').querySelector('.recipe-view').hidden = false;
      }
      editTitleInput.value = recipe.title;
      editCategoryInput.value = recipe.category || '';
      editIngredientsInput.value = (recipe.ingredients || []).join('\n');
      editStepsInput.value = (recipe.steps || []).join('\n');
      editNotesInput.value = recipe.notes || '';
      viewSection.hidden = true;
      editForm.hidden = false;
    });

    node.querySelector('.cancel-btn').addEventListener('click', () => {
      editForm.hidden = true;
      viewSection.hidden = false;
    });

    editForm.addEventListener('submit', (e) => {
      e.preventDefault();
      // Hide before calling updateRecipe — see the identical comment on
      // Books' edit-form submit handler: a successful save's internal
      // render must see this form as already closed, or it reopens the
      // form that just saved.
      editForm.hidden = true;
      viewSection.hidden = false;
      const saved = updateRecipe(recipe.id, {
        title: editTitleInput.value,
        category: editCategoryInput.value,
        ingredientsText: editIngredientsInput.value,
        stepsText: editStepsInput.value,
        notes: editNotesInput.value,
      });
      if (saved === false) {
        viewSection.hidden = true;
        editForm.hidden = false;
      }
    });

    node.querySelector('.delete-btn').addEventListener('click', () => deleteRecipe(recipe.id));

    if (openEdit && openEdit.id === recipe.id) {
      editTitleInput.value = openEdit.title;
      editCategoryInput.value = openEdit.category;
      editIngredientsInput.value = openEdit.ingredientsText;
      editStepsInput.value = openEdit.stepsText;
      editNotesInput.value = openEdit.notes;
      viewSection.hidden = true;
      editForm.hidden = false;
    }

    list.appendChild(node);
  });

  document.getElementById('recipes-empty-state').hidden = nonDeleted.length !== 0;
}

// Add recipe: clears every box only if it was saved (a blank title keeps what was typed).
document.getElementById('recipes-add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const titleInput = document.getElementById('recipes-title-input');
  const categoryInput = document.getElementById('recipes-category-input');
  const ingredientsInput = document.getElementById('recipes-ingredients-input');
  const stepsInput = document.getElementById('recipes-steps-input');
  const notesInput = document.getElementById('recipes-notes-input');
  if (addRecipe(titleInput.value, categoryInput.value, ingredientsInput.value, stepsInput.value, notesInput.value)) {
    titleInput.value = '';
    categoryInput.value = '';
    ingredientsInput.value = '';
    stepsInput.value = '';
    notesInput.value = '';
  } else {
    titleInput.focus();
  }
});

// Search box: filters the cards as you type.
document.getElementById('recipes-search-input').addEventListener('input', renderRecipes);

// Sort dropdown: remembers the choice and redraws.
document.getElementById('recipes-sort-input').addEventListener('change', (e) => {
  selectedRecipesSort = e.target.value;
  renderRecipes();
});

// ---- Notes ----

const NOTES_KEY = 'secondMemory.notes.v1';

let notes = migrateSyncFields(loadCollection(NOTES_KEY), NOTES_KEY, getDeviceId());

// Adds a note; a note needs a title or some body text.
function addNote(title, body) {
  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  if (!trimmedTitle && !trimmedBody) return { ok: false, error: 'A note needs a title or some text.' };
  const now = new Date().toISOString();
  const note = {
    id: makeId(),
    title: trimmedTitle,
    body: trimmedBody,
    dateAdded: now,
    dateModified: now,
    updatedAt: now,
    deviceId: getDeviceId(),
    deleted: false,
    version: 0,
  };
  notes.push(note);
  saveCollection(NOTES_KEY, notes);
  recordUndo('notes', note.id, null, structuredClone(note));
  renderNotes();
  return { ok: true };
}

// Saves edits to a note's title and body.
function updateNote(id, title, body) {
  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  if (!trimmedTitle && !trimmedBody) return { ok: false, error: 'A note needs a title or some text.' };
  const note = notes.find((n) => n.id === id);
  if (!note) return { ok: false, error: 'Note not found.' };
  const before = structuredClone(note);
  note.title = trimmedTitle;
  note.body = trimmedBody;
  note.dateModified = new Date().toISOString(); // Notes-specific field, kept as its own step
  stampSync(note); // sets updatedAt + deviceId via the shared helper
  saveCollection(NOTES_KEY, notes);
  recordUndo('notes', id, before, structuredClone(note));
  renderNotes();
  return { ok: true };
}

// Soft-deletes a note (keeps a tombstone so syncing can tell it was deleted).
function deleteNote(id) {
  const note = notes.find((n) => n.id === id);
  if (!note) return;
  const before = structuredClone(note);
  note.deleted = true;
  stampSync(note);
  saveCollection(NOTES_KEY, notes);
  recordUndo('notes', id, before, structuredClone(note));
  renderNotes();
}

// Brings a deleted note back (used by undo).
function restoreNote(id) {
  const note = notes.find((n) => n.id === id);
  if (!note || !note.deleted) return;
  const before = structuredClone(note);
  note.deleted = false;
  stampSync(note);
  saveCollection(NOTES_KEY, notes);
  recordUndo('notes', id, before, structuredClone(note));
  renderNotes();
}

// True if the search text appears in the note's title or body.
function matchesNoteSearch(note, term) {
  if (!term) return true;
  const haystack = `${note.title || ''} ${note.body || ''}`.toLowerCase();
  return haystack.includes(term.toLowerCase());
}

// The start of a note's body for the card preview, cut off with "…" if it's long.
function noteBodySnippet(body, length = 150) {
  const trimmed = (body || '').trim();
  return trimmed.length > length ? `${trimmed.slice(0, length)}…` : trimmed;
}

// 'date_modified_desc' is the default: each card shows "Updated {date}", so most recently
// edited first is the natural order.
let selectedNotesSort = 'date_modified_desc';

const NOTE_SORTS = {
  date_modified_desc: compareByField((n) => n.dateModified, -1, { text: false }),
  date_modified_asc: compareByField((n) => n.dateModified, 1, { text: false }),
  date_added_desc: compareByField((n) => n.dateAdded, -1, { text: false }),
  date_added_asc: compareByField((n) => n.dateAdded, 1, { text: false }),
  title_asc: compareByField((n) => n.title, 1),
};

// Redraws the whole Notes screen: search, sort and the note cards.
function renderNotes() {
  const searchTerm = document.getElementById('notes-search-input').value;
  const comparator = NOTE_SORTS[selectedNotesSort] || NOTE_SORTS.date_modified_desc;
  // Sort is applied after search filtering, before render — same pipeline
  // order as every other collection. The open-edit-form capture/restore
  // below is keyed by note id, not by position, so re-ordering the visible
  // array has no effect on which note (if any) has its edit form preserved.
  const visible = notes
    .filter((n) => !n.deleted)
    .filter((n) => matchesNoteSearch(n, searchTerm))
    .sort(comparator);
  const list = document.getElementById('notes-list');
  const template = document.getElementById('notes-card-template');

  // Read any in-progress (unsaved) edit straight from the live DOM before
  // wiping it out below — the `notes` array only has the last saved values.
  const openForm = list.querySelector('.note-edit-form:not([hidden])');
  const openEdit = openForm
    ? {
        id: openForm.closest('.note-card').dataset.noteId,
        title: openForm.querySelector('.note-edit-title').value,
        body: openForm.querySelector('.note-edit-body').value,
      }
    : null;

  list.innerHTML = '';

  visible.forEach((note) => {
    const node = template.content.cloneNode(true);
    const card = node.querySelector('.note-card');
    card.dataset.noteId = note.id;
    const viewSection = node.querySelector('.note-view');
    const editForm = node.querySelector('.note-edit-form');

    const titleEl = node.querySelector('.note-title');
    const previewEl = node.querySelector('.note-body-preview');
    if (note.title) {
      titleEl.textContent = note.title;
      titleEl.hidden = false;
    } else {
      titleEl.hidden = true;
    }
    previewEl.textContent = noteBodySnippet(note.body);

    // Older or hand-made records may lack dateModified; fall back to the other stamps rather than
    // printing "Invalid Date".
    const modified = new Date(note.dateModified || note.updatedAt || note.dateAdded);
    node.querySelector('.note-modified').textContent = Number.isNaN(modified.getTime()) ? '' : `Updated ${modified.toLocaleString()}`;

    const editTitleInput = node.querySelector('.note-edit-title');
    const editBodyInput = node.querySelector('.note-edit-body');
    const editError = node.querySelector('.note-edit-error');

    node.querySelector('.edit-btn').addEventListener('click', () => {
      // Only one note can be in edit mode at a time (keeps renderNotes'
      // single-open-edit-form capture/restore correct by construction).
      // Close any other note's open form the same way Cancel would.
      const otherOpenForm = list.querySelector('.note-edit-form:not([hidden])');
      if (otherOpenForm && otherOpenForm !== editForm) {
        otherOpenForm.hidden = true;
        otherOpenForm.closest('.note-card').querySelector('.note-view').hidden = false;
      }
      editTitleInput.value = note.title || '';
      editBodyInput.value = note.body || '';
      editError.hidden = true;
      viewSection.hidden = true;
      editForm.hidden = false;
    });

    node.querySelector('.cancel-btn').addEventListener('click', () => {
      editForm.hidden = true;
      viewSection.hidden = false;
    });

    editForm.addEventListener('submit', (e) => {
      e.preventDefault();
      // Hide the form BEFORE calling updateNote — see the full comment on
      // Medications' edit-form submit handler for why this ordering
      // matters on both the success and failure paths.
      editForm.hidden = true;
      viewSection.hidden = false;
      const result = updateNote(note.id, editTitleInput.value, editBodyInput.value);
      if (!result.ok) {
        viewSection.hidden = true;
        editForm.hidden = false;
        editError.textContent = result.error;
        editError.hidden = false;
      }
    });

    node.querySelector('.delete-btn').addEventListener('click', () => deleteNote(note.id));

    if (openEdit && openEdit.id === note.id) {
      editTitleInput.value = openEdit.title;
      editBodyInput.value = openEdit.body;
      viewSection.hidden = true;
      editForm.hidden = false;
    }

    list.appendChild(node);
  });

  document.getElementById('notes-empty-state').hidden = notes.filter((n) => !n.deleted).length !== 0;
}

document.getElementById('notes-add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const titleInput = document.getElementById('notes-title-input');
  const bodyInput = document.getElementById('notes-body-input');
  const errorEl = document.getElementById('notes-form-error');
  const result = addNote(titleInput.value, bodyInput.value);
  if (!result.ok) {
    errorEl.textContent = result.error;
    errorEl.hidden = false;
    return;
  }
  errorEl.hidden = true;
  titleInput.value = '';
  bodyInput.value = '';
  titleInput.focus();
});

document.getElementById('notes-search-input').addEventListener('input', renderNotes);

document.getElementById('notes-sort-input').addEventListener('change', (e) => {
  selectedNotesSort = e.target.value;
  renderNotes();
});

// ---- Resume & Portfolio ----

const LINKS_KEY = 'secondMemory.links.v1';

let links = migrateSyncFields(loadCollection(LINKS_KEY), LINKS_KEY, getDeviceId());

// Adds a saved link (label, address, notes); both the label and the address are required.
function addLink(label, url, noteText) {
  const trimmedLabel = label.trim();
  const trimmedUrl = url.trim();
  if (!trimmedLabel) return { ok: false, error: 'Label is required.' };
  if (!trimmedUrl) return { ok: false, error: 'URL is required.' };
  const now = new Date().toISOString();
  const link = {
    id: makeId(),
    label: trimmedLabel,
    url: trimmedUrl,
    notes: noteText.trim(),
    dateAdded: now,
    updatedAt: now,
    deviceId: getDeviceId(),
    deleted: false,
    version: 0,
  };
  links.push(link);
  saveCollection(LINKS_KEY, links);
  recordUndo('links', link.id, null, structuredClone(link));
  renderLinks();
  return { ok: true };
}

// Soft-deletes a link (keeps a tombstone so syncing can tell it was deleted).
function deleteLink(id) {
  const link = links.find((l) => l.id === id);
  if (!link) return;
  const before = structuredClone(link);
  link.deleted = true;
  stampSync(link);
  saveCollection(LINKS_KEY, links);
  recordUndo('links', id, before, structuredClone(link));
  renderLinks();
}

// Brings a deleted link back (used by undo).
function restoreLink(id) {
  const link = links.find((l) => l.id === id);
  if (!link || !link.deleted) return;
  const before = structuredClone(link);
  link.deleted = false;
  stampSync(link);
  saveCollection(LINKS_KEY, links);
  recordUndo('links', id, before, structuredClone(link));
  renderLinks();
}

// Saves edits to a link's label, address and notes.
function updateLink(id, fields) {
  const link = links.find((l) => l.id === id);
  if (!link) return { ok: false, error: 'Link not found.' };
  const trimmedLabel = fields.label.trim();
  const trimmedUrl = fields.url.trim();
  if (!trimmedLabel) return { ok: false, error: 'Label is required.' };
  if (!trimmedUrl) return { ok: false, error: 'URL is required.' };
  const before = structuredClone(link);
  link.label = trimmedLabel;
  link.url = trimmedUrl;
  link.notes = fields.notes.trim();
  stampSync(link);
  saveCollection(LINKS_KEY, links);
  recordUndo('links', id, before, structuredClone(link));
  renderLinks();
  return { ok: true };
}

// True if the search text appears in the link's label, address or notes.
function matchesLinkSearch(link, term) {
  if (!term) return true;
  const haystack = `${link.label || ''} ${link.url || ''} ${link.notes || ''}`.toLowerCase();
  return haystack.includes(term.toLowerCase());
}

// Turns what the user typed into a safe address to open (adds https:// when no scheme is given).
function hrefFor(url) {
  const trimmed = String(url).trim();
  if (/^(https?:\/\/|mailto:|tel:)/i.test(trimmed)) return trimmed;
  if (/^[^\s/:@]+@[^\s/:@]+\.[^\s/:@]+$/.test(trimmed)) return `mailto:${trimmed}`; // me@site.com
  // Anything else (including javascript:/data: and host:port forms like
  // localhost:3000) is treated as a plain web address, never as a script.
  return `https://${trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')}`;
}

// 'date_added_asc' is the default, matching current unsorted behavior.
let selectedLinksSort = 'date_added_asc';

const LINK_SORTS = {
  date_added_asc: compareByField((l) => l.dateAdded, 1, { text: false }),
  date_added_desc: compareByField((l) => l.dateAdded, -1, { text: false }),
  label_asc: compareByField((l) => l.label, 1),
};

// Redraws the whole Resume & Portfolio screen: search, sort and the link cards.
function renderLinks() {
  const searchTerm = document.getElementById('resume-search-input').value;
  const comparator = LINK_SORTS[selectedLinksSort] || LINK_SORTS.date_added_asc;
  const visible = links
    .filter((l) => !l.deleted)
    .filter((l) => matchesLinkSearch(l, searchTerm))
    .sort(comparator);
  const list = document.getElementById('resume-list');
  const template = document.getElementById('resume-card-template');

  // Remember an open edit form (with unsaved typing) so the redraw doesn't lose it.
  const openForm = list.querySelector('.link-edit-form:not([hidden])');
  const openEdit = openForm
    ? {
        id: openForm.closest('.link-card').dataset.linkId,
        label: openForm.querySelector('.link-edit-label').value,
        url: openForm.querySelector('.link-edit-url').value,
        notes: openForm.querySelector('.link-edit-notes').value,
      }
    : null;

  list.innerHTML = '';

  visible.forEach((link) => {
    const node = template.content.cloneNode(true);
    const card = node.querySelector('.link-card');
    card.dataset.linkId = link.id;
    const viewSection = node.querySelector('.link-view');
    const editForm = node.querySelector('.link-edit-form');

    node.querySelector('.link-label').textContent = link.label;

    const anchor = node.querySelector('.link-url');
    anchor.textContent = link.url;
    anchor.href = hrefFor(link.url);

    const notesEl = node.querySelector('.link-notes');
    if (link.notes) {
      notesEl.textContent = link.notes;
      notesEl.hidden = false;
    }

    const editLabelInput = node.querySelector('.link-edit-label');
    const editUrlInput = node.querySelector('.link-edit-url');
    const editNotesInput = node.querySelector('.link-edit-notes');
    const editError = node.querySelector('.link-edit-error');

    node.querySelector('.edit-btn').addEventListener('click', () => {
      const otherOpenForm = list.querySelector('.link-edit-form:not([hidden])');
      if (otherOpenForm && otherOpenForm !== editForm) {
        otherOpenForm.hidden = true;
        otherOpenForm.closest('.link-card').querySelector('.link-view').hidden = false;
      }
      editLabelInput.value = link.label || '';
      editUrlInput.value = link.url || '';
      editNotesInput.value = link.notes || '';
      editError.hidden = true;
      viewSection.hidden = true;
      editForm.hidden = false;
    });

    node.querySelector('.cancel-btn').addEventListener('click', () => {
      editForm.hidden = true;
      viewSection.hidden = false;
    });

    editForm.addEventListener('submit', (e) => {
      e.preventDefault();
      // Hide the form BEFORE calling updateLink — see the full comment on
      // Medications' edit-form submit handler for why this ordering
      // matters on both the success and failure paths.
      editForm.hidden = true;
      viewSection.hidden = false;
      const result = updateLink(link.id, {
        label: editLabelInput.value,
        url: editUrlInput.value,
        notes: editNotesInput.value,
      });
      if (!result.ok) {
        viewSection.hidden = true;
        editForm.hidden = false;
        editError.textContent = result.error;
        editError.hidden = false;
      }
    });

    node.querySelector('.delete-btn').addEventListener('click', () => deleteLink(link.id));

    if (openEdit && openEdit.id === link.id) {
      editLabelInput.value = openEdit.label;
      editUrlInput.value = openEdit.url;
      editNotesInput.value = openEdit.notes;
      viewSection.hidden = true;
      editForm.hidden = false;
    }

    list.appendChild(node);
  });

  document.getElementById('resume-empty-state').hidden = links.filter((l) => !l.deleted).length !== 0;
}

document.getElementById('resume-add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const labelInput = document.getElementById('resume-label-input');
  const urlInput = document.getElementById('resume-url-input');
  const notesInput = document.getElementById('resume-notes-input');
  const errorEl = document.getElementById('resume-form-error');

  const result = addLink(labelInput.value, urlInput.value, notesInput.value);
  if (!result.ok) {
    errorEl.textContent = result.error;
    errorEl.hidden = false;
    return;
  }
  errorEl.hidden = true;
  labelInput.value = '';
  urlInput.value = '';
  notesInput.value = '';
  labelInput.focus();
});

document.getElementById('resume-search-input').addEventListener('input', renderLinks);

document.getElementById('resume-sort-input').addEventListener('change', (e) => {
  selectedLinksSort = e.target.value;
  renderLinks();
});

// ---- Date helpers ----
// Shared by books, weights, the journal, medications, to-dos and the date checks on forms.
// All date-key values are local-date-derived 'YYYY-MM-DD' strings, never
// `toISOString()`-derived (that is UTC, not local, so it is a day off in the evening in the
// US timezones). Comparisons between two date keys use plain string comparison, which is
// correct for this fixed zero-padded format.

// A date key is a 'YYYY-MM-DD' string; this checks the shape (not that the date is real).
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Builds a 'YYYY-MM-DD' key; monthIndex is 0-based (0 = January) like JavaScript dates.
function dateKeyFromParts(year, monthIndex, day) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// The date key for a Date, using the local calendar day.
function dateKeyFromLocalDate(date) {
  return dateKeyFromParts(date.getFullYear(), date.getMonth(), date.getDate());
}

// Today's date key in local time.
function todayKey() {
  return dateKeyFromLocalDate(new Date());
}

// Splits a date key into { y, m, d } numbers (m is 0-based).
function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m: m - 1, d }; // m is 0-indexed to match Date's convention
}

// A real calendar date in YYYY-MM-DD form (rejects 2026-13-45 and 2026-02-30).
function isRealDateKey(value) {
  if (typeof value !== 'string' || !DATE_KEY_RE.test(value)) return false;
  const { y, m, d } = parseDateKey(value);
  const date = new Date(y, m, d); // rolls an impossible day over into the next month, which the checks below catch
  return date.getFullYear() === y && date.getMonth() === m && date.getDate() === d;
}

// How many days a month has (handles leap years); monthIndex is 0-based.
function daysInMonth(year, monthIndex) {
  // The "day 0" trick: day 0 of month M+1 is the last day of month M.
  return new Date(year, monthIndex + 1, 0).getDate();
}

// Moves a date key by a number of days (negative = earlier). It changes the day-of-month
// field and lets Date's constructor handle month/year rollover, so DST changes cannot
// shift the result by a day.
function shiftDateKey(key, deltaDays) {
  const { y, m, d } = parseDateKey(key);
  return dateKeyFromLocalDate(new Date(y, m, d + deltaDays));
}

// Month names indexed by 0-based month number.
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

// Dates outside this range are almost always a typo (typing "26" for the year gives 0026),
// and a year before 1000 breaks date math (repeats, charts) and can make a screen crawl.
const DATE_YEAR_MIN = 1990;
const DATE_YEAR_MAX = 2100;
// True if a YYYY-MM-DD string has a year inside the allowed range.
function isReasonableDateKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  return !!m && Number(m[1]) >= DATE_YEAR_MIN && Number(m[1]) <= DATE_YEAR_MAX;
}
const DATE_RANGE_MESSAGE = `Pick a date between the years ${DATE_YEAR_MIN} and ${DATE_YEAR_MAX}.`;

// "2026-09-05" becomes "September 5, 2026".
function formatDateKeyLong(dateKey) {
  const { y, m, d } = parseDateKey(dateKey);
  return `${MONTH_NAMES[m]} ${d}, ${y}`;
}

// ---- Journal (dreams + therapy sessions) ----
// Deliberately NOT in SYNC_COLLECTIONS: therapy/dream entries are sensitive, so
// they live only in this browser's localStorage and are never sent to the sync
// server. Backup/restore is its own file (separate from the main export).

const JOURNAL_KEY = 'secondMemory.journal.v1';

// Journal entries are { id, type, date, answers, dateAdded, updatedAt } with no sync fields,
// and deleting one removes it for good (after a confirm) instead of leaving a tombstone.
let journalEntries = loadCollection(JOURNAL_KEY);

// The three kinds of entry and the questions the wizard asks for each. Question types:
// 'text' = free writing, 'scale' = 1 to 5, 'choice' = pick one of `options`. Answers are
// stored by question id, so don't rename an id once entries exist.
const JOURNAL_TEMPLATES = {
  dream: {
    label: 'Dream',
    questions: [
      { id: 'story', type: 'text', q: 'What happened in the dream?', hint: 'Write it while it is fresh. Fragments are fine.' },
      { id: 'stood_out', type: 'text', q: 'Which people, places, or objects stood out?' },
      { id: 'felt_in', type: 'text', q: 'How did you feel during the dream?' },
      { id: 'felt_waking', type: 'choice', q: 'How did you feel waking up?', options: ['Calm', 'Happy', 'Neutral', 'Anxious', 'Sad', 'Scared'] },
      { id: 'vividness', type: 'scale', q: 'How vivid was it?', hint: '1 = hazy, 5 = like real life' },
      { id: 'recurring', type: 'choice', q: 'Is this a recurring dream or theme?', options: ['No', 'Yes', 'Not sure'] },
      { id: 'connection', type: 'text', q: 'Does anything connect to what is going on in your life right now?' },
    ],
  },
  therapy: {
    label: 'Therapy session',
    questions: [
      { id: 'topics', type: 'text', q: 'What did we mainly talk about?' },
      { id: 'insight', type: 'text', q: 'What was the biggest insight or moment that stuck with me?' },
      { id: 'hard', type: 'text', q: 'What felt hard or uncomfortable?' },
      { id: 'mood_after', type: 'scale', q: 'How do I feel after the session?', hint: '1 = drained, 5 = lighter' },
      { id: 'homework', type: 'text', q: 'Homework or things to try before next time?' },
      { id: 'next', type: 'text', q: 'What do I want to bring up next session?' },
    ],
  },
  daily: {
    label: 'Journal',
    questions: [
      { id: 'on_mind', type: 'text', q: "What's on your mind today?", hint: 'Free-write here. Skip the rest if this is all you need.' },
      { id: 'day_rating', type: 'scale', q: 'How was your day overall?', hint: '1 = rough, 5 = great' },
      { id: 'feeling', type: 'choice', q: 'How are you feeling right now?', options: ['Happy', 'Calm', 'Grateful', 'Okay', 'Tired', 'Stressed', 'Anxious', 'Sad'] },
      { id: 'happened', type: 'text', q: 'What happened today?' },
      { id: 'went_well', type: 'text', q: 'What went well, or what are you grateful for?' },
      { id: 'hard', type: 'text', q: 'What was hard?' },
      { id: 'tomorrow', type: 'text', q: 'What do you want to remember or do tomorrow?' },
    ],
  },
};

// Journal screen state: type chip, search text, and the trend chart's range ('all' or a number of days).
let selectedJournalFilter = 'all';
let journalSearchTerm = '';
let selectedTrendRange = '90';

// 'end' = jump to the newest entry (first load, new entry, filter change);
// 'keep' = stay where the reader was (edit, delete, restore).
let journalScrollMode = 'end';
let journalLastScrollLeft = 0; // browsers reset a hidden element's scroll, so remember it
let journalActiveOverride = null; // a date the reader just tapped, kept highlighted until they scroll themselves

// ---- Journal prompt and look-back ----
// A reflective prompt that changes every day (the same all day), and a short list of what you
// wrote on this date a year ago. Both are on the Journal tab only; nothing leaves the device.

const JOURNAL_PROMPTS = [
  'What is one thing that went better than you expected lately?',
  'What are you carrying that you could set down today?',
  'Who made your week easier, and what would you like to tell them?',
  'What is something small you are looking forward to?',
  'When did you last feel truly rested? What was different?',
  'What is a worry you keep returning to? What is the next tiny step on it?',
  'What did you need today that you did not get?',
  'What is something you handled well that you have not given yourself credit for?',
  'Describe a place where you feel calm. What makes it that way?',
  'What would make tomorrow a good day?',
  'What is something you are avoiding, and why?',
  'What are three things you are grateful for right now?',
  'What did you learn about yourself this week?',
  'What boundary would help you most right now?',
  'What is a kind thing you could say to yourself today?',
  'What has been taking up the most space in your mind?',
  'What is one thing you would do if you were not afraid?',
  'When did you last laugh really hard? What was funny?',
  'What does your body need from you today?',
  'What is something you used to enjoy that you would like to do again?',
  'What is a decision you are putting off? What do you already know about it?',
  'Who do you miss, and what do you miss about them?',
  'What is one thing you can let be good enough?',
  'What are you proud of from the last month?',
  'How have you changed in the past year?',
  'What is something you wish people understood about you?',
  'What made you feel safe lately?',
  'What would you tell a friend who was in your situation?',
  'What is one thing you are still figuring out?',
  'What did today teach you?',
  'What are you hoping for this season of your life?',
  'Which feeling showed up most this week? Where did you notice it in your body?',
  'What is something beautiful you noticed recently?',
  'What would you like to remember about this time?',
  'What is draining your energy, and what restores it?',
  'What is one small way you could be gentler with yourself?',
  'What are you ready to forgive, in yourself or someone else?',
  'What conversation would you like to have, and with whom?',
  'What is a win from this week, however small?',
  'What do you want more of in your life, and what do you want less of?',
];

// Today's prompt: it moves to the next one each day, wrapping around the list.
function journalPromptForDate(dateKey) {
  return JOURNAL_PROMPTS[((epochDays(dateKey) % JOURNAL_PROMPTS.length) + JOURNAL_PROMPTS.length) % JOURNAL_PROMPTS.length];
}

// The same calendar date one year before (Feb 29 becomes Feb 28).
function sameDateLastYear(dateKey) {
  const { y, m, d } = parseDateKey(dateKey);
  return dateKeyFromParts(y - 1, m, Math.min(d, daysInMonth(y - 1, m)));
}

// A short piece of an entry to jog the memory: its first written answer, trimmed.
function journalExcerpt(entry) {
  const answers = entry.answers || {};
  const questions = (JOURNAL_TEMPLATES[entry.type] || { questions: [] }).questions;
  const firstText = questions.find((q) => q.type === 'text' && hasJournalAnswer(answers[q.id]));
  const text = firstText ? String(answers[firstText.id]).replace(/\s+/g, ' ').trim() : '';
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

// Fills the prompt and the "this day last year" list on the Journal tab.
function renderJournalExtras() {
  document.getElementById('journal-prompt-text').textContent = journalPromptForDate(todayKey());
  const target = sameDateLastYear(todayKey());
  const found = journalEntries.filter((e) => e.date === target);
  const box = document.getElementById('journal-lookback');
  const list = document.getElementById('journal-lookback-list');
  list.innerHTML = '';
  box.hidden = found.length === 0;
  found.forEach((entry) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    const label = (JOURNAL_TEMPLATES[entry.type] || { label: 'Entry' }).label;
    const excerpt = journalExcerpt(entry);
    btn.textContent = excerpt ? `${label}: ${excerpt}` : label;
    btn.addEventListener('click', () => scrollJournalToEntry(entry.id));
    li.appendChild(btn);
    list.appendChild(li);
  });
}

// "Write about this" starts a journal entry with today's prompt already in the first answer.
document.getElementById('journal-prompt-btn').addEventListener('click', () => {
  // Starting a new entry replaces any entry being written, so ask first (like the other start buttons).
  if (journalDraft && !window.confirm('Discard the entry you are writing and start a new one?')) return;
  const shownPrompt = document.getElementById('journal-prompt-text').textContent || journalPromptForDate(todayKey());
  openJournalWizard('daily');
  journalDraft.answers.on_mind = `${shownPrompt}\n\n`;
});

// Wizard state: step 0 is the date; steps 1..N are the template's questions.
let journalDraft = null; // { type, editingId, date, answers, step }

// True if an answer has some real content (not missing, null or only spaces).
function hasJournalAnswer(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

// Saves the journal to localStorage; returns false if the browser refused.
function saveJournalEntries() {
  return saveCollection(JOURNAL_KEY, journalEntries);
}

// Starts the question-by-question wizard for a new entry, or for editing an existing one.
function openJournalWizard(type, existing) {
  journalDraft = {
    type,
    editingId: existing ? existing.id : null,
    date: existing ? existing.date : todayKey(),
    answers: existing ? { ...existing.answers } : {},
    step: 0,
  };
  document.getElementById('journal-start').hidden = true;
  document.getElementById('journal-wizard').hidden = false;
  renderJournalStep();
}

// Throws away the wizard's draft and returns to the "start an entry" buttons.
function closeJournalWizard() {
  journalDraft = null;
  document.getElementById('journal-wizard').hidden = true;
  document.getElementById('journal-start').hidden = false;
  const startBtn = document.querySelector('#journal-start .journal-start-btn');
  if (startBtn) startBtn.focus(); // the wizard button that had focus is now hidden
}

// Copies what's typed on the current wizard step into the draft (call before moving to another step).
function captureJournalAnswer() {
  const { type, step } = journalDraft;
  const container = document.getElementById('journal-answer');
  if (step === 0) {
    const dateInput = container.querySelector('input[type="date"]');
    if (dateInput && DATE_KEY_RE.test(dateInput.value)) journalDraft.date = dateInput.value;
    return;
  }
  const question = JOURNAL_TEMPLATES[type].questions[step - 1];
  if (question.type === 'text') {
    const textarea = container.querySelector('textarea');
    if (textarea) journalDraft.answers[question.id] = textarea.value.trim();
  }
  // scale/choice answers are written to journalDraft.answers on click.
}

// Shows the wizard's current step: the date picker (step 0) or one question with its input.
function renderJournalStep() {
  // Clear the previous step and set the progress line.
  const { type, step, answers } = journalDraft;
  const template = JOURNAL_TEMPLATES[type];
  const total = template.questions.length;
  const container = document.getElementById('journal-answer');
  const questionEl = document.getElementById('journal-question');
  const hintEl = document.getElementById('journal-hint');
  container.innerHTML = '';
  document.getElementById('journal-error').hidden = true;

  document.getElementById('journal-progress').textContent =
    `${template.label} entry${journalDraft.editingId ? ' (editing)' : ''} \u00b7 ` +
    (step === 0 ? 'Date' : `Question ${step} of ${total}`);

  // Step 0 asks for the date; every later step asks one template question.
  if (step === 0) {
    questionEl.textContent = type === 'dream' ? 'Which night was this dream?'
      : type === 'daily' ? 'Which day is this entry for?'
      : 'When was the session?';
    hintEl.hidden = true;
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.value = journalDraft.date;
    dateInput.setAttribute('aria-label', 'Entry date');
    container.appendChild(dateInput);
  } else {
    const question = template.questions[step - 1];
    questionEl.textContent = question.q;
    hintEl.textContent = question.hint || '';
    hintEl.hidden = !question.hint;
    const current = answers[question.id];

    if (question.type === 'text') {
      const textarea = document.createElement('textarea');
      textarea.value = current || '';
      textarea.setAttribute('aria-label', question.q);
      container.appendChild(textarea);
      textarea.focus();
    } else {
      const choices = question.type === 'scale' ? ['1', '2', '3', '4', '5'] : question.options;
      const row = document.createElement('div');
      row.className = 'journal-choices';
      choices.forEach((choice) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'journal-choice';
        btn.textContent = choice;
        btn.classList.toggle('journal-choice-active', String(current) === choice);
        btn.setAttribute('aria-pressed', String(String(current) === choice));
        btn.addEventListener('click', () => {
          // Tapping the selected option again clears it.
          if (String(journalDraft.answers[question.id]) === choice) delete journalDraft.answers[question.id];
          else journalDraft.answers[question.id] = choice;
          row.querySelectorAll('.journal-choice').forEach((b) => {
            const on = String(journalDraft.answers[question.id]) === b.textContent;
            b.classList.toggle('journal-choice-active', on);
            b.setAttribute('aria-pressed', String(on));
          });
        });
        row.appendChild(btn);
      });
      container.appendChild(row);
    }
  }

  // Back and Skip aren't offered on the date step; the last step's button saves instead of advancing.
  const isLast = step === total;
  document.getElementById('journal-back-btn').hidden = step === 0;
  document.getElementById('journal-skip-btn').hidden = step === 0 || isLast;
  document.getElementById('journal-next-btn').textContent = isLast
    ? (journalDraft.editingId ? 'Save changes' : 'Save entry')
    : 'Next';
}

// Saves the wizard's draft as a new entry or as edits to the one being edited.
// Needs at least one answer; if storage is full the journal is rolled back and an error shown.
function finishJournalEntry() {
  // Refuse a mistyped year (a date input accepts "0026"), then keep only answered questions
  // and refuse an entry with none.
  const { type, editingId, date, answers } = journalDraft;
  if (!isReasonableDateKey(date)) {
    const errorEl = document.getElementById('journal-error');
    errorEl.textContent = DATE_RANGE_MESSAGE;
    errorEl.hidden = false;
    return;
  }
  const questionIds = JOURNAL_TEMPLATES[type].questions.map((q) => q.id);
  const cleaned = {};
  questionIds.forEach((id) => { if (hasJournalAnswer(answers[id])) cleaned[id] = String(answers[id]).trim(); });
  if (Object.keys(cleaned).length === 0) {
    const errorEl = document.getElementById('journal-error');
    errorEl.textContent = 'Answer at least one question before saving.';
    errorEl.hidden = false;
    return;
  }
  // Apply the change in memory, keeping a copy so a failed save can be undone.
  const now = new Date().toISOString();
  const backup = JSON.stringify(journalEntries);
  if (editingId) {
    const entry = journalEntries.find((e) => e.id === editingId);
    if (entry) {
      entry.date = date;
      entry.answers = cleaned;
      entry.updatedAt = now;
    } else {
      // The entry was deleted while its edit form was open: save what was written as an entry
      // again instead of silently dropping it.
      journalEntries.push({ id: editingId, type, date, answers: cleaned, dateAdded: now, updatedAt: now });
      forgetDeletedJournalId(editingId);
    }
  } else {
    journalEntries.push({ id: makeId(), type, date, answers: cleaned, dateAdded: now, updatedAt: now });
  }
  try {
    // saveCollection reports a full or blocked browser by returning false (and showing its own warning).
    if (!saveJournalEntries()) throw new Error('journal could not be saved');
  } catch {
    journalEntries = JSON.parse(backup);
    const errorEl = document.getElementById('journal-error');
    errorEl.textContent = 'Could not save: this browser is out of storage space. Back up and clear some data, then try again.';
    errorEl.hidden = false;
    return;
  }
  closeJournalWizard();
  if (!editingId) journalScrollMode = 'end';
  renderJournal();
}

// Permanently deletes a journal entry after asking for confirmation (the journal has no undo or tombstones).
function deleteJournalEntry(id) {
  if (!window.confirm('Delete this journal entry? This cannot be undone.')) return;
  journalEntries = journalEntries.filter((e) => e.id !== id);
  rememberDeletedJournalId(id);
  saveJournalEntries();
  renderJournal();
}

// The journal has no tombstones (a deleted entry is gone), so the ids of deleted entries are
// remembered here (on this device only). That way restoring an older backup file cannot quietly
// bring back an entry you deliberately deleted.
const JOURNAL_DELETED_KEY = 'secondMemory.journalDeleted.v1';
const JOURNAL_DELETED_KEPT = 500;

// The remembered ids of deleted journal entries.
function loadDeletedJournalIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(JOURNAL_DELETED_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

// Remembers one deleted id (newest 500 kept).
function rememberDeletedJournalId(id) {
  const ids = loadDeletedJournalIds().filter((x) => x !== id);
  ids.push(id);
  try { localStorage.setItem(JOURNAL_DELETED_KEY, JSON.stringify(ids.slice(-JOURNAL_DELETED_KEPT))); } catch { /* storage full: deletion still works, it just is not remembered */ }
}

// Forgets a deleted id (the entry exists again).
function forgetDeletedJournalId(id) {
  try { localStorage.setItem(JOURNAL_DELETED_KEY, JSON.stringify(loadDeletedJournalIds().filter((x) => x !== id))); } catch { /* storage full: nothing to update */ }
}

// Redraws the Journal screen: type chips, the row of entry cards (oldest left, newest right),
// the date strip, trends and backup notes, then restores the scroll position.
function renderJournal() {
  // Type chips (changing one jumps back to the newest entry).
  const filterOptions = [
    { key: 'all', label: 'All' },
    { key: 'daily', label: 'Journal' },
    { key: 'dream', label: 'Dreams' },
    { key: 'therapy', label: 'Therapy' },
  ];
  renderChipFilter(
    document.getElementById('journal-filters'),
    filterOptions,
    () => selectedJournalFilter,
    (key) => { selectedJournalFilter = key; },
    () => { journalScrollMode = 'end'; renderJournal(); }
  );

  // Remember the scroll position, then pick and order the entries to show.
  const list = document.getElementById('journal-list');
  const previousScroll = list.clientWidth > 0 ? list.scrollLeft : journalLastScrollLeft;
  list.innerHTML = '';
  const visible = journalEntries
    .filter((e) => JOURNAL_TEMPLATES[e.type])
    .filter((e) => selectedJournalFilter === 'all' || e.type === selectedJournalFilter)
    .filter((e) => matchesJournalSearch(e, journalSearchTerm))
    .sort((a, b) => {
      // Oldest on the left, newest on the right.
      const ka = `${a.date} ${a.dateAdded}`;
      const kb = `${b.date} ${b.dateAdded}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });

  // One card per entry: type and date, the answered questions, then Edit / Delete.
  visible.forEach((entry) => {
    const template = JOURNAL_TEMPLATES[entry.type];
    const li = document.createElement('li');
    li.className = 'journal-card';
    li.dataset.entryId = entry.id;

    const header = document.createElement('div');
    header.className = 'journal-card-header';
    const badge = document.createElement('span');
    badge.className = 'journal-type-badge';
    badge.textContent = template.label;
    const dateEl = document.createElement('span');
    dateEl.className = 'journal-card-date';
    dateEl.textContent = DATE_KEY_RE.test(entry.date) ? formatDateKeyLong(entry.date) : entry.date;
    header.append(badge, dateEl);
    li.appendChild(header);

    const qa = document.createElement('dl');
    qa.className = 'journal-qa';
    template.questions.forEach((question) => {
      const answer = entry.answers && entry.answers[question.id];
      if (!hasJournalAnswer(answer)) return;
      const dt = document.createElement('dt');
      dt.textContent = question.q;
      const dd = document.createElement('dd');
      dd.textContent = question.type === 'scale' ? `${answer} / 5` : answer;
      qa.append(dt, dd);
    });
    li.appendChild(qa);

    const actions = document.createElement('div');
    actions.className = 'journal-card-actions';
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'edit-btn';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => {
      if (journalDraft && !window.confirm('Discard the entry you are writing?')) return;
      openJournalWizard(entry.type, entry);
      document.getElementById('journal-wizard').scrollIntoView({ block: 'nearest' });
    });
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => deleteJournalEntry(entry.id));
    actions.append(editBtn, deleteBtn);
    li.appendChild(actions);

    list.appendChild(li);
  });

  // Empty state, search result count, and the other panels that depend on the journal.
  document.getElementById('journal-empty-state').hidden = journalEntries.length !== 0;
  const countEl = document.getElementById('journal-search-count');
  const searching = journalSearchTerm.trim() !== '';
  countEl.hidden = !searching;
  if (searching) countEl.textContent = `${visible.length} entr${visible.length === 1 ? 'y matches' : 'ies match'} "${journalSearchTerm.trim()}"`;
  renderJournalTrends();
  renderBackupNotes();
  renderJournalExtras();
  renderJournalDateStrip(visible);
  document.getElementById('journal-nav').hidden = visible.length === 0;

  // Scroll positions can only be set once the tab is visible (hidden elements
  // have no width); journalScrollMode stays pending until then.
  if (list.clientWidth > 0) {
    if (journalScrollMode === 'end') journalActiveOverride = null;
    list.style.scrollSnapType = 'none';
    list.scrollLeft = journalScrollMode === 'end' ? list.scrollWidth : previousScroll;
    list.style.scrollSnapType = '';
    journalLastScrollLeft = list.scrollLeft;
    journalScrollMode = 'keep';
    updateJournalActiveDate();
  }
}

// True if the search text appears in the entry's type, date or any of its answers.
function matchesJournalSearch(entry, term) {
  const needle = (term || '').trim().toLowerCase();
  if (!needle) return true;
  const template = JOURNAL_TEMPLATES[entry.type];
  const haystack = [
    template.label,
    entry.date,
    DATE_KEY_RE.test(entry.date) ? formatDateKeyLong(entry.date) : '',
    ...Object.values(entry.answers || {}),
  ].join(' ').toLowerCase();
  return haystack.includes(needle);
}

// Typing in the Journal search box filters the cards and jumps to the newest match.
document.getElementById('journal-search-input').addEventListener('input', (e) => {
  journalSearchTerm = e.target.value;
  journalScrollMode = 'end';
  renderJournal();
});

// ---- Journal trends ----
// Ratings over time (the 1-5 "how was your day" and "how do I feel after
// therapy" answers) as an inline SVG line chart, plus the feelings you pick
// most. Nothing leaves the device; this only reads the entries already here.

// The two ratings charted: which entry type and which 1-5 question each line comes from.
const TREND_SERIES = [
  { key: 'daily', type: 'daily', field: 'day_rating', label: 'Day rating' },
  { key: 'therapy', type: 'therapy', field: 'mood_after', label: 'Mood after therapy' },
];

// The earliest date to include in the charts, from the selected range ('all' includes everything).
function trendSinceKey() {
  if (selectedTrendRange === 'all') return '0000-00-00';
  return shiftDateKey(todayKey(), -Number(selectedTrendRange));
}

// The dated 1-5 ratings for one series since a date, oldest first; unanswered or invalid ones are skipped.
function collectTrendPoints(series, sinceKey) {
  return journalEntries
    .filter((e) => e.type === series.type && DATE_KEY_RE.test(e.date) && e.date >= sinceKey)
    .map((e) => ({ date: e.date, value: Number(e.answers && e.answers[series.field]) }))
    .filter((pt) => Number.isFinite(pt.value) && pt.value >= 1 && pt.value <= 5)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// The mean rating of a non-empty list of points.
function averageOf(points) {
  return points.reduce((sum, pt) => sum + pt.value, 0) / points.length;
}

// With at least 4 ratings, compare the average of the later half to the earlier half.
function trendDirection(points) {
  if (points.length < 4) return '';
  // Compare equal-sized halves (the middle point of an odd count is left out); half a rating point counts as a real shift.
  const mid = Math.floor(points.length / 2);
  const diff = averageOf(points.slice(-mid)) - averageOf(points.slice(0, mid));
  if (diff >= 0.5) return ', trending up';
  if (diff <= -0.5) return ', trending down';
  return ', steady';
}

// Creates an SVG element with the given attributes (SVG needs its own namespace).
function svgEl(name, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', name);
  Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, String(v)));
  return el;
}

// A date key as a whole-day number, so dates can be spaced out evenly along the chart's x axis.
function epochDays(dateKey) {
  const { y, m, d } = parseDateKey(dateKey);
  return Math.round(Date.UTC(y, m, d) / 86400000);
}

// Draws the 1-5 rating line chart as inline SVG: grid and labels first, then each series' line and dots.
function drawTrendChart(container, seriesPoints) {
  // Drawing area in SVG units (the SVG scales to its box); left/bottom leave room for the labels.
  const W = 640, H = 200, left = 30, right = 14, top = 12, bottom = 28;
  const all = seriesPoints.flatMap((s) => s.points);
  // x spaces points by real calendar days (a gap of a month looks like a month); a single day sits in the middle.
  const minDay = Math.min(...all.map((pt) => epochDays(pt.date)));
  const maxDay = Math.max(...all.map((pt) => epochDays(pt.date)));
  const x = (date) => (maxDay === minDay ? (left + W - right) / 2 : left + ((epochDays(date) - minDay) / (maxDay - minDay)) * (W - left - right));
  // y: rating 5 at the top, 1 at the bottom.
  const y = (value) => top + ((5 - value) / 4) * (H - top - bottom);

  // The chart is a picture to a screen reader, so its title spells out every point.
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  const summary = seriesPoints.map((s) => `${s.label}: ${s.points.map((pt) => `${pt.date} ${pt.value}`).join(', ')}`).join('. ');
  svg.appendChild(svgEl('title', {})).textContent = `Ratings from 1 to 5 over time. ${summary}`;

  for (let v = 1; v <= 5; v++) {
    svg.appendChild(svgEl('line', { class: 'trend-grid', x1: left, x2: W - right, y1: y(v), y2: y(v) }));
    const label = svgEl('text', { class: 'trend-label', x: left - 8, y: y(v) + 4, 'text-anchor': 'end' });
    label.textContent = String(v);
    svg.appendChild(label);
  }
  // Date labels under the first and last points (only one, centred, when every point is on the same day).
  const firstDate = all.reduce((min, pt) => (pt.date < min ? pt.date : min), all[0].date);
  const lastDate = all.reduce((max, pt) => (pt.date > max ? pt.date : max), all[0].date);
  [[firstDate, maxDay === minDay ? 'middle' : 'start'], [lastDate, 'end']].forEach(([date, anchor], i) => {
    if (i === 1 && maxDay === minDay) return;
    const label = svgEl('text', { class: 'trend-label', x: i === 0 ? (maxDay === minDay ? x(date) : left) : W - right, y: H - 8, 'text-anchor': anchor });
    label.textContent = formatDateKeyLong(date);
    svg.appendChild(label);
  });

  seriesPoints.forEach((s) => {
    if (s.points.length > 1) {
      svg.appendChild(svgEl('polyline', { class: `trend-line trend-${s.key}`, points: s.points.map((pt) => `${x(pt.date)},${y(pt.value)}`).join(' ') }));
    }
    s.points.forEach((pt) => {
      const dot = svgEl('circle', { class: `trend-dot trend-${s.key}`, cx: x(pt.date), cy: y(pt.value), r: 4.5 });
      dot.appendChild(svgEl('title', {})).textContent = `${s.label}: ${pt.value} on ${formatDateKeyLong(pt.date)}`;
      svg.appendChild(dot);
    });
  });

  container.innerHTML = '';
  container.appendChild(svg);
}

// Redraws the Trends panel: range chips, the chart (or a "no ratings yet" note), averages
// and the feelings picked most often.
function renderJournalTrends() {
  const details = document.getElementById('journal-trends');
  if (!details) return;
  renderChipFilter(
    document.getElementById('journal-trend-range'),
    [{ key: '30', label: '30 days' }, { key: '90', label: '90 days' }, { key: 'all', label: 'All time' }],
    () => selectedTrendRange,
    (key) => { selectedTrendRange = key; },
    renderJournalTrends
  );

  const since = trendSinceKey();
  const seriesPoints = TREND_SERIES
    .map((s) => ({ ...s, points: collectTrendPoints(s, since) }))
    .filter((s) => s.points.length > 0);
  const chart = document.getElementById('journal-trend-chart');
  const summaryEl = document.getElementById('journal-trend-summary');
  const legend = document.getElementById('journal-trend-legend');
  const feelingsEl = document.getElementById('journal-trend-feelings');

  if (seriesPoints.length === 0) {
    chart.innerHTML = '';
    legend.hidden = true;
    summaryEl.textContent = 'No ratings in this period yet. Answer the 1 to 5 questions in journal and therapy entries to see a trend.';
  } else {
    drawTrendChart(chart, seriesPoints);
    legend.hidden = false;
    summaryEl.textContent = seriesPoints
      .map((s) => `${s.label}: average ${averageOf(s.points).toFixed(1)} across ${s.points.length} entr${s.points.length === 1 ? 'y' : 'ies'}${trendDirection(s.points)}`)
      .join('. ') + '.';
  }

  // Tally the feelings chosen (journal "feeling", dream "felt waking") and show the top five.
  const counts = new Map();
  journalEntries
    .filter((e) => DATE_KEY_RE.test(e.date) && e.date >= since)
    .forEach((e) => {
      const feeling = e.type === 'daily' ? e.answers && e.answers.feeling : e.type === 'dream' ? e.answers && e.answers.felt_waking : null;
      if (feeling) counts.set(feeling, (counts.get(feeling) || 0) + 1);
    });
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  feelingsEl.textContent = top.length ? `Feelings you chose most: ${top.map(([name, n]) => `${name} \u00d7${n}`).join(', ')}.` : '';
}

// Redraw the Trends panel each time it is opened or closed so it always shows current entries.
document.getElementById('journal-trends').addEventListener('toggle', renderJournalTrends);

// Short label for an entry's date chip, e.g. "Mar 4" (with the year only if it isn't this year).
function journalChipLabel(entry) {
  if (!DATE_KEY_RE.test(entry.date)) return entry.date;
  const { y, m, d } = parseDateKey(entry.date);
  const thisYear = new Date().getFullYear();
  return `${MONTH_NAMES[m].slice(0, 3)} ${d}${y === thisYear ? '' : ` '${String(y).slice(2)}`}`;
}

// One button per entry, in the same order as the cards; tapping one scrolls
// the timeline to that entry.
function renderJournalDateStrip(visible) {
  const strip = document.getElementById('journal-date-strip');
  strip.innerHTML = '';
  visible.forEach((entry) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'journal-date-chip';
    chip.dataset.entryId = entry.id;
    chip.textContent = journalChipLabel(entry);
    const kind = document.createElement('small');
    kind.textContent = { dream: 'D', therapy: 'T', daily: 'J' }[entry.type] || '?';
    kind.title = JOURNAL_TEMPLATES[entry.type].label;
    chip.appendChild(kind);
    // Spell the type out for screen readers (otherwise the chip reads like "Mar 4J").
    chip.setAttribute('aria-label', `${journalChipLabel(entry)}, ${JOURNAL_TEMPLATES[entry.type].label}`);
    chip.addEventListener('click', () => {
      journalActiveOverride = entry.id;
      scrollJournalToEntry(entry.id);
      updateJournalActiveDate();
    });
    strip.appendChild(chip);
  });
}

// Smoothly scrolls the card row so the chosen entry is at the left edge.
function scrollJournalToEntry(id) {
  const list = document.getElementById('journal-list');
  const card = [...list.children].find((c) => c.dataset.entryId === id);
  if (!card) return;
  const delta = card.getBoundingClientRect().left - list.getBoundingClientRect().left;
  list.scrollTo({ left: list.scrollLeft + delta, behavior: 'smooth' });
}

// Highlights the date chip of the card currently at the left edge and keeps
// that chip visible inside the date strip.
function updateJournalActiveDate() {
  const list = document.getElementById('journal-list');
  const strip = document.getElementById('journal-date-strip');
  const cards = [...list.children];
  if (cards.length === 0) return;
  const listLeft = list.getBoundingClientRect().left;
  let active = cards[0];
  let best = Infinity;
  cards.forEach((card) => {
    const distance = Math.abs(card.getBoundingClientRect().left - listLeft);
    if (distance < best) { best = distance; active = card; }
  });
  // At the far right the last card may never reach the left edge; treat the
  // end of the scroll range as "newest".
  if (list.scrollLeft + list.clientWidth >= list.scrollWidth - 2) active = cards[cards.length - 1];
  // The last few cards can't reach the left edge (the row runs out of room), so
  // honour a date the reader just tapped instead of the geometric guess.
  const pinned = journalActiveOverride && cards.find((c) => c.dataset.entryId === journalActiveOverride);
  if (pinned) active = pinned;
  strip.querySelectorAll('.journal-date-chip').forEach((chip) => {
    const isActive = chip.dataset.entryId === active.dataset.entryId;
    chip.classList.toggle('journal-date-chip-active', isActive);
    if (isActive) chip.setAttribute('aria-current', 'true');
    else chip.removeAttribute('aria-current');
    if (isActive) strip.scrollLeft = chip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2;
  });
}

// Scrolling is handled at most once per animation frame so the date strip stays smooth.
let journalScrollFrame = null;
const journalListEl = document.getElementById('journal-list');
journalListEl.addEventListener('scroll', () => {
  const list = journalListEl;
  if (journalScrollFrame) return;
  journalScrollFrame = requestAnimationFrame(() => {
    journalScrollFrame = null;
    if (list.clientWidth > 0) journalLastScrollLeft = list.scrollLeft;
    updateJournalActiveDate();
  });
});

// Scrolls the card row by about a screenful; direction is -1 (back) or 1 (forward).
function scrollJournalByPage(direction) {
  journalActiveOverride = null;
  const list = document.getElementById('journal-list');
  list.scrollBy({ left: direction * Math.max(200, list.clientWidth * 0.8), behavior: 'smooth' });
}

document.getElementById('journal-scroll-prev').addEventListener('click', () => scrollJournalByPage(-1));
document.getElementById('journal-scroll-next').addEventListener('click', () => scrollJournalByPage(1));
// Once the reader scrolls or touches the row themselves, stop forcing the tapped date chip to stay highlighted.
['wheel','touchstart', 'pointerdown', 'keydown'].forEach((evt) => {
  journalListEl.addEventListener(evt, () => { journalActiveOverride = null; }, { passive: true });
});

// The three "New ..." buttons start a wizard of that type (asking first if one is already in progress).
document.querySelectorAll('.journal-start-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (journalDraft && !window.confirm('Discard the entry you are writing?')) return;
    openJournalWizard(btn.dataset.journalType, null);
  });
});

// Next / Enter: keep what was typed, then go to the next question, or save after the last one.
document.getElementById('journal-wizard').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!journalDraft) return;
  captureJournalAnswer();
  const total = JOURNAL_TEMPLATES[journalDraft.type].questions.length;
  if (journalDraft.step >= total) {
    finishJournalEntry();
  } else {
    journalDraft.step += 1;
    renderJournalStep();
  }
});

// Back: keep what was typed, then return to the previous step.
document.getElementById('journal-back-btn').addEventListener('click', () => {
  if (!journalDraft || journalDraft.step === 0) return;
  captureJournalAnswer();
  journalDraft.step -= 1;
  renderJournalStep();
});

// Skip: move to the next question without requiring an answer.
document.getElementById('journal-skip-btn').addEventListener('click', () => {
  if (!journalDraft) return;
  // Skip moves on without requiring an answer, but anything already typed is kept.
  captureJournalAnswer();
  journalDraft.step += 1;
  renderJournalStep();
});

document.getElementById('journal-cancel-btn').addEventListener('click', closeJournalWizard);

// Shows a message under the journal backup buttons; tone is 'ok' or 'failed'.
function setJournalBackupStatus(text, tone) {
  const el = document.getElementById('journal-backup-status');
  el.textContent = text;
  el.hidden = false;
  el.classList.toggle('sync-ok', tone === 'ok');
  el.classList.toggle('sync-failed', tone === 'failed');
}

// Guards a restore from a backup file: true only for entries with an id, a known type, a date and answers.
function isValidJournalEntry(item) {
  return !!item && typeof item.id === 'string' && !!JOURNAL_TEMPLATES[item.type]
    && isRealDateKey(item.date) && !!item.answers && typeof item.answers === 'object'
    && !Array.isArray(item.answers)
    && Object.values(item.answers).every((v) => typeof v === 'string' || typeof v === 'number');
}

// Adds entries that are valid and not already here (matched by id). Returns how many were added.
function mergeJournalEntries(incoming) {
  const known = new Set(journalEntries.map((x) => x.id));
  const deleted = new Set(loadDeletedJournalIds()); // entries you deleted stay deleted
  let added = 0;
  incoming.forEach((item) => {
    if (!isValidJournalEntry(item) || known.has(item.id) || deleted.has(item.id)) return;
    known.add(item.id);
    journalEntries.push(item);
    added += 1;
  });
  if (added > 0) {
    saveJournalEntries();
    renderJournal();
  }
  return added;
}

// Downloads the journal as its own JSON file (the journal is not part of syncing) and notes the time.
function downloadJournalBackup() {
  recordBackupTime(JOURNAL_BACKUP_AT_KEY);
  const json = JSON.stringify({ journal: journalEntries }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `second-memory-journal-${todayForFilename()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000); // revoking at once can cancel the download on iOS/Safari
  setJournalBackupStatus('Journal backup downloaded. Keep the file somewhere private.', 'ok');
  renderBackupNotes();
}

document.getElementById('journal-export-btn').addEventListener('click', downloadJournalBackup);

// "Restore" opens the hidden file picker.
document.getElementById('journal-import-btn').addEventListener('click', () => {
  document.getElementById('journal-import-file').click();
});

// Reads the chosen journal backup and merges in the entries this device does not have.
document.getElementById('journal-import-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = ''; // so choosing the same file again still fires "change"
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(reader.result);
    } catch {
      setJournalBackupStatus('Restore failed \u2014 that file is not valid JSON.', 'failed');
      return;
    }
    const incoming = parsed && Array.isArray(parsed.journal) ? parsed.journal : null;
    if (!incoming) {
      setJournalBackupStatus("Restore failed \u2014 that file doesn't look like a journal backup.", 'failed');
      return;
    }
    const added = mergeJournalEntries(incoming);
    setJournalBackupStatus(
      added > 0 ? `Restored ${added} entr${added === 1 ? 'y' : 'ies'}.` : 'Restore complete \u2014 nothing new to add.',
      'ok'
    );
  };
  reader.onerror = () => setJournalBackupStatus('Restore failed \u2014 could not read that file.', 'failed');
  reader.readAsText(file);
});

// ---- Therapy summary ----
// A read/copy/print view of the most recent therapy session entries, plus what
// you wrote in your daily journal since the last session, to bring to the next
// one. Built only from entries already on this device; printing uses the
// browser's own Print / Save as PDF.

// Therapy-session questions shown in the summary, with their wording there (order = display order).
const SUMMARY_LABELS = {
  topics: 'What we talked about',
  insight: 'Biggest insight',
  hard: 'What felt hard',
  mood_after: 'How I felt after (1 to 5)',
  homework: 'Homework / things to try',
  next: 'To bring up next time',
};

// The most recent therapy sessions, newest first, up to limit.
function therapySessions(limit) {
  return journalEntries
    .filter((e) => e.type === 'therapy' && DATE_KEY_RE.test(e.date))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : String(b.dateAdded || '').localeCompare(String(a.dateAdded || ''))))
    .slice(0, limit);
}

// The answered summary questions of one session as { label, text } pairs.
function sessionLines(entry) {
  return Object.keys(SUMMARY_LABELS)
    .filter((id) => hasJournalAnswer(entry.answers && entry.answers[id]))
    .map((id) => ({
      label: SUMMARY_LABELS[id],
      text: id === 'mood_after' ? `${entry.answers[id]} / 5` : String(entry.answers[id]),
    }));
}

// Daily journal entries written after the most recent session: how the days went
// and what was hard, so nothing is forgotten between appointments.
function sinceLastSession(latestSessionDate) {
  const entries = journalEntries
    .filter((e) => e.type === 'daily' && DATE_KEY_RE.test(e.date) && e.date > latestSessionDate)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const ratings = entries.map((e) => Number(e.answers && e.answers.day_rating)).filter((n) => Number.isFinite(n) && n >= 1 && n <= 5);
  return {
    entries,
    averageRating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
    hard: entries
      .filter((e) => hasJournalAnswer(e.answers && e.answers.hard))
      .map((e) => ({ date: e.date, text: String(e.answers.hard) })),
  };
}

// The "to bring up next time" note from the most recent session that has one. If the very
// latest session left it blank, an older note is still shown, labelled with its date.
function latestBringUpNote(sessions) {
  const withNote = sessions.find((s) => hasJournalAnswer(s.answers && s.answers.next));
  if (!withNote) return null;
  return { text: String(withNote.answers.next), date: withNote.date, fromLatest: withNote === sessions[0] };
}

// Heading for the bring-up note; adds the date when it comes from an older session.
function bringUpHeading(note) {
  return note.fromLatest ? 'To bring up next time' : `To bring up next time (from ${formatDateKeyLong(note.date)})`;
}

// Gathers what the summary shows: the recent sessions and the journal activity since the latest one.
function buildTherapySummaryData(limit) {
  const sessions = therapySessions(limit);
  const since = sessions.length ? sinceLastSession(sessions[0].date) : null;
  return { sessions, since };
}

// The same summary as plain text, for the Copy button.
function buildTherapySummaryText({ sessions, since }) {
  if (sessions.length === 0) return 'No therapy sessions logged yet.';
  const lines = [`Therapy summary (${sessions.length} most recent session${sessions.length === 1 ? '' : 's'})`, `Prepared ${formatDateKeyLong(todayKey())}`, ''];
  const note = latestBringUpNote(sessions);
  if (note) lines.push(bringUpHeading(note).toUpperCase(), note.text, '');
  if (since && since.entries.length) {
    lines.push(`SINCE THE LAST SESSION (${formatDateKeyLong(sessions[0].date)})`);
    lines.push(`${since.entries.length} journal entr${since.entries.length === 1 ? 'y' : 'ies'}` + (since.averageRating !== null ? `, average day rating ${since.averageRating.toFixed(1)} / 5` : ''));
    since.hard.forEach((h) => lines.push(`- ${formatDateKeyLong(h.date)}: ${h.text}`));
    lines.push('');
  }
  sessions.forEach((s) => {
    lines.push(`SESSION: ${formatDateKeyLong(s.date)}`);
    sessionLines(s).forEach((l) => lines.push(`${l.label}: ${l.text}`));
    lines.push('');
  });
  return lines.join('\n').trim();
}

// Fills the summary sheet: the bring-up note, the journal since the last session, then each session.
function renderTherapySummary() {
  const body = document.getElementById('therapy-summary-body');
  const limit = Number(document.getElementById('therapy-summary-count').value) || 5;
  const data = buildTherapySummaryData(limit);
  body.innerHTML = '';

  const title = document.createElement('h2');
  title.id = 'therapy-summary-title';
  title.textContent = 'Therapy summary';
  body.appendChild(title);
  const meta = document.createElement('p');
  meta.className = 'summary-meta';
  meta.textContent = `Prepared ${formatDateKeyLong(todayKey())}`;
  body.appendChild(meta);

  const hasSessions = data.sessions.length > 0;
  document.getElementById('therapy-summary-print').disabled = !hasSessions;
  document.getElementById('therapy-summary-copy').disabled = !hasSessions;
  if (!hasSessions) {
    const none = document.createElement('p');
    none.textContent = 'No therapy sessions logged yet. Add a therapy session entry first, then come back here.';
    body.appendChild(none);
    return;
  }

  const note = latestBringUpNote(data.sessions);
  if (note) {
    const h = document.createElement('h3');
    h.textContent = bringUpHeading(note);
    const t = document.createElement('p');
    t.style.whiteSpace = 'pre-wrap';
    t.textContent = note.text;
    body.append(h, t);
  }

  if (data.since && data.since.entries.length) {
    const h = document.createElement('h3');
    h.textContent = `Since the last session (${formatDateKeyLong(data.sessions[0].date)})`;
    const summary = document.createElement('p');
    summary.className = 'summary-meta';
    summary.textContent = `${data.since.entries.length} journal entr${data.since.entries.length === 1 ? 'y' : 'ies'}` +
      (data.since.averageRating !== null ? `, average day rating ${data.since.averageRating.toFixed(1)} / 5` : '');
    body.append(h, summary);
    if (data.since.hard.length) {
      const list = document.createElement('ul');
      data.since.hard.forEach((item) => {
        const li = document.createElement('li');
        li.textContent = `${formatDateKeyLong(item.date)}: ${item.text}`;
        list.appendChild(li);
      });
      body.appendChild(list);
    }
  }

  data.sessions.forEach((session) => {
    const wrap = document.createElement('div');
    wrap.className = 'summary-session';
    const h = document.createElement('h3');
    h.textContent = formatDateKeyLong(session.date);
    wrap.appendChild(h);
    const dl = document.createElement('dl');
    sessionLines(session).forEach((l) => {
      const dt = document.createElement('dt');
      dt.textContent = l.label;
      const dd = document.createElement('dd');
      dd.textContent = l.text;
      dl.append(dt, dd);
    });
    wrap.appendChild(dl);
    body.appendChild(wrap);
  });
}

// The control to hand focus back to when the summary sheet closes.
let summaryReturnFocus = null;

// Shows a short message in the summary sheet (such as "Copied"); an empty message hides it.
function setSummaryStatus(text) {
  const el = document.getElementById('therapy-summary-status');
  el.textContent = text;
  el.hidden = !text;
}

// Opens the summary sheet and moves focus into it.
function openTherapySummary() {
  summaryReturnFocus = document.getElementById('therapy-summary-btn');
  setSummaryStatus('');
  renderTherapySummary();
  document.getElementById('therapy-summary').hidden = false;
  document.body.classList.add('summary-open');
  document.getElementById('therapy-summary-close').focus();
}

// Closes the summary sheet and returns focus to the button that opened it.
function closeTherapySummary() {
  document.getElementById('therapy-summary').hidden = true;
  document.body.classList.remove('summary-open');
  if (summaryReturnFocus && document.contains(summaryReturnFocus)) summaryReturnFocus.focus();
}

// Summary sheet controls: open, close, change how many sessions, print, and copy as text.
document.getElementById('therapy-summary-btn').addEventListener('click', openTherapySummary);
document.getElementById('therapy-summary-close').addEventListener('click', closeTherapySummary);
document.getElementById('therapy-summary-count').addEventListener('change', renderTherapySummary);
document.getElementById('therapy-summary-print').addEventListener('click', () => window.print());
document.getElementById('therapy-summary-copy').addEventListener('click', async () => {
  const text = buildTherapySummaryText(buildTherapySummaryData(Number(document.getElementById('therapy-summary-count').value) || 5));
  try {
    await navigator.clipboard.writeText(text);
    setSummaryStatus('Copied. Paste it into a message or note.');
  } catch {
    // Clipboard access can be blocked: fall back to selecting the text so Copy works by hand.
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('therapy-summary-body'));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    setSummaryStatus('Your browser blocked copying. The summary is selected: press Ctrl+C (or Cmd+C).');
  }
});

// Esc closes; Tab stays inside the sheet while it is open (listening on the document, because
// after clicking the summary text focus is on the page body, not inside the dialog).
document.addEventListener('keydown', (e) => {
  const overlay = document.querySelector('.summary-overlay:not([hidden])');
  if (!overlay) return;
  if (e.key === 'Escape') { closeTherapySummary(); return; }
  if (e.key !== 'Tab') return;
  const focusable = [...overlay.querySelectorAll('select, button:not(:disabled)')];
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const inside = overlay.contains(document.activeElement);
  if (!inside || (e.shiftKey && document.activeElement === first)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

// ---- Backup reminders ----
// The sync server's copy is only a temporary convenience (it can reset), so the real backups
// are downloads: the journal file (which only this device holds) and the full export.
// Browsers can't write files in the background, so the app tracks the last
// download and nags when it is overdue.

// Where the time of the last journal backup / full export is remembered, and how many days before a reminder.
const JOURNAL_BACKUP_AT_KEY = 'secondMemory.journalBackupAt.v1';
const EXPORT_AT_KEY = 'secondMemory.exportAt.v1';
const JOURNAL_BACKUP_DUE_DAYS = 7;
const EXPORT_DUE_DAYS = 7;

// Remembers that a backup file was just downloaded.
function recordBackupTime(key) {
  try { localStorage.setItem(key, new Date().toISOString()); } catch { /* storage full: nothing to remember it in */ }
}

// Whole days since the last backup, or null if there has never been one.
function daysSinceBackup(key) {
  try {
    const value = localStorage.getItem(key);
    if (!value) return null;
    const ms = Date.now() - new Date(value).getTime();
    return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86400000)) : null;
  } catch {
    return null;
  }
}

// "never", "today", "yesterday" or "N days ago" for the backup reminders.
function backupAgeText(days) {
  if (days === null) return 'never';
  if (days === 0) return 'today';
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

// Set when the user dismisses the backup reminders; they stay hidden until the page is reloaded.
let backupNotesDismissed = false;

// Updates the "last journal backup" line and shows Home reminders when the journal or the
// full export is overdue for a backup, or when a set-up sync has not run for a while.
function renderBackupNotes() {
  const lastEl = document.getElementById('journal-backup-last');
  if (lastEl) lastEl.textContent = `Last journal backup: ${backupAgeText(daysSinceBackup(JOURNAL_BACKUP_AT_KEY))}`;

  const box = document.getElementById('home-backup-notes');
  if (!box) return;
  box.innerHTML = '';
  const reminders = [];
  const journalDays = daysSinceBackup(JOURNAL_BACKUP_AT_KEY);
  if (journalEntries.length > 0 && (journalDays === null || journalDays >= JOURNAL_BACKUP_DUE_DAYS)) {
    reminders.push({
      text: `Your journal lives only on this device, and it ${journalDays === null ? 'has never been backed up' : `was last backed up ${backupAgeText(journalDays)}`}.`,
      label: 'Back up journal',
      action: downloadJournalBackup,
    });
  }
  const hasAnyData = SYNC_COLLECTIONS.some((c) => c.get().some((r) => !r.deleted));
  const exportDays = daysSinceBackup(EXPORT_AT_KEY);
  if (hasAnyData && (exportDays === null || exportDays >= EXPORT_DUE_DAYS)) {
    reminders.push({
      text: `You haven't downloaded a full backup of everything ${exportDays === null ? 'yet' : `in ${exportDays} days`}. It includes your journal. Synced lists are also copied to the sync server, but that copy can be reset.`,
      label: 'Download full backup',
      action: exportData,
    });
  }
  // Nudge when it has been a while since a sync (only on devices where sync is set up; auto-sync normally prevents this).
  if (loadSyncConfig()) {
    const syncDays = daysSinceBackup(LAST_SYNC_AT_KEY);
    if (syncDays === null) {
      recordBackupTime(LAST_SYNC_AT_KEY); // start the clock the first time we notice sync is on
    } else if (syncDays >= SYNC_STALE_DAYS) {
      reminders.push({
        text: `You haven't synced in ${syncDays} days. Changes on this device are not on your other devices yet.`,
        label: 'Sync now',
        action: runSync,
      });
    }
  }
  box.hidden = backupNotesDismissed || reminders.length === 0;
  reminders.forEach((reminder) => {
    const row = document.createElement('div');
    row.className = 'reminder-banner';
    const text = document.createElement('span');
    text.className = 'reminder-banner-text';
    text.textContent = reminder.text;
    const act = document.createElement('button');
    act.type = 'button';
    act.className = 'reminder-banner-btn';
    act.textContent = reminder.label;
    act.addEventListener('click', reminder.action);
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'reminder-banner-btn';
    dismiss.setAttribute('aria-label', 'Dismiss backup reminders');
    dismiss.textContent = '\u00d7';
    dismiss.addEventListener('click', () => { backupNotesDismissed = true; box.hidden = true; });
    row.append(text, act, dismiss);
    box.appendChild(row);
  });
}

// ---- Search everything ----
// One box on Home that looks across every list at once. It uses the same matching rule as each
// tab's own search box (the whole phrase, ignoring case), and tapping a result opens that tab
// with its search box filled in. The journal is private, so it is only searched when you tick
// "Include my journal".

const SEARCH_RESULTS_PER_GROUP = 5;
const SEARCH_MIN_LENGTH = 2;

// What the Home search looks through. For each list: the tab to open, the heading, that tab's
// own search box (inputId, or null if it has none), a getter for its records, how to title a
// result, and which fields are searched.
const SEARCH_SOURCES = [
  { tab: 'books', label: 'Books', inputId: 'books-search-input', items: () => books, title: (b) => b.title, fields: (b) => [b.title, b.author] },
  { tab: 'recipes', label: 'Recipes', inputId: 'recipes-search-input', items: () => recipes, title: (r) => r.title, fields: (r) => [r.title, r.category, ...(r.ingredients || []), ...(r.steps || []), r.notes] },
  { tab: 'notes', label: 'Notes', inputId: 'notes-search-input', items: () => notes, title: (n) => n.title || '(untitled note)', fields: (n) => [n.title, n.body] },
  { tab: 'resume', label: 'Resume & Portfolio', inputId: 'resume-search-input', items: () => links, title: (l) => l.label, fields: (l) => [l.label, l.url, l.notes] },
];

// Same shape as SEARCH_SOURCES, but only used when "Include my journal" is ticked.
const JOURNAL_SEARCH_SOURCE = {
  tab: 'journal', label: 'Journal', inputId: 'journal-search-input', items: () => journalEntries,
  title: (e) => `${(JOURNAL_TEMPLATES[e.type] || { label: 'Entry' }).label} \u00b7 ${DATE_KEY_RE.test(e.date) ? formatDateKeyLong(e.date) : e.date}`,
  fields: (e) => [(JOURNAL_TEMPLATES[e.type] || {}).label, e.date, ...Object.values(e.answers || {})],
};

// The first matching field, trimmed to a short excerpt around the match.
function searchSnippet(values, needle) {
  for (const value of values) {
    const text = String(value || '');
    const at = text.toLowerCase().indexOf(needle);
    if (at === -1) continue;
    // Show a little context: 30 characters before the match, 50 after.
    const start = Math.max(0, at - 30);
    const end = Math.min(text.length, at + needle.length + 50);
    return {
      before: (start > 0 ? '\u2026' : '') + text.slice(start, at),
      match: text.slice(at, at + needle.length),
      after: text.slice(at + needle.length, end) + (end < text.length ? '\u2026' : ''),
    };
  }
  return null;
}

// Searches every source for the phrase and returns the sources that have hits ([] if the phrase is too short).
function runGlobalSearch(term, includeJournal) {
  const needle = term.trim().toLowerCase();
  if (needle.length < SEARCH_MIN_LENGTH) return [];
  const sources = includeJournal ? [...SEARCH_SOURCES, JOURNAL_SEARCH_SOURCE] : SEARCH_SOURCES;
  const groups = [];
  sources.forEach((source) => {
    const hits = [];
    source.items().forEach((item) => {
      if (item.deleted) return; // removed records stay in the list as tombstones
      const values = source.fields(item);
      // Match against all the fields joined by spaces, like each tab's own search box does.
      const haystack = values.map((v) => String(v || '')).join(' ').toLowerCase();
      if (!haystack.includes(needle)) return;
      hits.push({ title: source.title(item), snippet: searchSnippet(values, needle) });
    });
    if (hits.length) groups.push({ source, hits });
  });
  return groups;
}

// Opens the result's tab and fills in that tab's own search box so the list is filtered to match.
function openSearchResult(source, term) {
  goToTab(source.tab);
  const input = source.inputId && document.getElementById(source.inputId);
  if (input) {
    input.value = term.trim();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// Redraws the Home search results: a hint, a "nothing found" note, or hits grouped by list.
function renderGlobalSearch() {
  const termInput = document.getElementById('global-search-input');
  const resultsEl = document.getElementById('global-search-results');
  const home = document.getElementById('home-collection');
  const term = termInput.value;
  const searching = term.trim().length > 0;
  home.classList.toggle('is-searching', searching);
  resultsEl.innerHTML = '';
  resultsEl.hidden = !searching;
  if (!searching) return;

  if (term.trim().length < SEARCH_MIN_LENGTH) {
    const hint = document.createElement('p');
    hint.className = 'empty-state';
    hint.textContent = `Type at least ${SEARCH_MIN_LENGTH} letters.`;
    resultsEl.appendChild(hint);
    return;
  }

  const groups = runGlobalSearch(term, document.getElementById('global-search-journal').checked);
  if (groups.length === 0) {
    const none = document.createElement('p');
    none.className = 'empty-state';
    none.textContent = `Nothing found for "${term.trim()}".`;
    resultsEl.appendChild(none);
    return;
  }

  groups.forEach(({ source, hits }) => {
    const heading = document.createElement('h3');
    heading.textContent = `${source.label} (${hits.length})`;
    resultsEl.appendChild(heading);
    const list = document.createElement('ul');
    hits.slice(0, SEARCH_RESULTS_PER_GROUP).forEach((hit) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'search-hit';
      const title = document.createElement('span');
      title.className = 'search-hit-title';
      title.textContent = hit.title;
      btn.appendChild(title);
      if (hit.snippet) {
        const snip = document.createElement('span');
        snip.className = 'search-hit-snippet';
        const mark = document.createElement('mark');
        mark.textContent = hit.snippet.match;
        snip.append(hit.snippet.before, mark, hit.snippet.after);
        btn.appendChild(snip);
      }
      btn.addEventListener('click', () => openSearchResult(source, term));
      li.appendChild(btn);
      list.appendChild(li);
    });
    if (hits.length > SEARCH_RESULTS_PER_GROUP) {
      const li = document.createElement('li');
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'search-hit search-more';
      more.textContent = `See all ${hits.length} in ${source.label}`;
      more.addEventListener('click', () => openSearchResult(source, term));
      li.appendChild(more);
      list.appendChild(li);
    }
    resultsEl.appendChild(list);
  });
}

// Search results are a snapshot, so redraw them when Home is opened again (an item may have been
// deleted or edited on another tab meanwhile) and whenever Home itself is redrawn (see renderHome).
document.querySelector('.nav-item[data-tab="home"]').addEventListener('click', renderGlobalSearch);
document.getElementById('global-search-input').addEventListener('input', renderGlobalSearch);
document.getElementById('global-search-journal').addEventListener('change', renderGlobalSearch);
// Recent searches: the last few terms, as chips under the box while it is empty. Kept on this device only, and
// never when the search includes the private journal (those terms could reveal what you wrote about).
const RECENT_SEARCHES_KEY = 'secondMemory.recentSearches.v1';
const RECENT_SEARCHES_KEPT = 5;

// The saved terms (damaged data becomes an empty list).
function loadRecentSearches() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY));
    return Array.isArray(raw) ? raw.filter((s) => typeof s === 'string' && s.trim()).slice(0, RECENT_SEARCHES_KEPT) : [];
  } catch {
    return [];
  }
}

// Remembers a term (newest first, no repeats ignoring case).
function saveRecentSearch(term) {
  const clean = String(term || '').trim();
  if (clean.length < SEARCH_MIN_LENGTH || document.getElementById('global-search-journal').checked) return;
  const next = [clean, ...loadRecentSearches().filter((s) => s.toLowerCase() !== clean.toLowerCase())].slice(0, RECENT_SEARCHES_KEPT);
  try { localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next)); } catch { /* not saved: nothing breaks */ }
  renderRecentSearches();
}

// Draws the chips; they show only while the search box is empty.
function renderRecentSearches() {
  const box = document.getElementById('global-search-recent');
  const input = document.getElementById('global-search-input');
  const terms = loadRecentSearches();
  box.innerHTML = '';
  box.hidden = terms.length === 0 || input.value.trim() !== '';
  terms.forEach((term) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = term;
    chip.addEventListener('click', () => {
      input.value = term;
      renderGlobalSearch();
      renderRecentSearches();
      input.focus();
    });
    box.appendChild(chip);
  });
  if (terms.length > 0) {
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'chip';
    clear.textContent = 'Clear';
    clear.addEventListener('click', () => {
      try { localStorage.removeItem(RECENT_SEARCHES_KEY); } catch { /* nothing to remove it from */ }
      renderRecentSearches();
    });
    box.appendChild(clear);
  }
}

document.getElementById('global-search-input').addEventListener('input', renderRecentSearches);
document.getElementById('global-search-input').addEventListener('change', (e) => saveRecentSearch(e.target.value)); // Enter or leaving the box
renderRecentSearches();

// Esc clears the search box and brings the normal Home panels back.
document.getElementById('global-search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.target.value = '';
    renderGlobalSearch();
    renderRecentSearches();
  }
});

// ---- Home ----
// Pure, render-only aggregation over the live lists: no own storage key, nothing to
// sync/export/undo. Called at the end of the books, recipes, medications, weight, to-do and
// shopping renderers (the lists Home reads) rather than at every mutation. Only the Customize
// Home choices (applyHomePanelChoices) are stored, on this device.

// Books marked "currently reading", ordered by author.
function computeCurrentlyReading(nonDeletedBooks) {
  return nonDeletedBooks.filter((b) => b.status === 'currently_reading').sort(BOOK_SORTS.author_asc);
}

// Redraws the Home dashboard: backup nudges, search results and the books being read. (The to-do list, shopping
// list, refills, weight and pinned recipes that used to show here moved to other apps.)
function renderHome() {
  renderBackupNotes();
  renderGlobalSearch(); // keep any open search results in step with the data
  const currentlyReading = computeCurrentlyReading(books.filter((b) => !b.deleted));

  const statsEl = document.getElementById('home-stats');
  const emptyEl = document.getElementById('home-empty-state');
  const readingPanel = document.getElementById('home-reading-panel');
  const readingList = document.getElementById('home-reading-list');
  readingList.innerHTML = '';
  statsEl.hidden = true;

  // One Home row: a button (filled in by buildContent) that jumps to the tab.
  function makeHomeRow(onClick, buildContent) {
    const li = document.createElement('li');
    li.className = 'home-item';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'home-item-link';
    buildContent(btn);
    btn.addEventListener('click', onClick);
    li.appendChild(btn);
    return li;
  }

  // Books currently being read.
  readingPanel.hidden = currentlyReading.length === 0;
  currentlyReading.forEach((book) => {
    readingList.appendChild(makeHomeRow(() => goToTab('books'), (btn) => {
      const title = document.createElement('strong');
      title.className = 'book-title';
      title.textContent = book.title;
      const author = document.createElement('span');
      author.className = 'book-author';
      author.textContent = book.author || '';
      btn.append(title, author);
    }));
  });

  // The "all caught up" message shows when no panel has anything to say.
  emptyEl.hidden = currentlyReading.length > 0;

  applyHomePanelChoices();
}

// ---- Device Sync ----
// Optional: the app is fully functional offline with no sync configured, and
// keeps working from local data if the server is ever unreachable — sync only
// happens when the user presses "Sync now", and is never a requirement for any UI action.

// The only address the app ever talks to: "Sync now" sends data there, and opening the app sends it
// one plain request with no data so a sleeping free-plan server wakes up in time.
const SYNC_SERVER_URL = 'https://second-memory-mwm3.onrender.com';

const SYNC_CONFIG_KEY = 'secondMemory.syncConfig.v1';

// Reads the saved sync settings (the access token); null if none, or if they are from the old server.
function loadSyncConfig() {
  try {
    const raw = localStorage.getItem(SYNC_CONFIG_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    // Old pre-Render config was {serverUrl, token}; treat the whole object as
    // stale rather than reusing its token against the new server.
    if (parsed && typeof parsed === 'object' && 'serverUrl' in parsed) return null;
    if (parsed && parsed.token) return parsed;
  } catch {
    // fall through
  }
  return null;
}

// Saves the sync settings on this device only.
function saveSyncConfig(config) {
  localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(config));
}

// Maps each collection to the wire-protocol name the server expects, its
// localStorage key, and how to read/replace/render it — lets the sync
// function stay generic instead of one hand-written copy per list.
const SYNC_COLLECTIONS = [
  { name: 'books', label: 'Books', key: BOOKS_KEY, get: () => books, set: (v) => { books = v; }, render: renderBooks, delete: deleteBook, restore: restoreBook },
  { name: 'recipes', label: 'Recipes', key: RECIPES_KEY, get: () => recipes, set: (v) => { recipes = v; }, render: renderRecipes, delete: deleteRecipe, restore: restoreRecipe },
  { name: 'notes', label: 'Notes', key: NOTES_KEY, get: () => notes, set: (v) => { notes = v; }, render: renderNotes, delete: deleteNote, restore: restoreNote },
  { name: 'links', label: 'Resume', key: LINKS_KEY, get: () => links, set: (v) => { links = v; }, render: renderLinks, delete: deleteLink, restore: restoreLink },
];

// ---- Undo/redo application mechanics ----
// Applies one side (`before` on undo, `after` on redo) of a recorded entry
// back onto the live collection, generalized across every synced collection via
// the get/set/render/delete/restore lookup above.

// Replays one recorded change onto the live record. which is 'before' (undo) or 'after' (redo).
// Adds and deletes go through the collection's own delete/restore; edits copy back only the fields that changed.
function applyEntrySnapshot(entry, which) {
  // Find the collection and the live record this entry is about.
  const target = entry[which]; // 'before' on undo, 'after' on redo
  const cfg = SYNC_COLLECTIONS.find((c) => c.name === entry.collection);
  if (!cfg) return;
  const items = cfg.get();
  const record = items.find((r) => r.id === entry.id);

  // Case 1: the target state is "didn't exist", so soft-delete the record.
  if (target === null) {
    // Undoing an "add": there is no prior state, so the record must be
    // removed. Reuse the collection's own deleteX (tombstone), never a splice.
    if (record && !record.deleted) cfg.delete(entry.id);
    return;
  }

  if (!record) return; // defensive: the record is gone entirely (records are tombstoned, never removed, so this should not happen)

  // Case 2: the target state is deleted. Case 3: it is live but the record is deleted, so restore it first.
  if (target.deleted && !record.deleted) {
    cfg.delete(entry.id);
    return;
  }
  if (!target.deleted && record.deleted) {
    cfg.restore(entry.id); // un-tombstone via restoreX first
  }

  // Re-clone the target on every application — never assign the stack
  // entry's own nested objects/arrays into the live record. This is the
  // same reference-aliasing risk noted for the original mutation functions,
  // applied here to the new engine: without this clone, a field like
  // Recipes' `ingredients` array would end up shared between the live
  // record and the entry still sitting in the opposite stack, so a later
  // in-place mutation could silently corrupt history.
  const snapshot = structuredClone(target);
  const other = entry[which === 'before' ? 'after' : 'before'];
  const BOOKKEEPING = ['id', 'dateAdded', 'version', 'updatedAt', 'deviceId', 'deleted'];
  // Apply the field-by-field difference, then stamp, save and redraw this one collection.
  // Only fields this history entry actually changed are applied, so undo can
  // never revert fields changed elsewhere since (e.g. taken dates that arrived
  // from another device). A field the snapshot lacks (set on a record that
  // predates it) is removed again. Bookkeeping fields are never replayed:
  // version is server-assigned, updatedAt/deviceId are freshly stamped below
  // because this undo IS a new local mutation, `deleted` is handled above.
  new Set([...Object.keys(snapshot), ...Object.keys(other || {})]).forEach((key) => {
    if (BOOKKEEPING.includes(key)) return;
    if (other && JSON.stringify(snapshot[key]) === JSON.stringify(other[key])) return;
    if (key in snapshot) record[key] = snapshot[key];
    else delete record[key];
  });
  stampSync(record);
  saveCollection(cfg.key, items);
  cfg.render(); // only this one collection re-renders — never the whole app
}

// Steps back the most recent change and moves it onto the redo list.
function undo() {
  if (undoStack.length === 0) return;
  hideToast();
  const entry = undoStack.pop();
  // While true, the collection's own delete/restore must not record a new undo entry for this replay.
  isApplyingHistory = true;
  try {
    applyEntrySnapshot(entry, 'before');
  } finally {
    isApplyingHistory = false;
  }
  // The undone change moves to the redo list (capped like the undo list).
  redoStack.push(entry);
  if (redoStack.length > MAX_UNDO_DEPTH) redoStack.shift();
  updateUndoRedoButtons();
}

// Re-applies the most recently undone change.
function redo() {
  if (redoStack.length === 0) return;
  const entry = redoStack.pop();
  isApplyingHistory = true;
  try {
    applyEntrySnapshot(entry, 'after');
  } finally {
    isApplyingHistory = false;
  }
  undoStack.push(entry);
  if (undoStack.length > MAX_UNDO_DEPTH) undoStack.shift();
  updateUndoRedoButtons();
}

// The field that names a record in each collection (shown in the Undo/Redo tooltips).
const RECORD_LABEL_FIELD = {
  books: 'title', recipes: 'title', medications: 'name', diagnoses: 'condition',
  todos: 'task', shoppingList: 'item', notes: 'title', links: 'label', weights: 'date',
};

// Plain-English summary of an undo entry, e.g. "deleted 'Dune'", for the button tooltips.
function describeEntry(entry) {
  const labelField = RECORD_LABEL_FIELD[entry.collection];
  const source = entry.after || entry.before;
  const identifier = source && labelField ? source[labelField] : null;
  // Work out the verb by comparing the two sides: no "before" means an add; a flipped `deleted` flag means delete/restore.
  let action;
  if (entry.before === null) action = 'added';
  else if (entry.after.deleted && !entry.before.deleted) action = 'deleted';
  else if (!entry.after.deleted && entry.before.deleted) action = 'restored';
  else action = 'edited';
  return identifier ? `${action} '${identifier}'` : `${action} an item`;
}

// Enables or disables Undo / Redo and updates their tooltips to name the change they'd apply.
function updateUndoRedoButtons() {
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');
  const topUndo = undoStack[undoStack.length - 1];
  const topRedo = redoStack[redoStack.length - 1];
  undoBtn.disabled = undoStack.length === 0;
  redoBtn.disabled = redoStack.length === 0;
  undoBtn.title = topUndo ? `Undo: ${describeEntry(topUndo)}` : 'Undo';
  redoBtn.title = topRedo ? `Redo: ${describeEntry(topRedo)}` : 'Redo';
  const historyBox = document.getElementById('history-box');
  if (historyBox && historyBox.open) renderHistory(); // keep an open History list current
}

// Undoes the newest `steps` changes (the History list's "undo back to here" button).
function undoSteps(steps) {
  for (let i = 0; i < steps && undoStack.length > 0; i++) undo();
}

// Rebuilds the Menu History list: the last changes of this visit, newest first, each with an Undo that also
// takes back everything newer. (The undo list lives in memory only, so it starts empty each time the app opens.)
function renderHistory() {
  const list = document.getElementById('history-list');
  list.innerHTML = '';
  if (undoStack.length === 0) {
    const none = document.createElement('li');
    none.textContent = 'No changes yet in this visit.';
    list.appendChild(none);
    return;
  }
  const newestFirst = undoStack.slice().reverse().slice(0, HISTORY_SHOWN);
  newestFirst.forEach((entry, index) => {
    const row = document.createElement('li');
    const said = describeEntry(entry);
    const text = document.createElement('span');
    text.textContent = said.charAt(0).toUpperCase() + said.slice(1);
    const when = document.createElement('span');
    when.className = 'history-when';
    const time = new Date(entry.timestamp);
    when.textContent = Number.isNaN(time.getTime()) ? '' : time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'check-action';
    btn.textContent = index === 0 ? 'Undo' : `Undo this and ${index} newer`;
    btn.addEventListener('click', () => undoSteps(index + 1));
    row.append(text, when, btn);
    list.appendChild(row);
  });
}
const HISTORY_SHOWN = 15;

document.getElementById('history-box').addEventListener('toggle', (e) => { if (e.target.open) renderHistory(); });
document.getElementById('undo-btn').addEventListener('click', undo);
document.getElementById('redo-btn').addEventListener('click', redo);

// Sync progress state: a sync is running, when the last one finished, and whether its message was ok/failed.
let syncInFlight = false;
let lastSyncedAt = null;
// The last successful sync is also saved, so the Home screen can warn when it has been too long.
const LAST_SYNC_AT_KEY = 'secondMemory.lastSyncAt.v1';
const SYNC_STALE_DAYS = 7;
let lastSyncTone = null;

// Shows a sync message in the sidebar; tone is 'ok', 'failed' or null (neutral).
function setSyncStatus(text, tone) {
  lastSyncTone = tone;
  const el = document.getElementById('sync-status-text');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('sync-ok', tone === 'ok');
  el.classList.toggle('sync-failed', tone === 'failed');
}

// ---- Unsynced-changes indicator ----
// The sidebar says how many records differ from what the
// server last confirmed (the same comparison runSync uses to decide what to
// send) and the Sync now button highlights itself while there is work to send.

// How many records differ from what the server last confirmed; null if this device has never synced.
function countUnsyncedChanges() {
  const snapshot = loadSyncSnapshot();
  if (!snapshot) return null; // never synced on this device: the status line already says so
  let count = 0;
  SYNC_COLLECTIONS.forEach((c) => {
    const known = snapshot[c.name] || {};
    c.get().forEach((item) => { if (known[item.id] !== JSON.stringify(item)) count += 1; });
  });
  return count;
}

// Shows "N changes not synced" and highlights Sync now when there is something to send.
function updateSyncPending() {
  const el = document.getElementById('sync-pending');
  const btn = document.getElementById('sync-now-btn');
  if (!el || !btn) return;
  const count = loadSyncConfig() ? countUnsyncedChanges() : null;
  const show = count !== null && count > 0;
  el.hidden = !show;
  if (show) el.textContent = `${count} change${count === 1 ? '' : 's'} not synced. Tap Sync now.`;
  btn.classList.toggle('sync-needed', show);
}

var syncPendingTimer = null; // var, not let: saveCollection runs before this line during startup
// Refreshes the unsynced-changes indicator shortly after a save (a burst of saves refreshes it once).
function scheduleSyncPending() {
  clearTimeout(syncPendingTimer);
  syncPendingTimer = setTimeout(() => { safeRender(updateSyncPending); scheduleAutoSync(); }, 250);
}

// Per-device record of what the server last told us, so each sync can send
// only records this device actually changed. Re-sending every record on every
// tick let a stale device overwrite or "fork" other devices' newer edits and
// deletes into duplicates. Never synced; purely local bookkeeping.
const SYNC_SNAPSHOT_KEY = 'secondMemory.syncSnapshot.v1';

// Reads the record of what the server last confirmed ({ collection: { id: json } }); null if none.
function loadSyncSnapshot() {
  try {
    const raw = localStorage.getItem(SYNC_SNAPSHOT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      // Lists this app no longer syncs (coursework, appointments, Budget) are dropped from the bookkeeping.
      const retired = ['courses', 'deadlines', 'appointments', 'bills', 'income', 'recurringIncome'];
      if (retired.some((name) => name in parsed)) {
        retired.forEach((name) => { delete parsed[name]; });
        saveSyncSnapshot(parsed);
      }
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

// Saves that record; if storage is full it is dropped so the next sync starts fresh instead of trusting stale data.
function saveSyncSnapshot(snapshot) {
  try {
    localStorage.setItem(SYNC_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // Storage full: drop the stale snapshot so the next sync re-bootstraps
    // safely instead of trusting out-of-date bookkeeping.
    try { localStorage.removeItem(SYNC_SNAPSHOT_KEY); } catch { /* nothing more to do */ }
  }
}

// Maps each record's id to its JSON text, for comparing records before and after a sync.
function snapshotOfItems(items) {
  const map = Object.create(null); // no prototype, so an id such as "__proto__" is just a key
  items.forEach((item) => { map[item.id] = JSON.stringify(item); });
  return map;
}

// HTTP header values can only carry plain ASCII; anything else is sent
// percent-encoded behind a "u:" marker, which the server understands.
function syncTokenHeader(token) {
  return /^[\x20-\x7e]*$/.test(token) ? token : 'u:' + encodeURIComponent(token);
}

// Sync timing. `let` so the tests can shorten the notice delay.
let SYNC_WAKE_NOTICE_MS = 5000; // after this long with no answer, explain the wait
// A stalled connection would otherwise leave "Sync now" disabled until the browser gives up,
// so after SYNC_TIMEOUT_MS the request is abandoned and the sync reports a timeout.
const SYNC_TIMEOUT_MS = 60000; // generous: a sleeping free-tier server can take ~30s to wake

// Sends the changed records to the server and returns { kind: 'ok', data } or a failure kind:
// 'unauthorized' (wrong passphrase), 'outdated' (this copy of the app is too old) or 'error'.
// Gives up after SYNC_TIMEOUT_MS; network errors and timeouts are thrown to the caller.
async function postSync(config, collections) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
  try {
    const response = await fetch(`${SYNC_SERVER_URL}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sync-Token': syncTokenHeader(config.token) },
      body: JSON.stringify({ deviceId: getDeviceId(), clientVersion: 2, collections }),
      signal: controller.signal,
    });
    if (response.status === 401) return { kind: 'unauthorized' };
    if (response.status === 426) return { kind: 'outdated' };
    if (!response.ok) return { kind: 'error' };
    return { kind: 'ok', data: await response.json() };
  } finally {
    clearTimeout(timer);
  }
}

// First sync on a device with no snapshot: pull the server's state, then
// reconcile record by record WITHOUT sending anything. A local record is only
// kept as "changed here" if the server has never seen it or this device's
// copy was edited more recently than the server's; otherwise the server's
// copy wins, so a long-stale device can't resurrect or overwrite anything.
function bootstrapSyncSnapshot(serverData) {
  const snapshot = {};
  SYNC_COLLECTIONS.forEach((c) => {
    const serverItems = serverData.collections && Array.isArray(serverData.collections[c.name])
      ? serverData.collections[c.name]
      : [];
    const serverById = new Map(serverItems.map((item) => [item.id, item]));
    const merged = [];
    const known = Object.create(null);
    const seen = new Set();

    c.get().forEach((local) => {
      seen.add(local.id);
      const server = serverById.get(local.id);
      if (!server) {
        merged.push(local);
        return;
      }
      const sameContent = contentMatchesIgnoringVersion(local, server);
      if (!sameContent && (local.updatedAt || '') > (server.updatedAt || '')) {
        merged.push(local);
        return;
      }
      merged.push(server);
      known[server.id] = JSON.stringify(server);
    });
    serverItems.forEach((server) => {
      if (seen.has(server.id)) return;
      merged.push(server);
      known[server.id] = JSON.stringify(server);
    });

    c.set(merged);
    saveCollection(c.key, merged);
    safeRender(() => c.render()); // one broken screen must not abort the whole first sync
    snapshot[c.name] = known;
  });
  saveSyncSnapshot(snapshot);
  return snapshot;
}

// Applies the server's reply to one collection WITHOUT ever dropping or
// clobbering local work. Returns { result, known }: the new local array and
// the snapshot map of records now confirmed identical to the server's.
//  - unchanged since the request was sent: adopt the server's copy;
//  - edited/deleted/undeleted while the request was in flight: keep the local
//    version, and if the server holds exactly what we sent, adopt its version
//    number so the follow-up send is a clean update instead of a fork;
//  - missing from the reply (created in flight, or the server lost it): keep it
//    and leave it out of the snapshot so it is sent again;
//  - the server's copy has a LOWER version than ours (server rolled back):
//    keep ours and re-send it.
function reconcileServerReply(c, incoming, preFlightMap) {
  const incomingById = new Map(incoming.map((item) => [item.id, item]));
  const result = [];
  const known = Object.create(null);
  const seen = new Set();

  c.get().forEach((local) => {
    seen.add(local.id);
    const server = incomingById.get(local.id);
    if (!server) {
      result.push(local);
      return;
    }
    if ((server.version || 0) < (local.version || 0)) {
      // The server's number is lower than ours. After a server restore or wipe it starts every
      // re-sent record again at version 1: if the content is the same, just take the server's copy
      // (otherwise it would never count as confirmed). Different content means the server really is
      // behind, so keep ours and send it again.
      if (contentMatchesIgnoringVersion(local, server) && JSON.stringify(local) === preFlightMap[local.id]) {
        result.push(server);
        known[server.id] = JSON.stringify(server);
        return;
      }
      result.push(local);
      return;
    }
    if (JSON.stringify(local) === preFlightMap[local.id]) {
      result.push(server);
      known[server.id] = JSON.stringify(server);
      return;
    }
    const sent = preFlightMap[local.id] ? JSON.parse(preFlightMap[local.id]) : null;
    if (sent && contentMatchesIgnoringVersion(sent, server)) {
      local.version = server.version;
    }
    result.push(local);
  });

  incoming.forEach((server) => {
    if (seen.has(server.id)) return;
    result.push(server);
    known[server.id] = JSON.stringify(server);
  });

  return { result, known };
}

// Runs one sync (from the button or from auto-sync): send only what changed on this device, merge the server's reply
// into the local lists without losing local work, then report the outcome in the sidebar.
async function runSync() {
  // Step 1: do nothing if sync isn't set up or one is already running; lock the button and show progress.
  const config = loadSyncConfig();
  if (!config || syncInFlight) return;
  syncInFlight = true;
  setSyncStatus('Syncing…', null);
  const wakeTimer = setTimeout(() => {
    if (syncInFlight) setSyncStatus('Still syncing. The server may be waking up, which can take up to a minute.', null);
  }, SYNC_WAKE_NOTICE_MS);
  const syncNowBtn = document.getElementById('sync-now-btn');
  if (syncNowBtn) syncNowBtn.disabled = true;
  let resyncSoon = false;
  let incompleteReply = false;

  try {
    // Step 2: first sync on this device (no snapshot yet): pull the server's data and reconcile without sending.
    let snapshot = loadSyncSnapshot();
    if (!snapshot) {
      const boot = await postSync(config, {});
      if (boot.kind === 'unauthorized') {
        setSyncStatus('Sync failed — check passphrase', 'failed');
        return;
      }
      if (boot.kind === 'outdated') {
        setSyncStatus('This copy is out of date — close and reopen the app, then tap Sync now', 'failed');
        return;
      }
      if (boot.kind !== 'ok') {
        setSyncStatus('Sync failed — the server may be waking up (it can take up to a minute). Tap Sync now to try again.' + lastSyncNote(), 'failed');
        return;
      }
      snapshot = bootstrapSyncSnapshot(boot.data);
    }

    // Step 3: work out what changed here since the server last confirmed, and remember how every record looked when sent.
    const outgoing = {};
    const preFlight = {};
    SYNC_COLLECTIONS.forEach((c) => {
      const items = c.get();
      const known = snapshot[c.name] || {};
      outgoing[c.name] = items.filter((item) => known[item.id] !== JSON.stringify(item));
      preFlight[c.name] = snapshotOfItems(items);
    });

    // Step 4: send the changes and stop with a message if the server refuses.
    const result = await postSync(config, outgoing);
    if (result.kind === 'unauthorized') {
      setSyncStatus('Sync failed — check passphrase', 'failed');
      return;
    }
    if (result.kind === 'outdated') {
      setSyncStatus('This copy is out of date — close and reopen the app, then tap Sync now', 'failed');
      return;
    }
    if (result.kind !== 'ok') {
      setSyncStatus('Sync failed — the server may be waking up (it can take up to a minute). Tap Sync now to try again.' + lastSyncNote(), 'failed');
      return;
    }
    const data = result.data;

    // Step 5: merge the server's reply into each list, redrawing only lists that changed.
    const nextSnapshot = { ...snapshot };
    SYNC_COLLECTIONS.forEach((c) => {
      const incoming = data.collections && Array.isArray(data.collections[c.name]) ? data.collections[c.name] : null;
      if (!incoming) {
        incompleteReply = true;
        return;
      }
      const before = JSON.stringify(c.get());
      const { result: merged, known } = reconcileServerReply(c, incoming, preFlight[c.name]);
      nextSnapshot[c.name] = known;
      if (JSON.stringify(merged) !== before) {
        c.set(merged);
        saveCollection(c.key, merged);
        safeRender(() => c.render());
      }
      // Anything still different from what the server confirmed (an in-flight
      // change, or a record the server was missing) goes out on a quick retry.
      if (merged.some((item) => known[item.id] !== JSON.stringify(item))) resyncSoon = true;
    });
    saveSyncSnapshot(nextSnapshot);

    // Step 6: report the outcome (conflicts, an incomplete reply, edits made mid-sync, or success).
    lastSyncedAt = new Date();
    recordBackupTime(LAST_SYNC_AT_KEY); // the server was reached and answered, whatever the details below
    const conflicts = Array.isArray(data.conflicts) ? data.conflicts : [];
    if (conflicts.length > 0) {
      const collectionNames = [...new Set(conflicts.map((c) => c.collection))]
        .map((name) => SYNC_COLLECTIONS.find((c) => c.name === name)?.label || name);
      const noun = conflicts.length === 1 ? 'conflict' : 'conflicts';
      setSyncStatus(
        `Synced — ${conflicts.length} ${noun} merged as duplicates in ${collectionNames.join(', ')}. Review and remove any you don't need.`,
        'failed'
      );
    } else if (incompleteReply) {
      setSyncStatus('Synced, but the server reply was incomplete. Tap Sync now again.', 'failed');
    } else if (resyncSoon) {
      setSyncStatus('Synced — you changed something during the sync. Tap Sync now again to send it.', 'failed');
    } else {
      setSyncStatus('Synced just now', 'ok');
    }
  } catch (err) {
    // Network failures and timeouts end up here (the finally below always unlocks the button).
    setSyncStatus(
      err && err.name === 'AbortError'
        ? 'Sync timed out. The server did not answer \u2014 tap Sync now to try again.' + lastSyncNote()
        : 'Sync failed \u2014 the server may be waking up (it can take up to a minute). Tap Sync now to try again.' + lastSyncNote(),
      'failed'
    );
  } finally {
    clearTimeout(wakeTimer);
    syncInFlight = false;
    if (syncNowBtn) syncNowBtn.disabled = false;
    updateSyncPending();
  }
}

// The free sync server goes to sleep when idle and takes up to a minute to wake. So when the app is opened
// (or comes back to the front) and sync is set up, send it a plain request with no data and no passphrase;
// by the time you tap Sync now it is usually awake. Skipped if it was already poked in the last 10 minutes.
let lastWakeAt = 0;
function wakeSyncServer() {
  if (!loadSyncConfig() || Date.now() - lastWakeAt < 10 * 60 * 1000) return;
  lastWakeAt = Date.now();
  fetch(`${SYNC_SERVER_URL}/`, { mode: 'no-cors', cache: 'no-store' }).catch(() => { /* asleep or offline: nothing to do */ });
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') wakeSyncServer();
});

// "Last synced 3 days ago." for the end of a failure message (empty when there has never been a sync).
function lastSyncNote() {
  const days = daysSinceBackup(LAST_SYNC_AT_KEY);
  return days === null ? '' : ` Last synced ${backupAgeText(days)}.`;
}

// Ticks the visible "Synced Xm ago" label between actual sync attempts,
// without ever overwriting a currently-shown error/in-progress state.
setInterval(() => {
  if (lastSyncTone !== 'ok' || syncInFlight || !lastSyncedAt) return;
  const minutes = Math.floor((Date.now() - lastSyncedAt.getTime()) / 60000);
  setSyncStatus(minutes <= 0 ? 'Synced just now' : `Synced ${minutes}m ago`, 'ok');
}, 30000);

// Wires up the sidebar sync controls: the passphrase form, "change passphrase" and "Sync now".
function initSyncUI() {
  const setupSection = document.getElementById('sync-setup');
  const statusSection = document.getElementById('sync-status');
  const form = document.getElementById('sync-setup-form');
  const changeBtn = document.getElementById('sync-change-btn');
  const config = loadSyncConfig();

  setupSection.hidden = !!config;
  statusSection.hidden = !config;
  if (!config) setSyncStatus('Sync not set up', null);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const tokenInput = document.getElementById('sync-token-input');
    const token = tokenInput.value.trim();
    if (!token) return;
    const previousConfig = loadSyncConfig();
    if (!previousConfig || previousConfig.token !== token) localStorage.removeItem(SYNC_SNAPSHOT_KEY);
    saveSyncConfig({ token });
    tokenInput.value = '';
    setupSection.hidden = true;
    statusSection.hidden = false;
    updateAutoSyncButton();
    runSync();
  });

  changeBtn.addEventListener('click', () => {
    document.getElementById('sync-token-input').value = '';
    setupSection.hidden = false;
    statusSection.hidden = true;
  });

  // Press Sync now any time; auto-sync (see the Auto-sync section) also runs it on open and after changes.
  document.getElementById('sync-now-btn').addEventListener('click', runSync);
  if (config) setSyncStatus('Not synced yet — tap Sync now', null);
  updateSyncPending();
}

// ---- Data export / import ----
// Import's merge algorithm intentionally mirrors sync_server.py's
// merge_collection()/_content_matches() (see DECISIONS.md) so a client-side
// restore behaves the same way a genuine sync conflict does: never silently
// discard a record, treat a byte-for-byte replay as a no-op, and keep both
// sides on a genuine conflict rather than picking a winner.

// ---- Lists that moved to other apps (kept, not shown) ----
// The to-do list, shopping list, medications and equipment, diagnoses and weights now live in Petalkeeper, MealMate
// and Caregiver Command Center. This app no longer shows them, but it NEVER deletes what it already holds: the
// records stay in this browser exactly as they were, every Export still includes them in the same place as before
// (so the other apps can read the file), and Import still merges them back in. The server copy is left alone too.
const RETIRED_LISTS = [
  { name: 'todos', key: 'secondMemory.todos.v1', label: 'to-dos' },
  { name: 'shoppingList', key: 'secondMemory.shoppingList.v1', label: 'shopping items' },
  { name: 'medications', key: 'secondMemory.medications.v1', label: 'medications and equipment' },
  { name: 'diagnoses', key: 'secondMemory.diagnoses.v1', label: 'diagnoses' },
  { name: 'weights', key: 'secondMemory.weights.v1', label: 'weights' },
];
// The weight goal was a plain number kept only on this device.
const RETIRED_WEIGHT_GOAL_KEY = 'secondMemory.weightGoal.v1';

// The records held for a retired list (an empty list when there are none or the stored text is damaged).
function readRetiredList(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// The stored weight goal as a positive number, or null.
function readRetiredWeightGoal() {
  try {
    const n = Number(JSON.parse(localStorage.getItem(RETIRED_WEIGHT_GOAL_KEY)));
    return Number.isFinite(n) && n > 0 && n <= 1500 ? n : null;
  } catch {
    return null;
  }
}

// The full backup: everything that syncs, the retired lists (so nothing is lost), plus the things that only live on
// this device (the journal and the goals), kept under `local` so they stay out of syncing.
function buildExportPayload() {
  const collections = {};
  SYNC_COLLECTIONS.forEach((c) => { collections[c.name] = c.get(); });
  RETIRED_LISTS.forEach((r) => {
    const held = readRetiredList(r.key);
    if (held.length) collections[r.name] = held;
  });
  const local = { journal: journalEntries.slice() };
  const goal = readRetiredWeightGoal();
  if (goal !== null) local.weightGoal = goal;
  const readingGoals = loadReadingGoals();
  if (Object.keys(readingGoals).length > 0) local.readingGoals = readingGoals;
  const vault = loadVaultBlob();
  if (vault) local.vault = vault; // still encrypted: a backup file never holds a readable password
  return { collections, local };
}

// Today's date as YYYY-MM-DD for backup file names.
function todayForFilename() {
  return todayKey(); // local date, like the rest of the app (not the UTC date)
}

// Downloads the full backup (all lists plus the journal and goals) as one JSON file.
function exportData() {
  recordBackupTime(EXPORT_AT_KEY);
  const json = JSON.stringify(buildExportPayload(), null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `second-memory-export-${todayForFilename()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000); // revoking at once can cancel the download on iOS/Safari
  setDataIoStatus('Backup downloaded. It includes your journal, so keep the file somewhere private.', 'ok');
  renderBackupNotes();
}

// Accepts the exact shape `buildExportPayload()` produces (`{ collections: {...} }`)
// and, defensively, a bare collections object at the top level too. Returns
// null for anything else so the caller can reject with a clear error instead
// of crashing on malformed input.
function extractImportCollections(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.collections && typeof parsed.collections === 'object' && !Array.isArray(parsed.collections)) return parsed.collections;
  const looksLikeCollections = SYNC_COLLECTIONS.some((c) => Array.isArray(parsed[c.name]));
  return looksLikeCollections ? parsed : null;
}

// Structural equality for records (arrays and nested objects compared by content; null equals missing).
function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null && b == null) return true; // null and a missing value are equal (Python's dict.get() does the same)
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

// Fields that describe who/when touched a record rather than its actual
// data. Mirrors sync_server.py's _BOOKKEEPING_FIELDS. `dateAdded` and
// `deleted` are deliberately NOT here — they're meaningful data.
const BOOKKEEPING_FIELDS = new Set(['version', 'updatedAt', 'deviceId']);

// Port of sync_server.py's _content_matches(): true if two records
// describe the same real-world data — i.e. this import record is a
// re-import of something already merged in (or a no-op resend), not a
// genuine conflicting edit. Uses deepEqual() so array fields such as
// `takenDates` are compared by content, not by reference.
function contentMatchesIgnoringVersion(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  BOOKKEEPING_FIELDS.forEach((k) => keys.delete(k));
  return [...keys].every((k) => deepEqual(a[k], b[k]));
}

// Port of sync_server.py's merge_collection(), adapted to merge an imported
// file's records onto the in-memory client collection instead of the
// server's onto a client's. Cases: (a) new id -> add as a new record;
// (b) known id, incoming version equal-or-newer, content identical -> no-op
// (the local record, with its own updatedAt/deviceId, is left alone);
// (c) known id, incoming version equal-or-newer, content differs -> replace the
// local record, unless it is deleted here or was edited more recently;
// (d) known id, incoming version older, content identical -> no-op;
// (e) known id, incoming version older, content differs -> kept as a new record
// under a fresh id only if the backup copy is newer than the local one, so a
// stale backup never piles up duplicates.
// A deleted record is never brought back. Mutates `localItems` in place and
// returns counts for the summary message.
function mergeCollectionFromImport(localItems, importedItems) {
  const byId = new Map(localItems.map((item) => [item.id, item]));
  let added = 0;
  let updated = 0;
  let duplicated = 0;
  let unchanged = 0;

  importedItems.forEach((incoming) => {
    if (!incoming || typeof incoming !== 'object' || !incoming.id) return;
    const existing = byId.get(incoming.id);

    if (!existing) {
      const record = { ...incoming };
      localItems.push(record);
      byId.set(record.id, record);
      added += 1;
      return;
    }

    const incomingVersion = incoming.version || 0;
    const existingVersion = existing.version || 0;

    if (incomingVersion >= existingVersion) {
      // A content-identical import is a true no-op: keep the local record (and its
      // updatedAt/deviceId) and don't count it as "updated".
      if (contentMatchesIgnoringVersion(existing, incoming)) {
        unchanged += 1;
        return;
      }
      if (existing.deleted && !incoming.deleted) {
        unchanged += 1; // a deleted record is never brought back by a backup
        return;
      }
      // The version number only moves on a server round trip, so a record
      // changed or deleted here since the backup was taken has the SAME
      // version as the backup copy. Compare edit times instead of letting the
      // older backup overwrite (or resurrect) newer local work.
      if ((existing.updatedAt || '') > (incoming.updatedAt || '')) {
        unchanged += 1;
        return;
      }
      const record = { ...incoming };
      const index = localItems.findIndex((item) => item.id === incoming.id);
      localItems[index] = record;
      byId.set(record.id, record);
      updated += 1;
      return;
    }

    if (contentMatchesIgnoringVersion(existing, incoming)) {
      unchanged += 1;
      return;
    }

    // Same rule as the sync server: a deleted record stays deleted rather than
    // being brought back as a duplicate by an older backup file.
    if (existing.deleted && !incoming.deleted) {
      unchanged += 1;
      return;
    }

    // A backup copy that is not newer than what is here is simply old news (the record was edited
    // and synced since the backup was made). It must not be added again as a duplicate, however many
    // times the same file is imported.
    if ((existing.updatedAt || '') >= (incoming.updatedAt || '')) {
      unchanged += 1;
      return;
    }

    const record = { ...incoming, id: makeId() };
    localItems.push(record);
    byId.set(record.id, record);
    duplicated += 1;
  });

  return { added, updated, duplicated, unchanged };
}

// Shows a message under the Export / Import buttons; tone is 'ok' or 'failed'.
function setDataIoStatus(text, tone) {
  const el = document.getElementById('data-io-status');
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  el.classList.toggle('sync-ok', tone === 'ok');
  el.classList.toggle('sync-failed', tone === 'failed');
}

// Rejects records whose types would crash rendering later (e.g. a weight that is
// not a number throws on every page load).
function isValidImportRecord(collectionName, rec) {
  if (!rec || typeof rec !== 'object' || typeof rec.id !== 'string' || !rec.id) return false;
  const isDate = (v) => isRealDateKey(v);
  const isText = (v) => typeof v === 'string';
  const textOrMissing = (v) => v === undefined || v === null || typeof v === 'string';
  const listOrMissing = (v) => v === undefined || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
  if (collectionName === 'books') return isText(rec.title) && textOrMissing(rec.author) && BOOK_STATUSES.includes(rec.status) && (rec.rating == null || (Number.isInteger(rec.rating) && rec.rating >= 0 && rec.rating <= 5)) && (rec.dateFinished == null || isDate(rec.dateFinished));
  if (collectionName === 'recipes') return isText(rec.title) && listOrMissing(rec.ingredients) && listOrMissing(rec.steps);
  if (collectionName === 'notes') return textOrMissing(rec.title) && textOrMissing(rec.body);
  if (collectionName === 'links') return textOrMissing(rec.label) && textOrMissing(rec.url);
  return true;
}

// Runs a redraw but logs instead of throwing, so one broken screen can't stop the others.
function safeRender(fn) {
  try {
    fn();
  } catch (err) {
    console.error('render failed:', err);
  }
}

// Merges a parsed backup file into the app without ever discarding local data, then reports
// what happened (new, updated, merged-as-duplicates, skipped) under the Import button.
function importData(parsed) {
  // Step 1: make sure the file looks like an export.
  const importedCollections = extractImportCollections(parsed);
  if (!importedCollections) {
    setDataIoStatus("Import failed — that file doesn't look like a Second Memory export.", 'failed');
    return;
  }

  const summaries = [];
  let anyChanged = false;
  let skippedInvalid = 0;

  // Step 2: merge each synced list, skipping records that would break rendering.
  SYNC_COLLECTIONS.forEach((c) => {
    const rawIncoming = importedCollections[c.name];
    if (!Array.isArray(rawIncoming) || rawIncoming.length === 0) return;
    const incoming = rawIncoming.filter((rec) => isValidImportRecord(c.name, rec));
    skippedInvalid += rawIncoming.length - incoming.length;
    if (incoming.length === 0) return;
    const localItems = c.get();
    const result = mergeCollectionFromImport(localItems, incoming);
    if (!result.added && !result.updated && !result.duplicated) return;

    anyChanged = true;
    saveCollection(c.key, localItems);
    safeRender(() => c.render());
    const parts = [];
    if (result.added) parts.push(`${result.added} new`);
    if (result.updated) parts.push(`${result.updated} updated`);
    if (result.duplicated) parts.push(`${result.duplicated} merged as duplicates`);
    summaries.push(`${parts.join(', ')} in ${c.label}`);
  });

  // Step 2b: lists that moved to other apps are still merged into the copy this device holds (never shown here).
  RETIRED_LISTS.forEach((r) => {
    const rawIncoming = importedCollections[r.name];
    if (!Array.isArray(rawIncoming) || rawIncoming.length === 0) return;
    const incoming = rawIncoming.filter((rec) => rec && typeof rec === 'object' && typeof rec.id === 'string' && rec.id);
    skippedInvalid += rawIncoming.length - incoming.length;
    const held = readRetiredList(r.key);
    const result = mergeCollectionFromImport(held, incoming);
    if (!result.added && !result.updated && !result.duplicated) return;
    anyChanged = true;
    saveCollection(r.key, held);
    summaries.push(`${result.added + result.updated + result.duplicated} ${r.label} kept for the other apps`);
  });

  // Step 3: the journal and goals (only present in a full backup made by this version or later). Lists from
  // older exports that this app no longer has (bills, income, recurringIncome) are ignored and never stored.
  const localPart = parsed && typeof parsed === 'object' && parsed.local && typeof parsed.local === 'object' ? parsed.local : null;
  if (localPart) {
    if (Array.isArray(localPart.journal)) {
      const addedEntries = mergeJournalEntries(localPart.journal);
      if (addedEntries) {
        anyChanged = true;
        summaries.push(`${addedEntries} journal entr${addedEntries === 1 ? 'y' : 'ies'}`);
      }
    }
    // The weight goal is only filled in when this device has none (it never overwrites yours).
    if (Number.isFinite(localPart.weightGoal) && localPart.weightGoal > 0 && localPart.weightGoal <= 1500 && readRetiredWeightGoal() === null) {
      try { localStorage.setItem(RETIRED_WEIGHT_GOAL_KEY, JSON.stringify(localPart.weightGoal)); } catch { /* storage full: not restored */ }
      anyChanged = true;
      summaries.push('weight goal kept for the other apps');
    }
    // The encrypted password vault is only restored onto a device that has none (it never replaces yours).
    const incomingVault = parseVaultBlob(localPart.vault);
    if (incomingVault && !loadVaultBlob()) {
      try { localStorage.setItem(VAULT_KEY, JSON.stringify(incomingVault)); } catch { /* storage full: not restored */ }
      anyChanged = true;
      summaries.push('password vault');
    }
    // Reading goals fill in only the years this device has no goal for.
    if (localPart.readingGoals && typeof localPart.readingGoals === 'object') {
      const have = loadReadingGoals();
      const added = Object.entries(localPart.readingGoals).filter(([year, n]) => /^\d{4}$/.test(year) && Number.isInteger(n) && n > 0 && n <= 1000 && !(year in have));
      added.forEach(([year, n]) => saveReadingGoal(year, n));
      if (added.length) {
        renderBooks();
        anyChanged = true;
        summaries.push('reading goals');
      }
    }
  }

  // Step 4: summarise the result.
  const skippedNote = skippedInvalid ? ` ${skippedInvalid} unreadable record${skippedInvalid === 1 ? ' was' : 's were'} skipped.` : '';
  if (!anyChanged) {
    setDataIoStatus(`Import complete — nothing new to merge.${skippedNote}`, 'ok');
    return;
  }

  setDataIoStatus(`Import complete — ${summaries.join('; ')}.${skippedNote}`, 'ok');
  if (typeof updateMovedCard === 'function') updateMovedCard();
}

document.getElementById('export-data-btn').addEventListener('click', exportData);

document.getElementById('import-data-btn').addEventListener('click', () => {
  document.getElementById('import-file-input').click();
});

document.getElementById('import-file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(reader.result);
    } catch {
      setDataIoStatus('Import failed — that file is not valid JSON.', 'failed');
      return;
    }
    importData(parsed);
  };
  reader.onerror = () => {
    setDataIoStatus('Import failed — could not read that file.', 'failed');
  };
  reader.readAsText(file);
});

// ---- Day rollover ----
// "Today" drives overdue/due-soon/refill/calendar highlighting. If the app is
// left open across midnight (or comes back to the foreground on a new day),
// redraw the date-dependent screens. Local redraw only; nothing is synced.

let lastRenderedDayKey = todayKey();

// Redraws the date-dependent screens when the calendar day has changed since the last check.
function refreshForNewDay() {
  const now = todayKey();
  if (now === lastRenderedDayKey) return;
  lastRenderedDayKey = now;
  [
    // The reading goal is for "this year", so it must roll over on 1 January too.
    () => renderReadingGoal(books.filter((b) => !b.deleted)),
  ].forEach(safeRender);
}

// A timer covers a tab left open overnight; visibilitychange covers a phone waking up on a new day
// (timers are paused while the app is in the background).
setInterval(refreshForNewDay, 60000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshForNewDay();
});

// ---- Theme, version and quick add ----

// The build number shown in the Menu. Keep it equal to the number in CACHE_NAME in sw.js
// (a test checks this), so "which version am I on?" has a one-glance answer.
const APP_VERSION = 83;
const THEME_KEY = 'secondMemory.theme.v1';
const THEMES = ['auto', 'light', 'dark'];

// Reads the saved theme choice; anything unexpected means "auto" (follow the device).
function loadTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return THEMES.includes(value) ? value : 'auto';
  } catch {
    return 'auto';
  }
}

// Applies and saves a theme: Light or Dark set <html data-theme>, Auto removes it.
function applyTheme(theme) {
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  try {
    if (theme === 'auto') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch { /* storage unavailable: the choice lasts until the page closes */ }
  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = `Theme: ${theme.charAt(0).toUpperCase()}${theme.slice(1)}`;
}

// The Menu theme button cycles Auto -> Light -> Dark.
document.getElementById('theme-btn').addEventListener('click', () => {
  applyTheme(THEMES[(THEMES.indexOf(loadTheme()) + 1) % THEMES.length]);
});
applyTheme(loadTheme());
document.getElementById('app-version').textContent = `Version ${APP_VERSION}`;

// Quick add on Home: one box that adds a note, then reports what it did.
document.getElementById('quick-add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('quick-add-input');
  const status = document.getElementById('quick-add-status');
  const text = input.value.trim();
  if (!text) return;
  addNote('', text);
  input.value = '';
  status.textContent = 'Added to your notes.';
  status.hidden = false;
  input.focus();
});

// ---- App lock ----
// A PIN that hides the app until it is typed. It keeps other people out of the screen; it does
// NOT encrypt the data stored on the device. The PIN is never stored: only a salted PBKDF2 hash.
// The lock starts shown (a script in index.html sets data-locked on <html> before the page paints),
// comes back after the app has been in the background a couple of minutes, and "Lock now" locks at once.

const LOCK_KEY = 'secondMemory.lock.v1';
const LOCK_AFTER_MS = 2 * 60 * 1000;
const LOCK_PIN_RE = /^\d{4,12}$/;
const LOCK_MAX_TRIES = 5;
const LOCK_COOLDOWN_MS = 30000;
const LOCK_TRIES_KEY = 'secondMemory.lockTries.v1';
let lockFailures = 0;
let lockBlockedUntil = 0;
let lockHiddenAt = null;
let lockChecking = false; // true while a PIN is being checked, so a double tap cannot run two checks

// Wrong-try count and pause end time live in storage too, so reloading the page cannot skip the pause.
function saveLockTries() {
  try { localStorage.setItem(LOCK_TRIES_KEY, JSON.stringify({ fails: lockFailures, until: lockBlockedUntil })); } catch { /* storage full: the in-memory count still applies */ }
}

// Reads the saved wrong-try count and pause end time at startup. A pause can never run longer than
// one cooldown from now, so a wrong clock or damaged value cannot lock you out for hours.
function restoreLockTries() {
  try {
    const savedTries = JSON.parse(localStorage.getItem(LOCK_TRIES_KEY) || 'null');
    if (savedTries && Number.isFinite(savedTries.fails) && Number.isFinite(savedTries.until)) {
      lockFailures = Math.max(0, Math.min(LOCK_MAX_TRIES, savedTries.fails));
      lockBlockedUntil = Math.min(savedTries.until, Date.now() + LOCK_COOLDOWN_MS);
    }
  } catch { /* damaged: start from zero */ }
}
restoreLockTries();

// The saved { salt, hash } (hex strings), or null when no lock is set or the saved value is damaged.
function loadLock() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCK_KEY) || 'null');
    if (parsed && /^[0-9a-f]{32}$/.test(parsed.salt) && /^[0-9a-f]{64}$/.test(parsed.hash)) return parsed;
  } catch { /* fall through */ }
  return null;
}

// Whether this browser can compute the PIN hash (it needs a secure page: https or localhost).
function lockSupported() {
  return !!(window.crypto && crypto.subtle && window.TextEncoder);
}

// Bytes to a hex string, and back (the salt and hash are stored as hex text).
const toHex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => Uint8Array.from(hex.match(/../g).map((h) => parseInt(h, 16)));

// Turns a PIN and a salt into the stored hash (PBKDF2, SHA-256, 150,000 rounds).
async function hashPin(pin, saltHex) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: fromHex(saltHex), iterations: 150000, hash: 'SHA-256' }, key, 256);
  return toHex(bits);
}

// True when the PIN matches the saved lock.
async function checkPin(pin) {
  const lock = loadLock();
  return !!lock && (await hashPin(pin, lock.salt)) === lock.hash;
}

// Saves a new PIN (replacing any old one). Returns false if the PIN is not 4 to 12 digits or saving failed.
async function setAppLock(pin) {
  if (!LOCK_PIN_RE.test(pin) || !lockSupported()) return false;
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await hashPin(pin, salt);
  try {
    localStorage.setItem(LOCK_KEY, JSON.stringify({ salt, hash }));
  } catch {
    return false;
  }
  updateLockButtons();
  return true;
}

// Removes the lock and shows the app.
function clearAppLock() {
  try { localStorage.removeItem(LOCK_KEY); } catch { /* nothing to remove it from */ }
  document.documentElement.removeAttribute('data-locked');
  updateLockButtons();
}

// Shows the lock screen (if a lock is set) and puts the cursor in the PIN box.
function lockNow() {
  if (!loadLock()) return;
  lockVault(); // the password vault locks with the app
  // Close anything showing private details first (the therapy summary, the lock settings dialog).
  if (!document.getElementById('therapy-summary').hidden) closeTherapySummary();
  if (!document.getElementById('lock-setup').hidden) closeLockSetup();
  document.documentElement.setAttribute('data-locked', '1');
  const input = document.getElementById('lock-pin-input');
  input.value = '';
  document.getElementById('lock-error').hidden = true;
  input.focus();
}

// Keeps the Menu buttons in step with whether a lock is set.
function updateLockButtons() {
  const on = !!loadLock();
  document.getElementById('lock-btn').textContent = `App lock: ${on ? 'On' : 'Off'}`;
  document.getElementById('lock-now-btn').hidden = !on;
}

// Erases everything this app keeps on this device (all secondMemory.* entries). Used by "Forgot PIN".
function wipeDeviceData() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('secondMemory.')) keys.push(key);
  }
  keys.forEach((key) => localStorage.removeItem(key));
  return keys.length;
}

// The lock screen's PIN form: checks the PIN, counts wrong tries and pauses after too many.
document.getElementById('lock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('lock-error');
  // Still in the pause after too many wrong tries: don't even check the PIN.
  if (Date.now() < lockBlockedUntil) {
    errorEl.textContent = `Too many tries. Wait ${Math.ceil((lockBlockedUntil - Date.now()) / 1000)} seconds.`;
    errorEl.hidden = false;
    return;
  }
  if (lockChecking) return;
  lockChecking = true;
  const input = document.getElementById('lock-pin-input');
  try {
    if (await checkPin(input.value)) {
      lockFailures = 0;
      lockBlockedUntil = 0;
      saveLockTries();
      document.documentElement.removeAttribute('data-locked');
      input.value = '';
      errorEl.hidden = true;
      return;
    }
    lockFailures += 1;
    input.value = '';
    if (lockFailures >= LOCK_MAX_TRIES) {
      // Start the pause and reset the count, so the next round of tries starts fresh after it.
      lockFailures = 0;
      lockBlockedUntil = Date.now() + LOCK_COOLDOWN_MS;
      errorEl.textContent = 'Too many tries. Wait 30 seconds.';
    } else {
      errorEl.textContent = 'That PIN is not right.';
    }
    saveLockTries();
    errorEl.hidden = false;
    input.focus();
  } finally {
    lockChecking = false;
  }
});

// "Forgot PIN": after a confirmation, erases this device's data and reloads (the only way back in).
document.getElementById('lock-forgot-btn').addEventListener('click', () => {
  const ok = window.confirm('Forgot your PIN?\n\nThe only way in is to erase everything stored on THIS device. Your synced lists come back when you sync again, but changes you have not synced yet, your sync passphrase and your journal (unless you saved a backup file) exist only on this device and will be lost.\n\nErase this device and start over?');
  if (!ok) return;
  wipeDeviceData();
  window.location.reload();
});

// The turn-on / turn-off dialog.
let lockSetupMode = 'on';
function openLockSetup(mode) {
  lockSetupMode = mode;
  const turningOff = mode === 'off';
  document.getElementById('lock-setup-title').textContent = turningOff ? 'Turn off app lock' : 'Turn on app lock';
  document.getElementById('lock-setup-note').textContent = turningOff
    ? 'Enter your PIN to turn the lock off.'
    : 'Choose a PIN of 4 to 12 digits. It keeps other people out of the app on this device; it does not encrypt your data. If you forget it, the only way back in is to erase this device.';
  document.getElementById('lock-setup-current').hidden = !turningOff;
  document.getElementById('lock-setup-new').hidden = turningOff;
  document.getElementById('lock-setup-confirm').hidden = turningOff;
  ['lock-setup-current', 'lock-setup-new', 'lock-setup-confirm'].forEach((id) => { document.getElementById(id).value = ''; });
  document.getElementById('lock-setup-error').hidden = true;
  document.getElementById('lock-setup').hidden = false;
  document.getElementById(turningOff ? 'lock-setup-current' : 'lock-setup-new').focus();
}

// Hides the lock dialog and returns focus to the Menu button.
function closeLockSetup() {
  document.getElementById('lock-setup').hidden = true;
  document.getElementById('lock-btn').focus();
}

document.getElementById('lock-btn').addEventListener('click', () => {
  if (!lockSupported()) {
    setDataIoStatus('App lock needs a secure page (https). It is not available here.', 'failed');
    return;
  }
  openLockSetup(loadLock() ? 'off' : 'on');
});
document.getElementById('lock-now-btn').addEventListener('click', lockNow);
document.getElementById('lock-setup-cancel').addEventListener('click', closeLockSetup);
document.getElementById('lock-setup').addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLockSetup(); });

// The turn-on / turn-off dialog's form: turning off needs the current PIN; turning on needs a valid PIN typed twice.
document.getElementById('lock-setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('lock-setup-error');
  const fail = (text) => { errorEl.textContent = text; errorEl.hidden = false; };
  if (lockSetupMode === 'off') {
    if (!(await checkPin(document.getElementById('lock-setup-current').value))) { fail('That PIN is not right.'); return; }
    clearAppLock();
    closeLockSetup();
    return;
  }
  const pin = document.getElementById('lock-setup-new').value;
  if (!LOCK_PIN_RE.test(pin)) { fail('Use 4 to 12 digits, numbers only.'); return; }
  if (pin !== document.getElementById('lock-setup-confirm').value) { fail('The two PINs do not match.'); return; }
  if (!(await setAppLock(pin))) { fail('Could not save the PIN on this device.'); return; }
  closeLockSetup();
});

// Re-lock after the app has been out of sight for a couple of minutes.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    lockHiddenAt = Date.now(); // remember when it went out of sight
  } else if (lockHiddenAt !== null && Date.now() - lockHiddenAt >= LOCK_AFTER_MS) {
    // Back in view after the grace period: lock again.
    lockNow();
  }
  if (document.visibilityState === 'visible') lockHiddenAt = null;
});

updateLockButtons();
// A damaged saved lock cannot be unlocked and would trap you on the lock screen: clear it.
if (document.documentElement.hasAttribute('data-locked') && !loadLock()) {
  try { localStorage.removeItem(LOCK_KEY); } catch { /* nothing to remove it from */ }
  document.documentElement.removeAttribute('data-locked');
}
if (loadLock()) lockNow(); // a locked app opens locked (the lock screen is already showing)

// Every "Add ..." dropdown tucks its form away after a successful add. A refused add (for example a blank
// title) leaves the first text box filled or flagged, so the form stays open. This listener is registered after
// each form's own submit handler, so it runs once that handler has cleared the boxes.
document.querySelectorAll('details.add-dropdown').forEach((details) => {
  const form = details.querySelector('form');
  form.addEventListener('submit', () => {
    const firstBox = form.querySelector('input[type="text"], input[type="number"], textarea');
    if (firstBox && !firstBox.value) {
      details.open = false;
      details.querySelector('summary').focus(); // keep keyboard focus somewhere visible
    }
  });
});

// Customize Home: which panels you want to see (the rest stay hidden even when they have something to show).
// HOME_PANEL_CHOICES is read by renderHome (through applyHomePanelChoices), so no Home redraw may run
// before this line; the first one is in the Init block below.
const HOME_PANELS_KEY = 'secondMemory.homePanels.v1';
const HOME_PANEL_CHOICES = [
  ['home-reading-panel', 'Currently reading'],
];

// The ids of the panels switched off on this device (damaged data means none are off).
function loadHiddenHomePanels() {
  try {
    const raw = JSON.parse(localStorage.getItem(HOME_PANELS_KEY));
    return new Set(Array.isArray(raw) ? raw.filter((id) => HOME_PANEL_CHOICES.some(([panelId]) => panelId === id)) : []);
  } catch {
    return new Set();
  }
}

// Hides the panels you switched off; called at the end of every Home redraw.
function applyHomePanelChoices() {
  const off = loadHiddenHomePanels();
  HOME_PANEL_CHOICES.forEach(([id]) => {
    if (off.has(id)) document.getElementById(id).hidden = true;
  });
}

// Fills the Customize Home list with one checkbox per panel.
function buildHomeCustomizeList() {
  const box = document.getElementById('home-customize-list');
  const off = loadHiddenHomePanels();
  box.innerHTML = '';
  HOME_PANEL_CHOICES.forEach(([id, label]) => {
    const row = document.createElement('label');
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = !off.has(id);
    check.addEventListener('change', () => {
      const next = loadHiddenHomePanels();
      if (check.checked) next.delete(id); else next.add(id);
      try { localStorage.setItem(HOME_PANELS_KEY, JSON.stringify([...next])); } catch { /* not saved: lasts until the page closes */ }
      renderHome();
    });
    row.append(check, ` ${label}`);
    box.appendChild(row);
  });
}
buildHomeCustomizeList();
wakeSyncServer();

// Each empty screen gets an "Add one now" button that opens that screen's add form and moves the cursor into it.
document.querySelectorAll('.empty-state').forEach((message) => {
  const section = message.closest('section.collection');
  if (!section) return;
  const details = section.querySelector('details.add-dropdown');
  const form = details ? details.querySelector('form') : section.querySelector('form.add-form');
  if (!form) return; // Home, Journal and Resume have no plain add form
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'edit-btn empty-state-add';
  btn.textContent = 'Add one now';
  btn.addEventListener('click', () => {
    if (details) details.open = true;
    const first = form.querySelector('input:not([type="hidden"]), textarea');
    if (first) first.focus();
    form.scrollIntoView({ block: 'center' });
  });
  message.appendChild(btn);
});

// Menu button: contrast toggles between Normal and High (remembered on this device).
const CONTRAST_KEY = 'secondMemory.contrast.v1';
function applyContrast(high) {
  if (high) document.documentElement.setAttribute('data-contrast', 'high');
  else document.documentElement.removeAttribute('data-contrast');
  try {
    if (high) localStorage.setItem(CONTRAST_KEY, 'high'); else localStorage.removeItem(CONTRAST_KEY);
  } catch { /* storage unavailable: the choice lasts until the page closes */ }
  document.getElementById('contrast-btn').textContent = `Contrast: ${high ? 'High' : 'Normal'}`;
}
document.getElementById('contrast-btn').addEventListener('click', () => {
  applyContrast(document.documentElement.getAttribute('data-contrast') !== 'high');
});
applyContrast(document.documentElement.getAttribute('data-contrast') === 'high');

// Menu button: text size cycles Normal -> Large -> Larger (the choice is remembered on this device).
const TEXT_SIZE_KEY = 'secondMemory.textSize.v1';
const TEXT_SIZES = ['normal', 'large', 'larger'];
function applyTextSize(size) {
  if (size === 'normal') document.documentElement.removeAttribute('data-text');
  else document.documentElement.setAttribute('data-text', size);
  try {
    if (size === 'normal') localStorage.removeItem(TEXT_SIZE_KEY); else localStorage.setItem(TEXT_SIZE_KEY, size);
  } catch { /* storage unavailable: the size lasts until the page closes */ }
  document.getElementById('text-size-btn').textContent = `Text size: ${size.charAt(0).toUpperCase()}${size.slice(1)}`;
}
document.getElementById('text-size-btn').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-text') || 'normal';
  applyTextSize(TEXT_SIZES[(TEXT_SIZES.indexOf(current) + 1) % TEXT_SIZES.length]);
});
applyTextSize(TEXT_SIZES.includes(document.documentElement.getAttribute('data-text')) ? document.documentElement.getAttribute('data-text') : 'normal');

// ---- Password vault ----
// A small encrypted store for passwords. Everything is encrypted with the browser's built-in Web Crypto (no
// libraries): the master password is stretched with PBKDF2-SHA256 (600,000 rounds, random salt) into an AES-256-GCM
// key, and the whole list is encrypted into one blob in localStorage. The master password and the key are never
// stored; the key lives in memory only while the vault is open. The vault is never synced, never searched, never in
// the Undo history, and a backup of it is the still-encrypted blob. Forget the master password and the passwords
// cannot be recovered: that is the point of encryption.

const VAULT_KEY = 'secondMemory.vault.v1';
const VAULT_BACKUP_AT_KEY = 'secondMemory.vaultBackupAt.v1';
let VAULT_ITERATIONS = 600000; // `let` so the tests can use a small number
const VAULT_MIN_LENGTH = 10;
let VAULT_IDLE_MS = 3 * 60000; // locks itself after this long without touching the vault
const VAULT_HIDDEN_LOCK_MS = 60000; // ...or after the app has been out of sight this long
let VAULT_CLIPBOARD_MS = 30000; // a copied password is wiped from the clipboard after this long
const VAULT_MAX_FAILS = 5; // wrong master passwords in a row before a short pause
const VAULT_PAUSE_MS = 30000;

let vaultKey = null; // the AES key while unlocked; null when locked
let vaultSalt = null; // the salt that key was made with
let vaultIterations = 0; // and the number of rounds
let vaultEntries = []; // the decrypted passwords, only while unlocked
let vaultFails = 0;
let vaultPausedUntil = 0;
let vaultIdleTimer = null;
let vaultHiddenAt = null;
let vaultClipboardTimer = null;
let vaultEditingId = null; // the entry being edited in the form, if any
let vaultSaving = Promise.resolve(); // saves run one after another
const vaultRevealed = new Set(); // ids whose password is currently shown

// ---- encoding helpers ----

// Bytes to base64 text (in chunks, so a big blob does not overflow the argument limit).
function bytesToB64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}

// Base64 text back to bytes (throws on bad input).
function b64ToBytes(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Checks a stored or imported vault blob: version 1, a sane round count, and a salt, IV and data that are base64
// of the right size. Returns a clean copy, or null.
function parseVaultBlob(value) {
  if (!value || typeof value !== 'object' || value.v !== 1) return null;
  if (!Number.isInteger(value.iter) || value.iter < 1000 || value.iter > 10000000) return null;
  const base64 = /^[A-Za-z0-9+/]+={0,2}$/;
  if (![value.salt, value.iv, value.data].every((s) => typeof s === 'string' && base64.test(s))) return null;
  try {
    if (b64ToBytes(value.salt).length !== 16 || b64ToBytes(value.iv).length !== 12 || b64ToBytes(value.data).length < 16) return null;
  } catch {
    return null;
  }
  return { v: 1, iter: value.iter, salt: value.salt, iv: value.iv, data: value.data };
}

// The stored vault, or null if there is none (or it is damaged).
function loadVaultBlob() {
  try {
    return parseVaultBlob(JSON.parse(localStorage.getItem(VAULT_KEY)));
  } catch {
    return null;
  }
}

// ---- encryption ----

// Turns a master password into the AES key (not extractable: the key bytes can never be read back out).
async function deriveVaultKey(password, salt, iterations) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Encrypts the current entries with a fresh IV and stores them. Returns false if the browser refused to store it.
function saveVault() {
  vaultSaving = vaultSaving.then(async () => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode(JSON.stringify({ entries: vaultEntries }));
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, vaultKey, plain));
    const blob = { v: 1, iter: vaultIterations, salt: bytesToB64(vaultSalt), iv: bytesToB64(iv), data: bytesToB64(cipher) };
    try {
      localStorage.setItem(VAULT_KEY, JSON.stringify(blob));
      return true;
    } catch {
      return false;
    }
  });
  return vaultSaving;
}

// Decrypts a blob with a key; returns the list of valid entries, or null if the key is wrong or the data was changed.
async function decryptVault(blob, key) {
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(blob.iv) }, key, b64ToBytes(blob.data));
    const parsed = JSON.parse(new TextDecoder().decode(plain));
    if (!parsed || !Array.isArray(parsed.entries)) return null;
    return parsed.entries.filter((e) => e && typeof e.id === 'string').map(cleanVaultEntry);
  } catch {
    return null; // AES-GCM fails the integrity check on a wrong password or any tampering
  }
}

// One entry with every field forced to text (a damaged value becomes empty rather than breaking the screen).
function cleanVaultEntry(raw) {
  const text = (v) => (typeof v === 'string' ? v : '');
  return {
    id: text(raw.id),
    site: text(raw.site),
    username: text(raw.username),
    password: text(raw.password),
    url: text(raw.url),
    notes: text(raw.notes),
    dateAdded: text(raw.dateAdded),
    updatedAt: text(raw.updatedAt),
  };
}

// ---- opening, creating, locking ----

// Makes a new vault protected by `password` and leaves it open. Returns { ok } or { ok: false, error }.
async function createVault(password) {
  if (typeof password !== 'string' || password.length < VAULT_MIN_LENGTH) {
    return { ok: false, error: `Use at least ${VAULT_MIN_LENGTH} characters.` };
  }
  if (loadVaultBlob()) return { ok: false, error: 'A vault already exists on this device.' };
  vaultSalt = crypto.getRandomValues(new Uint8Array(16));
  vaultIterations = VAULT_ITERATIONS;
  vaultKey = await deriveVaultKey(password, vaultSalt, vaultIterations);
  vaultEntries = [];
  if (!(await saveVault())) {
    vaultKey = null;
    return { ok: false, error: 'Could not save the vault (the browser refused to store it).' };
  }
  armVaultIdle();
  return { ok: true };
}

// Tries a master password. Returns { ok } or { ok: false, error }; five wrong tries in a row pause for 30 seconds.
async function unlockVault(password) {
  const blob = loadVaultBlob();
  if (!blob) return { ok: false, error: 'There is no vault on this device.' };
  if (Date.now() < vaultPausedUntil) {
    return { ok: false, error: `Too many wrong tries. Wait ${Math.ceil((vaultPausedUntil - Date.now()) / 1000)} seconds.` };
  }
  const salt = b64ToBytes(blob.salt);
  const key = await deriveVaultKey(String(password), salt, blob.iter);
  const entries = await decryptVault(blob, key);
  if (!entries) {
    vaultFails += 1;
    if (vaultFails >= VAULT_MAX_FAILS) {
      vaultFails = 0;
      vaultPausedUntil = Date.now() + VAULT_PAUSE_MS;
      return { ok: false, error: 'Wrong master password. Too many tries: wait 30 seconds.' };
    }
    return { ok: false, error: 'Wrong master password.' };
  }
  vaultFails = 0;
  vaultKey = key;
  vaultSalt = salt;
  vaultIterations = blob.iter;
  vaultEntries = entries;
  armVaultIdle();
  return { ok: true };
}

// Forgets the key and every decrypted password, and shows the locked screen.
function lockVault() {
  clearTimeout(vaultIdleTimer);
  vaultKey = null;
  vaultSalt = null;
  vaultEntries = [];
  vaultRevealed.clear();
  vaultEditingId = null;
  const search = document.getElementById('vault-search');
  if (search) search.value = '';
  renderVault();
}

// Restarts the idle countdown (called whenever the vault is touched).
function armVaultIdle() {
  clearTimeout(vaultIdleTimer);
  if (vaultKey) vaultIdleTimer = setTimeout(lockVault, VAULT_IDLE_MS);
}

// ---- the passwords themselves ----

// Checks the form fields; returns { ok, entry } or { ok: false, error }.
function checkVaultFields(fields) {
  const site = String(fields.site || '').trim();
  const password = String(fields.password || '');
  if (!site) return { ok: false, error: 'Enter the website or app.' };
  if (!password) return { ok: false, error: 'Enter the password.' };
  return {
    ok: true,
    entry: { site, username: String(fields.username || '').trim(), password, url: String(fields.url || '').trim(), notes: String(fields.notes || '').trim() },
  };
}

// Runs a change to the entries and saves it; if saving fails the change is taken back. Returns { ok } or { ok: false, error }.
async function changeVaultEntries(change) {
  if (!vaultKey) return { ok: false, error: 'The vault is locked.' };
  const before = JSON.stringify(vaultEntries);
  change();
  if (await saveVault()) {
    armVaultIdle();
    return { ok: true };
  }
  vaultEntries = JSON.parse(before);
  return { ok: false, error: 'Could not save (the browser refused to store it).' };
}

// Adds a password.
async function addVaultEntry(fields) {
  const checked = checkVaultFields(fields);
  if (!checked.ok) return checked;
  const now = new Date().toISOString();
  return changeVaultEntries(() => vaultEntries.push({ id: makeId(), ...checked.entry, dateAdded: now, updatedAt: now }));
}

// Saves changes to a password.
async function updateVaultEntry(id, fields) {
  const checked = checkVaultFields(fields);
  if (!checked.ok) return checked;
  if (!vaultEntries.some((e) => e.id === id)) return { ok: false, error: 'That password was not found.' };
  return changeVaultEntries(() => {
    const entry = vaultEntries.find((e) => e.id === id);
    Object.assign(entry, checked.entry, { updatedAt: new Date().toISOString() });
  });
}

// Deletes a password for good (it is not kept in Undo or anywhere else).
async function deleteVaultEntry(id) {
  return changeVaultEntries(() => { vaultEntries = vaultEntries.filter((e) => e.id !== id); });
}

// Changes the master password: checks the current one, then re-encrypts everything with a new salt and key.
async function changeMasterPassword(current, next) {
  const blob = loadVaultBlob();
  if (!vaultKey || !blob) return { ok: false, error: 'Unlock the vault first.' };
  if (!(await decryptVault(blob, await deriveVaultKey(String(current), b64ToBytes(blob.salt), blob.iter)))) {
    return { ok: false, error: 'The current master password is wrong.' };
  }
  if (typeof next !== 'string' || next.length < VAULT_MIN_LENGTH) return { ok: false, error: `Use at least ${VAULT_MIN_LENGTH} characters.` };
  const previous = { key: vaultKey, salt: vaultSalt, iterations: vaultIterations };
  vaultSalt = crypto.getRandomValues(new Uint8Array(16));
  vaultIterations = VAULT_ITERATIONS;
  vaultKey = await deriveVaultKey(next, vaultSalt, vaultIterations);
  if (!(await saveVault())) {
    vaultKey = previous.key; vaultSalt = previous.salt; vaultIterations = previous.iterations;
    return { ok: false, error: 'Could not save the vault.' };
  }
  armVaultIdle();
  return { ok: true };
}

// ---- generator and strength ----

// A random integer from 0 to n-1 with no bias (values from the random source that would favour small numbers are skipped).
function secureRandomIndex(n) {
  const limit = Math.floor(0x100000000 / n) * n;
  const buffer = new Uint32Array(1);
  do { crypto.getRandomValues(buffer); } while (buffer[0] >= limit);
  return buffer[0] % n;
}

// A random password with at least one lowercase, uppercase and digit (and a symbol if asked), shuffled.
// Look-alike characters (l, 1, I, O, 0) are left out so it can be read aloud or typed from a screen.
function generatePassword(length = 16, { symbols = true } = {}) {
  const sets = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789'];
  if (symbols) sets.push('!@#$%^&*-_=+?');
  const all = sets.join('');
  const size = Math.max(length, sets.length);
  const chars = sets.map((set) => set[secureRandomIndex(set.length)]);
  while (chars.length < size) chars.push(all[secureRandomIndex(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) { // Fisher-Yates shuffle
    const j = secureRandomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// A rough strength guess from length and the kinds of characters used: { bits, label }.
function passwordStrength(password) {
  if (!password) return { bits: 0, label: '' };
  let pool = 0;
  if (/[a-z]/.test(password)) pool += 26;
  if (/[A-Z]/.test(password)) pool += 26;
  if (/[0-9]/.test(password)) pool += 10;
  if (/[^A-Za-z0-9]/.test(password)) pool += 20;
  const bits = Math.round(password.length * Math.log2(Math.max(pool, 2)));
  return { bits, label: bits < 40 ? 'Weak' : bits < 60 ? 'Fair' : bits < 80 ? 'Good' : 'Strong' };
}

// ---- clipboard ----

// Copies text; a copied password is wiped from the clipboard again after 30 seconds (the countdown restarts on each copy).
async function copyVaultText(text, what) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    showToast(`Could not copy the ${what}.`, false);
    return;
  }
  showToast(what === 'password' ? 'Password copied. It is cleared from the clipboard in 30 seconds.' : `Copied the ${what}.`, false);
  if (what !== 'password') return;
  clearTimeout(vaultClipboardTimer);
  vaultClipboardTimer = setTimeout(async () => {
    try { await navigator.clipboard.writeText(''); } catch { /* the browser will not let us (app not in front): nothing more to do */ }
  }, VAULT_CLIPBOARD_MS);
}

// ---- backup file ----

// Downloads the stored blob. It is already encrypted, so the file is safe to keep anywhere (it is useless without the master password).
function exportVaultFile() {
  const blob = loadVaultBlob();
  if (!blob) { setVaultMessage('There is no vault to export.', true); return; }
  const url = URL.createObjectURL(new Blob([JSON.stringify(blob, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `second-memory-vault-${todayKey()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  recordBackupTime(VAULT_BACKUP_AT_KEY);
  setVaultMessage('Vault file downloaded. It is encrypted: you need the master password to open it.', false);
}

// Puts a vault file in place of the vault on this device (after asking, if there already is one).
function restoreVaultFile(text) {
  let blob = null;
  try { blob = parseVaultBlob(JSON.parse(text)); } catch { /* not JSON */ }
  if (!blob) { setVaultMessage("That file doesn't look like a vault file.", true); return false; }
  if (loadVaultBlob() && !confirm('Replace the password vault on this device with this file? The current vault will be gone.')) return false;
  try { localStorage.setItem(VAULT_KEY, JSON.stringify(blob)); } catch { setVaultMessage('Could not store the vault file.', true); return false; }
  lockVault();
  setVaultMessage('Vault restored. Unlock it with its master password.', false);
  return true;
}

// ---- the screen ----

// A short message under the heading.
function setVaultMessage(text, isError) {
  const el = document.getElementById('vault-message');
  el.textContent = text;
  el.hidden = !text;
  el.classList.toggle('sync-failed', !!isError);
}

// Shows an error under one of the vault forms.
function showVaultError(id, text) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.hidden = !text;
}

// Shows the right view (create / locked / open) and, when open, the list.
function renderVault() {
  const hasVault = !!loadVaultBlob();
  const open = !!vaultKey;
  document.getElementById('vault-setup').hidden = hasVault;
  document.getElementById('vault-unlock').hidden = !hasVault || open;
  document.getElementById('vault-open').hidden = !open;
  if (!open) { renderVaultList(); return; }
  renderVaultForm();
  renderVaultList();
}

// Fills the add/edit form's title and button from whether an entry is being edited.
function renderVaultForm() {
  const editing = vaultEditingId !== null;
  document.getElementById('vault-form-title').textContent = editing ? 'Edit password' : 'Add a password';
  document.getElementById('vault-save-btn').textContent = editing ? 'Save changes' : 'Add password';
  document.getElementById('vault-cancel-edit').hidden = !editing;
}

// Clears the add/edit form.
function resetVaultForm() {
  vaultEditingId = null;
  ['vault-site', 'vault-username', 'vault-password', 'vault-url', 'vault-notes'].forEach((id) => { document.getElementById(id).value = ''; });
  document.getElementById('vault-show-password').checked = false;
  document.getElementById('vault-password').type = 'password';
  document.getElementById('vault-strength').textContent = '';
  showVaultError('vault-form-error', '');
  renderVaultForm();
}

// Only http and https addresses become links (never javascript: or anything else).
function safeVaultUrl(url) {
  const value = String(url || '').trim();
  if (!value) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const parsed = new URL(withScheme);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

// Draws the list of passwords (empty when locked). Text is always set with textContent, never as HTML.
function renderVaultList() {
  const list = document.getElementById('vault-list');
  list.innerHTML = '';
  const empty = document.getElementById('vault-empty');
  if (!vaultKey) { empty.hidden = true; return; }
  const term = document.getElementById('vault-search').value.trim().toLowerCase();
  const shown = vaultEntries
    .filter((e) => !term || `${e.site} ${e.username} ${e.url}`.toLowerCase().includes(term))
    .sort((a, b) => a.site.localeCompare(b.site, undefined, { sensitivity: 'base' }));
  empty.hidden = vaultEntries.length !== 0;
  shown.forEach((entry) => {
    const li = document.createElement('li');
    li.className = 'vault-entry';
    li.dataset.vaultId = entry.id;
    const site = document.createElement('strong');
    site.textContent = entry.site;
    li.appendChild(site);
    const line = (text, className) => { const p = document.createElement('p'); p.className = className || 'vault-line'; p.textContent = text; li.appendChild(p); return p; };
    if (entry.username) line(entry.username);
    const shownPassword = vaultRevealed.has(entry.id);
    line(shownPassword ? entry.password : '\u2022'.repeat(Math.min(entry.password.length, 12) || 8), 'vault-line vault-secret').classList.add('vault-password');
    if (entry.notes) line(entry.notes);

    const actions = document.createElement('div');
    actions.className = 'vault-actions';
    const button = (label, onClick, extraClass) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (extraClass) b.className = extraClass;
      b.addEventListener('click', () => { armVaultIdle(); onClick(); });
      actions.appendChild(b);
      return b;
    };
    button(shownPassword ? 'Hide' : 'Show', () => { if (shownPassword) vaultRevealed.delete(entry.id); else vaultRevealed.add(entry.id); renderVaultList(); }, 'vault-toggle');
    button('Copy password', () => copyVaultText(entry.password, 'password'), 'vault-copy-password');
    if (entry.username) button('Copy username', () => copyVaultText(entry.username, 'username'), 'vault-copy-username');
    const href = safeVaultUrl(entry.url);
    if (href) {
      const open = document.createElement('a');
      open.href = href;
      open.target = '_blank';
      open.rel = 'noopener noreferrer';
      open.textContent = 'Open site';
      actions.appendChild(open);
    }
    button('Edit', () => startVaultEdit(entry.id), 'vault-edit');
    button('Delete', async () => {
      if (!confirm(`Delete the saved password for ${entry.site}? This cannot be undone.`)) return;
      vaultRevealed.delete(entry.id);
      const result = await deleteVaultEntry(entry.id);
      if (!result.ok) setVaultMessage(result.error, true);
      renderVaultList();
    }, 'vault-delete');
    li.appendChild(actions);
    list.appendChild(li);
  });
}

// Loads an entry into the form for editing.
function startVaultEdit(id) {
  const entry = vaultEntries.find((e) => e.id === id);
  if (!entry) return;
  vaultEditingId = id;
  document.getElementById('vault-site').value = entry.site;
  document.getElementById('vault-username').value = entry.username;
  document.getElementById('vault-password').value = entry.password;
  document.getElementById('vault-url').value = entry.url;
  document.getElementById('vault-notes').value = entry.notes;
  document.getElementById('vault-add-details').open = true;
  renderVaultForm();
  updateVaultStrength();
  document.getElementById('vault-site').focus();
}

// Shows the strength guess under the password box.
function updateVaultStrength() {
  const { bits, label } = passwordStrength(document.getElementById('vault-password').value);
  document.getElementById('vault-strength').textContent = label ? `${label} (about ${bits} bits)` : '';
}

// ---- wiring ----

// First visit: create the vault.
document.getElementById('vault-setup').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = document.getElementById('vault-new-password').value;
  if (password !== document.getElementById('vault-new-confirm').value) { showVaultError('vault-setup-error', 'The two passwords do not match.'); return; }
  showVaultError('vault-setup-error', 'Creating\u2026');
  const result = await createVault(password);
  if (!result.ok) { showVaultError('vault-setup-error', result.error); return; }
  document.getElementById('vault-new-password').value = '';
  document.getElementById('vault-new-confirm').value = '';
  showVaultError('vault-setup-error', '');
  setVaultMessage('Vault created. Remember the master password: it cannot be recovered.', false);
  renderVault();
});

// Locked: unlock.
document.getElementById('vault-unlock').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('vault-unlock-password');
  showVaultError('vault-unlock-error', 'Unlocking\u2026');
  const result = await unlockVault(input.value);
  input.value = '';
  if (!result.ok) { showVaultError('vault-unlock-error', result.error); return; }
  showVaultError('vault-unlock-error', '');
  setVaultMessage('', false);
  renderVault();
});

// Forgot the master password: the only way forward is to erase the vault and start again.
document.getElementById('vault-forgot').addEventListener('click', () => {
  if (!confirm('Erase the password vault on this device? Every saved password will be gone for good. This cannot be undone.')) return;
  try { localStorage.removeItem(VAULT_KEY); } catch { /* nothing to remove it from */ }
  lockVault();
  setVaultMessage('The vault was erased. You can create a new one.', false);
});

document.getElementById('vault-lock-btn').addEventListener('click', lockVault);
document.getElementById('vault-search').addEventListener('input', () => { armVaultIdle(); renderVaultList(); });

// Add or save.
document.getElementById('vault-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fields = {
    site: document.getElementById('vault-site').value,
    username: document.getElementById('vault-username').value,
    password: document.getElementById('vault-password').value,
    url: document.getElementById('vault-url').value,
    notes: document.getElementById('vault-notes').value,
  };
  const result = vaultEditingId ? await updateVaultEntry(vaultEditingId, fields) : await addVaultEntry(fields);
  if (!result.ok) { showVaultError('vault-form-error', result.error); return; }
  resetVaultForm();
  document.getElementById('vault-add-details').open = false;
  renderVaultList();
});
document.getElementById('vault-cancel-edit').addEventListener('click', () => { resetVaultForm(); document.getElementById('vault-add-details').open = false; });
document.getElementById('vault-show-password').addEventListener('change', (e) => { document.getElementById('vault-password').type = e.target.checked ? 'text' : 'password'; });
document.getElementById('vault-password').addEventListener('input', updateVaultStrength);
document.getElementById('vault-generate').addEventListener('click', () => {
  document.getElementById('vault-password').value = generatePassword(16);
  document.getElementById('vault-show-password').checked = true;
  document.getElementById('vault-password').type = 'text';
  updateVaultStrength();
});

// Vault tools.
document.getElementById('vault-export').addEventListener('click', exportVaultFile);
for (const id of ['vault-import', 'vault-import-first']) document.getElementById(id).addEventListener('click', () => document.getElementById('vault-file-input').click());
document.getElementById('vault-file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => restoreVaultFile(String(reader.result));
  reader.onerror = () => setVaultMessage('Could not read that file.', true);
  reader.readAsText(file);
});
document.getElementById('vault-change-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const current = document.getElementById('vault-change-current').value;
  const next = document.getElementById('vault-change-new').value;
  if (next !== document.getElementById('vault-change-confirm').value) { showVaultError('vault-change-error', 'The two new passwords do not match.'); return; }
  const result = await changeMasterPassword(current, next);
  if (!result.ok) { showVaultError('vault-change-error', result.error); return; }
  ['vault-change-current', 'vault-change-new', 'vault-change-confirm'].forEach((id) => { document.getElementById(id).value = ''; });
  showVaultError('vault-change-error', '');
  setVaultMessage('Master password changed.', false);
});

// Locks itself: after a few idle minutes (any touch inside the Passwords screen restarts the countdown),
// and when the app has been out of sight for a minute.
['pointerdown', 'keydown'].forEach((type) => document.getElementById('passwords-collection').addEventListener(type, armVaultIdle));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { vaultHiddenAt = Date.now(); return; }
  if (vaultKey && vaultHiddenAt !== null && Date.now() - vaultHiddenAt >= VAULT_HIDDEN_LOCK_MS) lockVault();
  vaultHiddenAt = null;
});

// ---- Init ----
// First draw of every screen, then the sync controls and the service worker. Home is not drawn here
// directly: renderBooks and others each end by calling renderHome.
// This block goes last on purpose: it needs every const and let above, and using one before its
// line has run would throw.

[
  renderBooks, renderRecipes, renderJournal, renderNotes, renderLinks,
].forEach(safeRender);
updateUndoRedoButtons();
setActiveTab(loadUiState().activeTab || 'home');
initSyncUI();

// ---- Help and welcome ----
// One short tour, shown in two places: a card on Home until you dismiss it (first run), and Menu > Help any time.

const HELP_TIPS = [
  'Quick add: type on Home to add a note.',
  'The bar at the bottom jumps to your most-used screens; Menu has everything else, including Undo.',
  'This app keeps your books, recipes, journal, notes, passwords and resume links. Hide Home panels with Customize Home.',
  'Sync: enter the same passphrase on each device (Menu) and your lists stay up to date on their own. The server may need up to a minute to wake.',
  'Your to-do list, shopping list, calendar, medications, diagnoses and weight now live in Petalkeeper, MealMate and Caregiver Command Center. What you had here is still stored on this device and is included every time you use Export data.',
  'Back up now and then (Menu > Export data). The journal is private and lives only on this device, so back it up separately.',
  'Menu > Settings check shows what is set up and what needs a look. Menu > Update now loads the newest version.',
];
const WELCOME_SEEN_KEY = 'secondMemory.welcomeSeen.v1';
const WELCOME_TIPS_SHOWN = 4;

// Fills a <ul> with the first `limit` tips (all of them by default).
function fillTipList(list, limit = HELP_TIPS.length) {
  list.innerHTML = '';
  HELP_TIPS.slice(0, limit).forEach((tip) => {
    const item = document.createElement('li');
    item.textContent = tip;
    list.appendChild(item);
  });
}

// Shows the Home welcome card unless it was dismissed before.
function updateWelcomeCard() {
  let seen = false;
  try { seen = localStorage.getItem(WELCOME_SEEN_KEY) === '1'; } catch { /* treated as not seen */ }
  document.getElementById('welcome-card').hidden = seen;
}

document.getElementById('welcome-dismiss').addEventListener('click', () => {
  try { localStorage.setItem(WELCOME_SEEN_KEY, '1'); } catch { /* not saved: it will show again next visit */ }
  updateWelcomeCard();
});
// The "lists moved" notice: shown on Home until dismissed, but only on a device that still holds some of those lists.
const MOVED_SEEN_KEY = 'secondMemory.movedNoticeSeen.v1';
function updateMovedCard() {
  let seen = false;
  try { seen = localStorage.getItem(MOVED_SEEN_KEY) === '1'; } catch { /* treated as not seen */ }
  const holdsRetired = RETIRED_LISTS.some((r) => readRetiredList(r.key).length > 0) || readRetiredWeightGoal() !== null;
  document.getElementById('moved-card').hidden = seen || !holdsRetired;
}
document.getElementById('moved-dismiss').addEventListener('click', () => {
  try { localStorage.setItem(MOVED_SEEN_KEY, '1'); } catch { /* not saved: it will show again next visit */ }
  updateMovedCard();
});
document.getElementById('moved-export').addEventListener('click', exportData);
updateMovedCard();

fillTipList(document.getElementById('welcome-list'), WELCOME_TIPS_SHOWN); // the card is short; Menu > Help has the rest
fillTipList(document.getElementById('help-list'));
updateWelcomeCard();

// ---- Auto-sync ----
// With sync set up (and Auto-sync On in the Menu), the app syncs by itself: shortly after the app opens or comes
// back to the front, and about 8 seconds after you change something (a burst of changes syncs once). It stays
// quiet when the app is in the background, waits at least 30 seconds between tries, and after a failed or
// unfinished sync backs off for 5 minutes so a sleeping server or a bad connection is not hammered.

const AUTO_SYNC_KEY = 'secondMemory.autoSync.v1'; // set to 'off' when switched off; absent means on
const AUTO_SYNC_DELAY_MS = 8000; // quiet time after a change before syncing
const AUTO_SYNC_MIN_GAP_MS = 30000; // never two automatic tries closer than this
const AUTO_SYNC_BACKOFF_MS = 5 * 60000; // pause after a sync that failed or did not finish
const AUTO_SYNC_OPEN_GAP_MS = 5 * 60000; // coming back to the front only syncs if the last one is older than this

let autoSyncTimer = null;
let lastAutoSyncAt = 0;
let autoSyncBackoffUntil = 0;

// True unless the user switched Auto-sync off.
function autoSyncOn() {
  try { return localStorage.getItem(AUTO_SYNC_KEY) !== 'off'; } catch { return true; }
}

// Plans an automatic sync after `delay` milliseconds (replacing any earlier plan). `reason` is 'change' (only syncs
// if something differs from the server) or 'open' (syncs even if nothing changed here, to pick up other devices' edits).
function scheduleAutoSync(delay = AUTO_SYNC_DELAY_MS, reason = 'change') {
  if (!loadSyncConfig() || !autoSyncOn()) return;
  clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(() => autoSyncNow(reason), delay);
}

// Runs the planned sync if every condition still holds.
async function autoSyncNow(reason) {
  if (!loadSyncConfig() || !autoSyncOn() || syncInFlight) return;
  if (document.visibilityState !== 'visible') return; // only while the app is in front
  const now = Date.now();
  if (now < autoSyncBackoffUntil || now - lastAutoSyncAt < AUTO_SYNC_MIN_GAP_MS) return;
  const pending = countUnsyncedChanges(); // null = never synced on this device
  if (reason === 'change' && pending === 0) return; // nothing to send
  lastAutoSyncAt = now;
  await runSync();
  // 'ok' means a clean sync; anything else (failure, conflicts, an unfinished reply) pauses further automatic tries.
  autoSyncBackoffUntil = lastSyncTone === 'ok' ? 0 : Date.now() + AUTO_SYNC_BACKOFF_MS;
}

// Brings the app to date when it opens or returns to the front, if the last sync is old enough.
function autoSyncOnReturn() {
  if (document.visibilityState !== 'visible') return;
  const days = daysSinceBackup(LAST_SYNC_AT_KEY);
  const recent = days === 0 && lastSyncedAt && Date.now() - lastSyncedAt.getTime() < AUTO_SYNC_OPEN_GAP_MS;
  if (!recent) scheduleAutoSync(1500, 'open');
}

// The Menu button's label: On / Off, or a hint when sync is not set up.
function updateAutoSyncButton() {
  const btn = document.getElementById('autosync-btn');
  const hasSync = !!loadSyncConfig();
  btn.disabled = !hasSync;
  btn.textContent = hasSync ? `Auto-sync: ${autoSyncOn() ? 'On' : 'Off'}` : 'Auto-sync: set up sync first';
}

document.getElementById('autosync-btn').addEventListener('click', () => {
  const turnOn = !autoSyncOn();
  try {
    if (turnOn) localStorage.removeItem(AUTO_SYNC_KEY); else localStorage.setItem(AUTO_SYNC_KEY, 'off');
  } catch { /* not saved: lasts until the page closes */ }
  updateAutoSyncButton();
  if (turnOn) scheduleAutoSync(1500, 'open'); else clearTimeout(autoSyncTimer);
});

document.addEventListener('visibilitychange', autoSyncOnReturn);
updateAutoSyncButton();
autoSyncOnReturn(); // the app has just opened

// ---- Settings check ----
// A short checklist in the Menu: what is set up and what needs a look. Built each time the list is opened,
// so it always shows the current state. Each row is "OK", "Check" (needs attention) or "Info", with an
// optional button that does the fix.

// Adds one row to the checklist.
function addCheckRow(list, level, title, detail, actionLabel, action) {
  const row = document.createElement('li');
  row.className = `check-${level}`;
  const mark = document.createElement('span');
  mark.className = 'check-mark';
  mark.textContent = { ok: 'OK', warn: 'Check', info: 'Info' }[level];
  const text = document.createElement('span');
  text.textContent = `${title}: ${detail}`;
  row.append(mark, text);
  if (actionLabel) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'check-action';
    btn.textContent = actionLabel;
    btn.addEventListener('click', action);
    row.appendChild(btn);
  }
  list.appendChild(row);
}

// "Never" or "N days ago" rows for a backup/sync time: OK when recent, Check when never or a week old.
function addAgeRow(list, title, days, dueDays, actionLabel, action) {
  if (days === null) addCheckRow(list, 'warn', title, 'never', actionLabel, action);
  else if (days >= dueDays) addCheckRow(list, 'warn', title, backupAgeText(days), actionLabel, action);
  else addCheckRow(list, 'ok', title, backupAgeText(days));
}

// Rebuilds the whole checklist from the current state of this device.
async function renderSettingsCheck() {
  const list = document.getElementById('settings-check-list');
  const rows = document.createElement('ul'); // built off-screen first: the offline check below is async
  if (!loadSyncConfig()) addCheckRow(rows, 'info', 'Sync', 'not set up, so your data stays on this device only');
  else {
    addAgeRow(rows, 'Last sync', daysSinceBackup(LAST_SYNC_AT_KEY), SYNC_STALE_DAYS, 'Sync now', runSync);
    if (autoSyncOn()) addCheckRow(rows, 'ok', 'Auto-sync', 'on, it syncs when the app opens and after changes');
    else addCheckRow(rows, 'info', 'Auto-sync', 'off, so you have to tap Sync now yourself', 'Turn on', () => document.getElementById('autosync-btn').click());
  }

  const hasAnyData = SYNC_COLLECTIONS.some((c) => c.get().some((r) => !r.deleted));
  if (hasAnyData) addAgeRow(rows, 'Backup file', daysSinceBackup(EXPORT_AT_KEY), EXPORT_DUE_DAYS, 'Back up now', exportData);
  else addCheckRow(rows, 'info', 'Backup file', 'nothing to back up yet');
  if (journalEntries.length > 0) addAgeRow(rows, 'Journal backup', daysSinceBackup(JOURNAL_BACKUP_AT_KEY), JOURNAL_BACKUP_DUE_DAYS, 'Back up journal', downloadJournalBackup);

  if (!loadVaultBlob()) addCheckRow(rows, 'info', 'Password vault', 'not created');
  else {
    addCheckRow(rows, 'ok', 'Password vault', vaultKey ? 'unlocked' : 'locked');
    addAgeRow(rows, 'Vault backup', daysSinceBackup(VAULT_BACKUP_AT_KEY), 30, 'Export vault', exportVaultFile);
  }

  if (loadLock()) addCheckRow(rows, 'ok', 'App lock', 'on');
  else addCheckRow(rows, 'info', 'App lock', 'off, so anyone holding your phone can open the app', 'Set up', () => document.getElementById('lock-btn').click());

  let offline = null;
  try { offline = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null; } catch { /* treated as not installed */ }
  if (offline) addCheckRow(rows, 'ok', 'Offline use', 'ready, the app works without a connection');
  else addCheckRow(rows, 'info', 'Offline use', 'not set up here; open the app once with a connection');

  list.replaceChildren(...rows.children);
}

document.getElementById('settings-check').addEventListener('toggle', (e) => {
  if (e.target.open) renderSettingsCheck();
});

// ---- Updates ----
// The app updates itself in the background: the service worker downloads a new version and takes over, but the
// page already on screen keeps running the old code until it is reloaded. "Update now" (Menu) and the banner
// below let you do that reload right away instead of waiting for the next time the app is opened.

let newVersionReady = false; // true once a newer version has taken over behind the page

// Reloads the page. A tiny wrapper so the tests can replace it.
function reloadApp() {
  location.reload();
}

// Shows the "new version is ready" banner (called when a newer service worker takes over).
function noteNewVersionReady() {
  newVersionReady = true;
  document.getElementById('update-banner').hidden = false;
}

// The Update now button: reload at once if a new version is already waiting, otherwise ask the browser to
// look for one, wait for it to take over and reload. Says so when you already have the latest.
async function updateNow() {
  const status = document.getElementById('update-status');
  status.hidden = false;
  if (newVersionReady || !('serviceWorker' in navigator)) { reloadApp(); return; }
  status.textContent = 'Checking for a new version\u2026';
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) { reloadApp(); return; } // not installed as an offline app: a plain reload fetches the newest files
    await registration.update();
    const worker = registration.installing || registration.waiting;
    if (!worker) {
      status.textContent = `You have the latest version (${APP_VERSION}).`;
      return;
    }
    status.textContent = 'Downloading the new version\u2026';
    await new Promise((resolve) => {
      if (worker.state === 'activated') { resolve(); return; }
      worker.addEventListener('statechange', () => { if (worker.state === 'activated' || worker.state === 'redundant') resolve(); });
    });
    status.textContent = 'Updated. Reloading\u2026';
    reloadApp();
  } catch {
    status.textContent = "Couldn't check for updates. Are you online?";
  }
}

document.getElementById('update-now-btn').addEventListener('click', updateNow);
document.getElementById('update-banner-btn').addEventListener('click', () => reloadApp());

// A new service worker taking over while the page was already controlled means a new version arrived.
// (The very first install also fires this event, so it only counts when there was a controller before.)
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) noteNewVersionReady(); });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((registration) => {
      // Check for a newer version now and each time the app comes back to the front.
      // update() fails when offline; that is expected, so the failure is swallowed.
      const checkForUpdate = () => registration.update().catch(() => {});
      checkForUpdate();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
      });
    }).catch(() => {
      // Offline install is optional (e.g. private browsing); the app still works without it.
    });
  });
}
