// Second Memory — Books, Recipes, Medications, Diagnoses
// All persistence is local (localStorage). No network calls, no dependencies.

// ---- Shared helpers ----

function makeId() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadCollection(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCollection(key, items) {
  localStorage.setItem(key, JSON.stringify(items));
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
  return (value || '').trim().toLowerCase();
}

// Derives the distinct chip groups from a live, non-deleted array: one entry
// per normalized key, displayed using the first-seen original casing/spacing
// for that group, sorted alphabetically. Blank/missing values are excluded —
// the caller adds the "All" option on top of this.
function deriveChipOptions(items, getValue) {
  const byKey = new Map();
  items.forEach((item) => {
    const raw = (getValue(item) || '').trim();
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
    chip.addEventListener('click', () => {
      setSelected(key);
      onSelect();
    });
    container.appendChild(chip);
  });
}

// ---- Device identity & sync metadata ----

const DEVICE_KEY = 'secondMemory.device.v1';
let cachedDeviceId = null;

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
  localStorage.setItem(DEVICE_KEY, JSON.stringify({ deviceId: cachedDeviceId, createdAt: new Date().toISOString() }));
  return cachedDeviceId;
}

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
// whole-array snapshot). See docs/specs/edit-everywhere-and-undo-redo.md.

let undoStack = [];
let redoStack = [];
let isApplyingHistory = false; // guard: undo/redo replays never re-record themselves
const MAX_UNDO_DEPTH = 50;

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
}

// ---- UI state (active tab) ----

const UI_STORAGE_KEY = 'secondMemory.ui.v1';
const TABS = ['home', 'books', 'recipes', 'medications', 'diagnoses', 'todo', 'shopping', 'notes', 'budget', 'resume', 'coursework'];

function loadUiState() {
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch {
    return {};
  }
}

function saveUiState(state) {
  localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(state));
}

function setActiveTab(tab) {
  const activeTab = TABS.includes(tab) ? tab : 'home';
  TABS.forEach((t) => {
    document.getElementById(`${t}-collection`).hidden = t !== activeTab;
    document.querySelector(`.nav-item[data-tab="${t}"]`).classList.toggle('active', t === activeTab);
  });
  saveUiState({ activeTab });
}

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
});

// ---- Books ----

const BOOKS_KEY = 'secondMemory.books.v1';
const BOOK_STATUSES = ['want_to_buy', 'owned_unread', 'currently_reading', 'owned_read', 'textbook', 'jons_bookshelf', 'jons_bookshelf_read'];

let books = migrateSyncFields(loadCollection(BOOKS_KEY), BOOKS_KEY, getDeviceId());

function addBook(title, author, status) {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) return;
  const now = new Date().toISOString();
  const book = {
    id: makeId(),
    title: trimmedTitle,
    author: author.trim(),
    status: BOOK_STATUSES.includes(status) ? status : 'want_to_buy',
    rating: null,
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
}

function updateBookStatus(id, newStatus) {
  const book = books.find((b) => b.id === id);
  if (!book || !BOOK_STATUSES.includes(newStatus)) return;
  const before = structuredClone(book);
  book.status = newStatus;
  if (newStatus !== 'owned_read') book.rating = null;
  stampSync(book);
  saveCollection(BOOKS_KEY, books);
  recordUndo('books', id, before, structuredClone(book));
  renderBooks();
}

function updateBookRating(id, rating) {
  const book = books.find((b) => b.id === id);
  if (!book) return;
  const before = structuredClone(book);
  book.rating = rating ? Number(rating) : null;
  stampSync(book);
  saveCollection(BOOKS_KEY, books);
  recordUndo('books', id, before, structuredClone(book));
}

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

function updateBook(id, fields) {
  const book = books.find((b) => b.id === id);
  if (!book) return;
  const trimmedTitle = fields.title.trim();
  if (!trimmedTitle) return;
  const before = structuredClone(book);
  book.title = trimmedTitle;
  book.author = fields.author.trim();
  stampSync(book);
  saveCollection(BOOKS_KEY, books);
  recordUndo('books', id, before, structuredClone(book));
  renderBooks();
}

function matchesBookSearch(book, term) {
  if (!term) return true;
  const haystack = `${book.title} ${book.author}`.toLowerCase();
  return haystack.includes(term.toLowerCase());
}

// 'author_asc' is the default/initial state, matching the previously
// hardcoded (and now user-facing) sort behavior exactly.
let selectedBooksSort = 'author_asc';

const BOOK_SORTS = {
  author_asc: compareByField((b) => (b.author || '').trim(), 1),
  title_asc: compareByField((b) => b.title, 1),
  date_added_desc: compareByField((b) => b.dateAdded, -1, { text: false }),
  date_added_asc: compareByField((b) => b.dateAdded, 1, { text: false }),
};

function renderBooksStats(nonDeletedBooks) {
  const el = document.getElementById('books-stats');
  if (!el) return;
  const total = nonDeletedBooks.length;
  const countFor = (status) => nonDeletedBooks.filter((b) => b.status === status).length;
  el.textContent = `${total} book${total === 1 ? '' : 's'} · ${countFor('want_to_buy')} want to buy · ` +
    `${countFor('owned_unread')} unread · ${countFor('currently_reading')} currently reading · ` +
    `${countFor('owned_read')} read · ${countFor('textbook')} textbooks · ` +
    `${countFor('jons_bookshelf')} on Jon's Bookshelf (unread) · ${countFor('jons_bookshelf_read')} on Jon's Bookshelf (read)`;
}

function renderBooks() {
  const searchTerm = document.getElementById('books-search-input').value;
  const nonDeleted = books.filter((b) => !b.deleted);
  const visible = nonDeleted.filter((b) => matchesBookSearch(b, searchTerm));
  const comparator = BOOK_SORTS[selectedBooksSort] || BOOK_SORTS.author_asc;
  const template = document.getElementById('books-card-template');

  renderBooksStats(nonDeleted);

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

      const ratingLabel = node.querySelector('.rating-label');
      const ratingSelect = node.querySelector('.rating-select');
      const ratingDisplay = node.querySelector('.book-rating');

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
        editAuthorInput.value = book.author;
        viewSection.hidden = true;
        editForm.hidden = false;
      });

      node.querySelector('.cancel-btn').addEventListener('click', () => {
        editForm.hidden = true;
        viewSection.hidden = false;
      });

      editForm.addEventListener('submit', (e) => {
        e.preventDefault();
        updateBook(book.id, { title: editTitleInput.value, author: editAuthorInput.value });
      });

      node.querySelector('.delete-btn').addEventListener('click', () => deleteBook(book.id));

      if (openEdit && openEdit.id === book.id) {
        editTitleInput.value = openEdit.title;
        editAuthorInput.value = openEdit.author;
        viewSection.hidden = true;
        editForm.hidden = false;
      }

      list.appendChild(node);
    });
  });

  document.getElementById('books-empty-state').hidden = nonDeleted.length !== 0;

  renderHome(); // Home aggregates books/todos/bills — keep this in sync
}

document.getElementById('books-add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const titleInput = document.getElementById('books-title-input');
  const authorInput = document.getElementById('books-author-input');
  const statusInput = document.getElementById('books-status-input');
  addBook(titleInput.value, authorInput.value, statusInput.value);
  titleInput.value = '';
  authorInput.value = '';
  titleInput.focus();
});

document.getElementById('books-search-input').addEventListener('input', renderBooks);

document.getElementById('books-sort-input').addEventListener('change', (e) => {
  selectedBooksSort = e.target.value;
  renderBooks();
});

// ---- Recipes ----

const RECIPES_KEY = 'secondMemory.recipes.v1';

let recipes = migrateSyncFields(loadCollection(RECIPES_KEY), RECIPES_KEY, getDeviceId());

function splitLines(text) {
  return text.split('\n').map((s) => s.trim()).filter(Boolean);
}

function addRecipe(title, category, ingredientsText, stepsText, notes) {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) return;
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
}

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

function updateRecipe(id, fields) {
  const recipe = recipes.find((r) => r.id === id);
  if (!recipe) return;
  const trimmedTitle = fields.title.trim();
  if (!trimmedTitle) return;
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

function matchesRecipeSearch(recipe, term) {
  if (!term) return true;
  const haystack = [recipe.title, recipe.category, ...recipe.ingredients, ...recipe.steps, recipe.notes]
    .join(' ')
    .toLowerCase();
  return haystack.includes(term.toLowerCase());
}

// 'all' is the default/initial state and always shows every recipe. Stores
// the *normalized* key (see normalizeChipKey), not the raw display string,
// so "Sides" and "sides" are treated as the same selected chip.
let selectedRecipeCategory = 'all';

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

// 'date_added_asc' is the default — a no-op relative to the previously
// unsorted (≈ insertion-order) rendering, so existing users see zero change.
let selectedRecipesSort = 'date_added_asc';

const RECIPE_SORTS = {
  date_added_asc: compareByField((r) => r.dateAdded, 1, { text: false }),
  date_added_desc: compareByField((r) => r.dateAdded, -1, { text: false }),
  title_asc: compareByField((r) => r.title, 1),
};

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
    if (recipe.ingredients.length) {
      const ingredientsList = node.querySelector('.recipe-ingredients');
      recipe.ingredients.forEach((ing) => {
        const li = document.createElement('li');
        li.textContent = ing;
        ingredientsList.appendChild(li);
      });
      ingredientsSection.hidden = false;
    }

    const stepsSection = node.querySelector('.recipe-steps-section');
    if (recipe.steps.length) {
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
      editCategoryInput.value = recipe.category;
      editIngredientsInput.value = recipe.ingredients.join('\n');
      editStepsInput.value = recipe.steps.join('\n');
      editNotesInput.value = recipe.notes;
      viewSection.hidden = true;
      editForm.hidden = false;
    });

    node.querySelector('.cancel-btn').addEventListener('click', () => {
      editForm.hidden = true;
      viewSection.hidden = false;
    });

    editForm.addEventListener('submit', (e) => {
      e.preventDefault();
      updateRecipe(recipe.id, {
        title: editTitleInput.value,
        category: editCategoryInput.value,
        ingredientsText: editIngredientsInput.value,
        stepsText: editStepsInput.value,
        notes: editNotesInput.value,
      });
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

  document.getElementById('recipes-empty-state').hidden = recipes.filter((r) => !r.deleted).length !== 0;
}

document.getElementById('recipes-add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const titleInput = document.getElementById('recipes-title-input');
  const categoryInput = document.getElementById('recipes-category-input');
  const ingredientsInput = document.getElementById('recipes-ingredients-input');
  const stepsInput = document.getElementById('recipes-steps-input');
  const notesInput = document.getElementById('recipes-notes-input');
  addRecipe(titleInput.value, categoryInput.value, ingredientsInput.value, stepsInput.value, notesInput.value);
  titleInput.value = '';
  categoryInput.value = '';
  ingredientsInput.value = '';
  stepsInput.value = '';
  notesInput.value = '';
  titleInput.focus();
});

document.getElementById('recipes-search-input').addEventListener('input', renderRecipes);

document.getElementById('recipes-sort-input').addEventListener('change', (e) => {
  selectedRecipesSort = e.target.value;
  renderRecipes();
});

// ---- Medications ----

const MEDICATIONS_KEY = 'secondMemory.medications.v1';

let medications = migrateSyncFields(loadCollection(MEDICATIONS_KEY), MEDICATIONS_KEY, getDeviceId());

function isValidDateRange(startDate, endDate) {
  if (!startDate || !endDate) return true;
  return endDate >= startDate;
}

function addMedication(fields) {
  const trimmedName = fields.name.trim();
  if (!trimmedName) return { ok: false, error: 'Name is required.' };
  const startDate = fields.startDate || null;
  const endDate = fields.endDate || null;
  if (!isValidDateRange(startDate, endDate)) {
    return { ok: false, error: 'End date cannot be before start date.' };
  }
  const now = new Date().toISOString();
  const med = {
    id: makeId(),
    name: trimmedName,
    dosage: fields.dosage.trim(),
    frequency: fields.frequency.trim(),
    prescribingDoctor: fields.prescribingDoctor.trim(),
    startDate,
    endDate,
    notes: fields.notes.trim(),
    dateAdded: now,
    updatedAt: now,
    deviceId: getDeviceId(),
    deleted: false,
    version: 0,
  };
  medications.push(med);
  saveCollection(MEDICATIONS_KEY, medications);
  recordUndo('medications', med.id, null, structuredClone(med));
  renderMedications();
  return { ok: true };
}

function updateMedicationDate(id, field, value) {
  const med = medications.find((m) => m.id === id);
  if (!med) return { ok: false, error: 'Medication not found.' };
  const newStart = field === 'startDate' ? (value || null) : med.startDate;
  const newEnd = field === 'endDate' ? (value || null) : med.endDate;
  if (!isValidDateRange(newStart, newEnd)) {
    return { ok: false, error: 'End date cannot be before start date.' };
  }
  const before = structuredClone(med);
  med.startDate = newStart;
  med.endDate = newEnd;
  stampSync(med);
  saveCollection(MEDICATIONS_KEY, medications);
  recordUndo('medications', id, before, structuredClone(med));
  renderMedications();
  return { ok: true };
}

function deleteMedication(id) {
  const med = medications.find((m) => m.id === id);
  if (!med) return;
  const before = structuredClone(med);
  med.deleted = true;
  stampSync(med);
  saveCollection(MEDICATIONS_KEY, medications);
  recordUndo('medications', id, before, structuredClone(med));
  renderMedications();
}

function restoreMedication(id) {
  const med = medications.find((m) => m.id === id);
  if (!med || !med.deleted) return;
  const before = structuredClone(med);
  med.deleted = false;
  stampSync(med);
  saveCollection(MEDICATIONS_KEY, medications);
  recordUndo('medications', id, before, structuredClone(med));
  renderMedications();
}

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

function matchesMedicationSearch(med, term) {
  if (!term) return true;
  const haystack = [med.name, med.dosage, med.frequency, med.prescribingDoctor, med.notes]
    .join(' ')
    .toLowerCase();
  return haystack.includes(term.toLowerCase());
}

// 'name_asc' is the proposed default — medications have no natural
// chronological default the way Recipes' insertion order does.
let selectedMedicationsSort = 'name_asc';

const MEDICATION_SORTS = {
  name_asc: compareByField((m) => m.name, 1),
  start_date_desc: compareByField((m) => m.startDate, -1, { text: false }),
  start_date_asc: compareByField((m) => m.startDate, 1, { text: false }),
};

function renderMedicationGroup(groupKey, items, template, openEdit) {
  const list = document.querySelector(`[data-med-list="${groupKey}"]`);
  list.innerHTML = '';
  document.querySelector(`[data-med-count="${groupKey}"]`).textContent = items.length;

  items.forEach((med) => {
    const node = template.content.cloneNode(true);
    const card = node.querySelector('.med-card');
    card.dataset.medId = med.id;
    const viewSection = node.querySelector('.med-view');
    const editForm = node.querySelector('.med-edit-form');

    node.querySelector('.med-name').textContent = med.name;

    const setField = (fieldClass, wrapperClass, value) => {
      const wrapper = node.querySelector(`.${wrapperClass}`);
      if (value) {
        node.querySelector(`.${fieldClass}`).textContent = value;
        wrapper.hidden = false;
      }
    };
    setField('med-dosage', 'med-dosage-field', med.dosage);
    setField('med-frequency', 'med-frequency-field', med.frequency);
    setField('med-doctor', 'med-doctor-field', med.prescribingDoctor);

    const startInput = node.querySelector('.med-start-date');
    const endInput = node.querySelector('.med-end-date');
    const unknownHint = node.querySelector('.unknown-hint');
    const dateError = node.querySelector('.med-date-error');

    startInput.value = med.startDate || '';
    endInput.value = med.endDate || '';
    unknownHint.hidden = med.startDate !== null;

    startInput.addEventListener('change', () => {
      const result = updateMedicationDate(med.id, 'startDate', startInput.value);
      if (!result.ok) {
        dateError.textContent = result.error;
        dateError.hidden = false;
        startInput.value = med.startDate || '';
      }
    });
    endInput.addEventListener('change', () => {
      const result = updateMedicationDate(med.id, 'endDate', endInput.value);
      if (!result.ok) {
        dateError.textContent = result.error;
        dateError.hidden = false;
        endInput.value = med.endDate || '';
      }
    });

    const notesEl = node.querySelector('.med-notes');
    if (med.notes) {
      notesEl.textContent = med.notes;
      notesEl.hidden = false;
    }

    const editNameInput = node.querySelector('.med-edit-name');
    const editDosageInput = node.querySelector('.med-edit-dosage');
    const editFrequencyInput = node.querySelector('.med-edit-frequency');
    const editDoctorInput = node.querySelector('.med-edit-doctor');
    const editNotesInput = node.querySelector('.med-edit-notes');
    const editError = node.querySelector('.med-edit-error');

    node.querySelector('.edit-btn').addEventListener('click', () => {
      // Only one medication (across both the "current" and "former" groups)
      // can be in edit mode at a time.
      ['current', 'former'].forEach((otherGroupKey) => {
        const otherList = document.querySelector(`[data-med-list="${otherGroupKey}"]`);
        const otherOpenForm = otherList.querySelector('.med-edit-form:not([hidden])');
        if (otherOpenForm && otherOpenForm !== editForm) {
          otherOpenForm.hidden = true;
          otherOpenForm.closest('.med-card').querySelector('.med-view').hidden = false;
        }
      });
      editNameInput.value = med.name;
      editDosageInput.value = med.dosage;
      editFrequencyInput.value = med.frequency;
      editDoctorInput.value = med.prescribingDoctor;
      editNotesInput.value = med.notes;
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
      const result = updateMedication(med.id, {
        name: editNameInput.value,
        dosage: editDosageInput.value,
        frequency: editFrequencyInput.value,
        prescribingDoctor: editDoctorInput.value,
        notes: editNotesInput.value,
      });
      if (!result.ok) {
        editError.textContent = result.error;
        editError.hidden = false;
      }
    });

    node.querySelector('.delete-btn').addEventListener('click', () => deleteMedication(med.id));

    if (openEdit && openEdit.id === med.id) {
      editNameInput.value = openEdit.name;
      editDosageInput.value = openEdit.dosage;
      editFrequencyInput.value = openEdit.frequency;
      editDoctorInput.value = openEdit.prescribingDoctor;
      editNotesInput.value = openEdit.notes;
      viewSection.hidden = true;
      editForm.hidden = false;
    }

    list.appendChild(node);
  });
}

function renderMedications() {
  const searchTerm = document.getElementById('medications-search-input').value;
  const visible = medications.filter((m) => !m.deleted).filter((m) => matchesMedicationSearch(m, searchTerm));
  const template = document.getElementById('medications-card-template');
  const comparator = MEDICATION_SORTS[selectedMedicationsSort] || MEDICATION_SORTS.name_asc;

  const current = visible.filter((m) => m.endDate === null).sort(comparator);
  const former = visible.filter((m) => m.endDate !== null).sort(comparator);

  const lists = ['current', 'former'].map((groupKey) => document.querySelector(`[data-med-list="${groupKey}"]`));
  let openEdit = null;
  for (const list of lists) {
    const openForm = list.querySelector('.med-edit-form:not([hidden])');
    if (openForm) {
      openEdit = {
        id: openForm.closest('.med-card').dataset.medId,
        name: openForm.querySelector('.med-edit-name').value,
        dosage: openForm.querySelector('.med-edit-dosage').value,
        frequency: openForm.querySelector('.med-edit-frequency').value,
        prescribingDoctor: openForm.querySelector('.med-edit-doctor').value,
        notes: openForm.querySelector('.med-edit-notes').value,
      };
      break;
    }
  }

  renderMedicationGroup('current', current, template, openEdit);
  renderMedicationGroup('former', former, template, openEdit);

  document.getElementById('medications-empty-state').hidden = medications.filter((m) => !m.deleted).length !== 0;
}

document.getElementById('medications-add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const nameInput = document.getElementById('medications-name-input');
  const dosageInput = document.getElementById('medications-dosage-input');
  const frequencyInput = document.getElementById('medications-frequency-input');
  const doctorInput = document.getElementById('medications-doctor-input');
  const startInput = document.getElementById('medications-start-input');
  const endInput = document.getElementById('medications-end-input');
  const notesInput = document.getElementById('medications-notes-input');
  const errorEl = document.getElementById('medications-form-error');

  const result = addMedication({
    name: nameInput.value,
    dosage: dosageInput.value,
    frequency: frequencyInput.value,
    prescribingDoctor: doctorInput.value,
    startDate: startInput.value,
    endDate: endInput.value,
    notes: notesInput.value,
  });

  if (!result.ok) {
    errorEl.textContent = result.error;
    errorEl.hidden = false;
    return;
  }

  errorEl.hidden = true;
  nameInput.value = '';
  dosageInput.value = '';
  frequencyInput.value = '';
  doctorInput.value = '';
  startInput.value = '';
  endInput.value = '';
  notesInput.value = '';
  nameInput.focus();
});

document.getElementById('medications-search-input').addEventListener('input', renderMedications);

document.getElementById('medications-sort-input').addEventListener('change', (e) => {
  selectedMedicationsSort = e.target.value;
  renderMedications();
});

// ---- Diagnoses ----

const DIAGNOSES_KEY = 'secondMemory.diagnoses.v1';
const DIAGNOSIS_STATUSES = ['active', 'monitoring', 'resolved'];

let diagnoses = migrateSyncFields(loadCollection(DIAGNOSES_KEY), DIAGNOSES_KEY, getDeviceId());

function addDiagnosis(condition, dateDiagnosed, provider, notes) {
  const trimmedCondition = condition.trim();
  if (!trimmedCondition) return;
  const now = new Date().toISOString();
  const diagnosis = {
    id: makeId(),
    condition: trimmedCondition,
    dateDiagnosed: dateDiagnosed || null,
    provider: provider.trim(),
    status: 'active',
    notes: notes.trim(),
    dateAdded: now,
    updatedAt: now,
    deviceId: getDeviceId(),
    deleted: false,
    version: 0,
  };
  diagnoses.push(diagnosis);
  saveCollection(DIAGNOSES_KEY, diagnoses);
  recordUndo('diagnoses', diagnosis.id, null, structuredClone(diagnosis));
  renderDiagnoses();
}

function updateDiagnosisStatus(id, newStatus) {
  const diagnosis = diagnoses.find((d) => d.id === id);
  if (!diagnosis || !DIAGNOSIS_STATUSES.includes(newStatus)) return;
  const before = structuredClone(diagnosis);
  diagnosis.status = newStatus;
  stampSync(diagnosis);
  saveCollection(DIAGNOSES_KEY, diagnoses);
  recordUndo('diagnoses', id, before, structuredClone(diagnosis));
  renderDiagnoses();
}

function deleteDiagnosis(id) {
  const diagnosis = diagnoses.find((d) => d.id === id);
  if (!diagnosis) return;
  const before = structuredClone(diagnosis);
  diagnosis.deleted = true;
  stampSync(diagnosis);
  saveCollection(DIAGNOSES_KEY, diagnoses);
  recordUndo('diagnoses', id, before, structuredClone(diagnosis));
  renderDiagnoses();
}

function restoreDiagnosis(id) {
  const diagnosis = diagnoses.find((d) => d.id === id);
  if (!diagnosis || !diagnosis.deleted) return;
  const before = structuredClone(diagnosis);
  diagnosis.deleted = false;
  stampSync(diagnosis);
  saveCollection(DIAGNOSES_KEY, diagnoses);
  recordUndo('diagnoses', id, before, structuredClone(diagnosis));
  renderDiagnoses();
}

function updateDiagnosis(id, fields) {
  const diagnosis = diagnoses.find((d) => d.id === id);
  if (!diagnosis) return;
  const trimmedCondition = fields.condition.trim();
  if (!trimmedCondition) return;
  const before = structuredClone(diagnosis);
  diagnosis.condition = trimmedCondition;
  diagnosis.dateDiagnosed = fields.dateDiagnosed || null;
  diagnosis.provider = fields.provider.trim();
  diagnosis.notes = fields.notes.trim();
  stampSync(diagnosis);
  saveCollection(DIAGNOSES_KEY, diagnoses);
  recordUndo('diagnoses', id, before, structuredClone(diagnosis));
  renderDiagnoses();
}

function matchesDiagnosisSearch(diagnosis, term) {
  if (!term) return true;
  const haystack = `${diagnosis.condition} ${diagnosis.provider} ${diagnosis.notes}`.toLowerCase();
  return haystack.includes(term.toLowerCase());
}

// 'condition_asc' is the proposed default.
let selectedDiagnosesSort = 'condition_asc';

const DIAGNOSIS_SORTS = {
  condition_asc: compareByField((d) => d.condition, 1),
  date_diagnosed_desc: compareByField((d) => d.dateDiagnosed, -1, { text: false }),
  date_diagnosed_asc: compareByField((d) => d.dateDiagnosed, 1, { text: false }),
};

function renderDiagnoses() {
  const searchTerm = document.getElementById('diagnoses-search-input').value;
  const visible = diagnoses.filter((d) => !d.deleted).filter((d) => matchesDiagnosisSearch(d, searchTerm));
  const template = document.getElementById('diagnoses-card-template');
  const comparator = DIAGNOSIS_SORTS[selectedDiagnosesSort] || DIAGNOSIS_SORTS.condition_asc;

  const lists = DIAGNOSIS_STATUSES.map((status) => document.querySelector(`[data-diagnosis-list="${status}"]`));

  let openEdit = null;
  for (const list of lists) {
    const openForm = list.querySelector('.diagnosis-edit-form:not([hidden])');
    if (openForm) {
      openEdit = {
        id: openForm.closest('.diagnosis-card').dataset.diagnosisId,
        condition: openForm.querySelector('.diagnosis-edit-condition').value,
        dateDiagnosed: openForm.querySelector('.diagnosis-edit-date').value,
        provider: openForm.querySelector('.diagnosis-edit-provider').value,
        notes: openForm.querySelector('.diagnosis-edit-notes').value,
      };
      break;
    }
  }

  DIAGNOSIS_STATUSES.forEach((status, index) => {
    const list = lists[index];
    list.innerHTML = '';
    const items = visible.filter((d) => d.status === status).sort(comparator);
    document.querySelector(`[data-diagnosis-count="${status}"]`).textContent = items.length;

    items.forEach((diagnosis) => {
      const node = template.content.cloneNode(true);
      const card = node.querySelector('.diagnosis-card');
      card.dataset.diagnosisId = diagnosis.id;
      const viewSection = node.querySelector('.diagnosis-view');
      const editForm = node.querySelector('.diagnosis-edit-form');

      node.querySelector('.diagnosis-condition').textContent = diagnosis.condition;
      node.querySelector('.diagnosis-date').textContent = diagnosis.dateDiagnosed || 'Date unknown';

      const providerEl = node.querySelector('.diagnosis-provider');
      if (diagnosis.provider) {
        providerEl.textContent = diagnosis.provider;
        providerEl.hidden = false;
      }

      const notesEl = node.querySelector('.diagnosis-notes');
      if (diagnosis.notes) {
        notesEl.textContent = diagnosis.notes;
        notesEl.hidden = false;
      }

      const moveSelect = node.querySelector('.move-select');
      moveSelect.value = diagnosis.status;
      moveSelect.addEventListener('change', (e) => updateDiagnosisStatus(diagnosis.id, e.target.value));

      const editConditionInput = node.querySelector('.diagnosis-edit-condition');
      const editDateInput = node.querySelector('.diagnosis-edit-date');
      const editProviderInput = node.querySelector('.diagnosis-edit-provider');
      const editNotesInput = node.querySelector('.diagnosis-edit-notes');

      node.querySelector('.edit-btn').addEventListener('click', () => {
        lists.forEach((otherList) => {
          const otherOpenForm = otherList.querySelector('.diagnosis-edit-form:not([hidden])');
          if (otherOpenForm && otherOpenForm !== editForm) {
            otherOpenForm.hidden = true;
            otherOpenForm.closest('.diagnosis-card').querySelector('.diagnosis-view').hidden = false;
          }
        });
        editConditionInput.value = diagnosis.condition;
        editDateInput.value = diagnosis.dateDiagnosed || '';
        editProviderInput.value = diagnosis.provider;
        editNotesInput.value = diagnosis.notes;
        viewSection.hidden = true;
        editForm.hidden = false;
      });

      node.querySelector('.cancel-btn').addEventListener('click', () => {
        editForm.hidden = true;
        viewSection.hidden = false;
      });

      editForm.addEventListener('submit', (e) => {
        e.preventDefault();
        updateDiagnosis(diagnosis.id, {
          condition: editConditionInput.value,
          dateDiagnosed: editDateInput.value,
          provider: editProviderInput.value,
          notes: editNotesInput.value,
        });
      });

      node.querySelector('.delete-btn').addEventListener('click', () => deleteDiagnosis(diagnosis.id));

      if (openEdit && openEdit.id === diagnosis.id) {
        editConditionInput.value = openEdit.condition;
        editDateInput.value = openEdit.dateDiagnosed;
        editProviderInput.value = openEdit.provider;
        editNotesInput.value = openEdit.notes;
        viewSection.hidden = true;
        editForm.hidden = false;
      }

      list.appendChild(node);
    });
  });

  document.getElementById('diagnoses-empty-state').hidden = diagnoses.filter((d) => !d.deleted).length !== 0;
}

document.getElementById('diagnoses-add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const conditionInput = document.getElementById('diagnoses-condition-input');
  const dateInput = document.getElementById('diagnoses-date-input');
  const providerInput = document.getElementById('diagnoses-provider-input');
  const notesInput = document.getElementById('diagnoses-notes-input');
  addDiagnosis(conditionInput.value, dateInput.value, providerInput.value, notesInput.value);
  conditionInput.value = '';
  dateInput.value = '';
  providerInput.value = '';
  notesInput.value = '';
  conditionInput.focus();
});

document.getElementById('diagnoses-search-input').addEventListener('input', renderDiagnoses);

document.getElementById('diagnoses-sort-input').addEventListener('change', (e) => {
  selectedDiagnosesSort = e.target.value;
  renderDiagnoses();
});

// ---- To-Do ----

const TODOS_KEY = 'secondMemory.todos.v1';

let todos = migrateSyncFields(loadCollection(TODOS_KEY), TODOS_KEY, getDeviceId());

function addTodo(task, dueDate) {
  const trimmedTask = task.trim();
  if (!trimmedTask) return;
  const now = new Date().toISOString();
  const todo = {
    id: makeId(),
    task: trimmedTask,
    completed: false,
    dueDate: dueDate || null,
    dateAdded: now,
    updatedAt: now,
    deviceId: getDeviceId(),
    deleted: false,
    version: 0,
  };
  todos.push(todo);
  saveCollection(TODOS_KEY, todos);
  recordUndo('todos', todo.id, null, structuredClone(todo));
  renderTodos();
}

function toggleTodoCompleted(id, completed) {
  const todo = todos.find((t) => t.id === id);
  if (!todo) return;
  const before = structuredClone(todo);
  todo.completed = completed;
  stampSync(todo);
  saveCollection(TODOS_KEY, todos);
  recordUndo('todos', id, before, structuredClone(todo));
  renderTodos();
}

function deleteTodo(id) {
  const todo = todos.find((t) => t.id === id);
  if (!todo) return;
  const before = structuredClone(todo);
  todo.deleted = true;
  stampSync(todo);
  saveCollection(TODOS_KEY, todos);
  recordUndo('todos', id, before, structuredClone(todo));
  renderTodos();
}

function restoreTodo(id) {
  const todo = todos.find((t) => t.id === id);
  if (!todo || !todo.deleted) return;
  const before = structuredClone(todo);
  todo.deleted = false;
  stampSync(todo);
  saveCollection(TODOS_KEY, todos);
  recordUndo('todos', id, before, structuredClone(todo));
  renderTodos();
}

function updateTodo(id, fields) {
  const todo = todos.find((t) => t.id === id);
  if (!todo) return;
  const trimmedTask = fields.task.trim();
  if (!trimmedTask) return;
  const before = structuredClone(todo);
  todo.task = trimmedTask;
  todo.dueDate = fields.dueDate || null;
  stampSync(todo);
  saveCollection(TODOS_KEY, todos);
  recordUndo('todos', id, before, structuredClone(todo));
  renderTodos();
}

function matchesTodoSearch(todo, term) {
  if (!term) return true;
  return todo.task.toLowerCase().includes(term.toLowerCase());
}

function isTodoOverdue(todo) {
  if (todo.completed || !todo.dueDate) return false;
  const today = new Date().toISOString().slice(0, 10);
  return todo.dueDate < today;
}

// 'all' is the default/initial state. Fixed 3-option set (not derived from
// data, unlike the category-style chip filters) since `completed` is boolean.
let selectedTodoFilter = 'all';

function matchesTodoFilter(todo, filterKey) {
  if (filterKey === 'active') return !todo.completed;
  if (filterKey === 'completed') return todo.completed;
  return true;
}

function renderTodoCompletedFilters() {
  const container = document.getElementById('todo-completed-filters');
  const options = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'completed', label: 'Completed' },
  ];
  renderChipFilter(
    container,
    options,
    () => selectedTodoFilter,
    (key) => { selectedTodoFilter = key; },
    renderTodos
  );
}

// 'due_date_asc' is the proposed default — it has the side effect of
// surfacing overdue to-dos (dueDate < today) at the top, for free.
let selectedTodoSort = 'due_date_asc';

const TODO_SORTS = {
  due_date_asc: compareByField((t) => t.dueDate, 1, { text: false }),
  due_date_desc: compareByField((t) => t.dueDate, -1, { text: false }),
  date_added_desc: compareByField((t) => t.dateAdded, -1, { text: false }),
  date_added_asc: compareByField((t) => t.dateAdded, 1, { text: false }),
};

function renderTodos() {
  const searchTerm = document.getElementById('todo-search-input').value;
  renderTodoCompletedFilters();
  const comparator = TODO_SORTS[selectedTodoSort] || TODO_SORTS.due_date_asc;
  const visible = todos
    .filter((t) => !t.deleted)
    .filter((t) => matchesTodoSearch(t, searchTerm))
    .filter((t) => matchesTodoFilter(t, selectedTodoFilter))
    .sort(comparator);
  const list = document.getElementById('todo-list');
  const template = document.getElementById('todo-card-template');

  const openForm = list.querySelector('.todo-edit-form:not([hidden])');
  const openEdit = openForm
    ? {
        id: openForm.closest('.todo-item').dataset.todoId,
        task: openForm.querySelector('.todo-edit-task').value,
        dueDate: openForm.querySelector('.todo-edit-due').value,
      }
    : null;

  list.innerHTML = '';

  visible.forEach((todo) => {
    const node = template.content.cloneNode(true);
    const li = node.querySelector('.todo-item');
    li.dataset.todoId = todo.id;
    li.classList.toggle('completed', todo.completed);
    const viewSection = node.querySelector('.todo-view');
    const editForm = node.querySelector('.todo-edit-form');

    const checkbox = node.querySelector('.todo-completed-checkbox');
    checkbox.checked = todo.completed;
    checkbox.addEventListener('change', (e) => toggleTodoCompleted(todo.id, e.target.checked));

    node.querySelector('.todo-task').textContent = todo.task;

    const dueEl = node.querySelector('.todo-due');
    if (todo.dueDate) {
      dueEl.textContent = todo.dueDate;
      dueEl.hidden = false;
      dueEl.classList.toggle('overdue', isTodoOverdue(todo));
    }

    const editTaskInput = node.querySelector('.todo-edit-task');
    const editDueInput = node.querySelector('.todo-edit-due');

    node.querySelector('.edit-btn').addEventListener('click', () => {
      const otherOpenForm = list.querySelector('.todo-edit-form:not([hidden])');
      if (otherOpenForm && otherOpenForm !== editForm) {
        otherOpenForm.hidden = true;
        otherOpenForm.closest('.todo-item').querySelector('.todo-view').hidden = false;
      }
      editTaskInput.value = todo.task;
      editDueInput.value = todo.dueDate || '';
      viewSection.hidden = true;
      editForm.hidden = false;
    });

    node.querySelector('.cancel-btn').addEventListener('click', () => {
      editForm.hidden = true;
      viewSection.hidden = false;
    });

    editForm.addEventListener('submit', (e) => {
      e.preventDefault();
      updateTodo(todo.id, { task: editTaskInput.value, dueDate: editDueInput.value });
    });

    node.querySelector('.delete-btn').addEventListener('click', () => deleteTodo(todo.id));

    if (openEdit && openEdit.id === todo.id) {
      editTaskInput.value = openEdit.task;
      editDueInput.value = openEdit.dueDate;
      viewSection.hidden = true;
      editForm.hidden = false;
    }

    list.appendChild(node);
  });

  document.getElementById('todo-empty-state').hidden = todos.filter((t) => !t.deleted).length !== 0;

  renderHome(); // Home aggregates books/todos/bills — keep this in sync
}

document.getElementById('todo-add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const taskInput = document.getElementById('todo-task-input');
  const dueInput = document.getElementById('todo-due-input');
  addTodo(taskInput.value, dueInput.value);
  taskInput.value = '';
  dueInput.value = '';
  taskInput.focus();
});

document.getElementById('todo-search-input').addEventListener('input', renderTodos);

document.getElementById('todo-sort-input').addEventListener('change', (e) => {
  selectedTodoSort = e.target.value;
  renderTodos();
});

// ---- Shopping List ----

const SHOPPING_KEY = 'secondMemory.shoppingList.v1';

let shoppingItems = migrateSyncFields(loadCollection(SHOPPING_KEY), SHOPPING_KEY, getDeviceId());

function addShoppingItem(item, quantity, category) {
  const trimmedItem = item.trim();
  if (!trimmedItem) return;
  const now = new Date().toISOString();
  const shoppingItem = {
    id: makeId(),
    item: trimmedItem,
    quantity: quantity.trim(),
    checked: false,
    category: category.trim(),
    dateAdded: now,
    updatedAt: now,
    deviceId: getDeviceId(),
    deleted: false,
    version: 0,
  };
  shoppingItems.push(shoppingItem);
  saveCollection(SHOPPING_KEY, shoppingItems);
  recordUndo('shoppingList', shoppingItem.id, null, structuredClone(shoppingItem));
  renderShoppingList();
}

function toggleShoppingChecked(id, checked) {
  const item = shoppingItems.find((i) => i.id === id);
  if (!item) return;
  const before = structuredClone(item);
  item.checked = checked;
  stampSync(item);
  saveCollection(SHOPPING_KEY, shoppingItems);
  recordUndo('shoppingList', id, before, structuredClone(item));
  renderShoppingList();
}

function deleteShoppingItem(id) {
  const item = shoppingItems.find((i) => i.id === id);
  if (!item) return;
  const before = structuredClone(item);
  item.deleted = true;
  stampSync(item);
  saveCollection(SHOPPING_KEY, shoppingItems);
  recordUndo('shoppingList', id, before, structuredClone(item));
  renderShoppingList();
}

function restoreShoppingItem(id) {
  const item = shoppingItems.find((i) => i.id === id);
  if (!item || !item.deleted) return;
  const before = structuredClone(item);
  item.deleted = false;
  stampSync(item);
  saveCollection(SHOPPING_KEY, shoppingItems);
  recordUndo('shoppingList', id, before, structuredClone(item));
  renderShoppingList();
}

function updateShoppingItem(id, fields) {
  const item = shoppingItems.find((i) => i.id === id);
  if (!item) return;
  const trimmedItem = fields.item.trim();
  if (!trimmedItem) return;
  const before = structuredClone(item);
  item.item = trimmedItem;
  item.quantity = fields.quantity.trim();
  item.category = fields.category.trim();
  stampSync(item);
  saveCollection(SHOPPING_KEY, shoppingItems);
  recordUndo('shoppingList', id, before, structuredClone(item));
  renderShoppingList();
}

function matchesShoppingSearch(item, term) {
  if (!term) return true;
  const haystack = `${item.item} ${item.category} ${item.quantity}`.toLowerCase();
  return haystack.includes(term.toLowerCase());
}

// 'all' is the default/initial state for both new filters below.
let selectedShoppingCategory = 'all';
let selectedShoppingChecked = 'all';

function matchesShoppingCategory(item, categoryKey) {
  return categoryKey === 'all' || normalizeChipKey(item.category) === categoryKey;
}

function matchesShoppingChecked(item, checkedKey) {
  if (checkedKey === 'active') return !item.checked;
  if (checkedKey === 'checked') return item.checked;
  return true;
}

function renderShoppingCategoryFilters(nonDeletedItems) {
  const container = document.getElementById('shopping-category-filters');
  const options = [{ key: 'all', label: 'All' }, ...deriveChipOptions(nonDeletedItems, (i) => i.category)];
  renderChipFilter(
    container,
    options,
    () => selectedShoppingCategory,
    (key) => { selectedShoppingCategory = key; },
    renderShoppingList
  );
}

function renderShoppingCheckedFilters() {
  const container = document.getElementById('shopping-checked-filters');
  const options = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'checked', label: 'Checked' },
  ];
  renderChipFilter(
    container,
    options,
    () => selectedShoppingChecked,
    (key) => { selectedShoppingChecked = key; },
    renderShoppingList
  );
}

// 'date_added_asc' is the default — a no-op relative to the previously
// unsorted (≈ insertion-order) rendering, same reasoning as Recipes.
let selectedShoppingSort = 'date_added_asc';

const SHOPPING_SORTS = {
  date_added_asc: compareByField((i) => i.dateAdded, 1, { text: false }),
  date_added_desc: compareByField((i) => i.dateAdded, -1, { text: false }),
  item_asc: compareByField((i) => i.item, 1),
};

function renderShoppingList() {
  const searchTerm = document.getElementById('shopping-search-input').value;
  const nonDeleted = shoppingItems.filter((i) => !i.deleted);
  renderShoppingCategoryFilters(nonDeleted);
  renderShoppingCheckedFilters();
  const comparator = SHOPPING_SORTS[selectedShoppingSort] || SHOPPING_SORTS.date_added_asc;
  const visible = nonDeleted
    .filter((i) => matchesShoppingSearch(i, searchTerm))
    .filter((i) => matchesShoppingCategory(i, selectedShoppingCategory))
    .filter((i) => matchesShoppingChecked(i, selectedShoppingChecked))
    .sort(comparator);
  const list = document.getElementById('shopping-list');
  const template = document.getElementById('shopping-card-template');

  const openForm = list.querySelector('.shopping-edit-form:not([hidden])');
  const openEdit = openForm
    ? {
        id: openForm.closest('.shopping-item').dataset.shoppingId,
        item: openForm.querySelector('.shopping-edit-item').value,
        quantity: openForm.querySelector('.shopping-edit-quantity').value,
        category: openForm.querySelector('.shopping-edit-category').value,
      }
    : null;

  list.innerHTML = '';

  visible.forEach((item) => {
    const node = template.content.cloneNode(true);
    const li = node.querySelector('.shopping-item');
    li.dataset.shoppingId = item.id;
    li.classList.toggle('completed', item.checked);
    const viewSection = node.querySelector('.shopping-view');
    const editForm = node.querySelector('.shopping-edit-form');

    const checkbox = node.querySelector('.shopping-checked-checkbox');
    checkbox.checked = item.checked;
    checkbox.addEventListener('change', (e) => toggleShoppingChecked(item.id, e.target.checked));

    node.querySelector('.shopping-item-name').textContent = item.item;

    const quantityEl = node.querySelector('.shopping-quantity');
    if (item.quantity) {
      quantityEl.textContent = item.quantity;
      quantityEl.hidden = false;
    }

    const categoryEl = node.querySelector('.shopping-category');
    if (item.category) {
      categoryEl.textContent = item.category;
      categoryEl.hidden = false;
    }

    const editItemInput = node.querySelector('.shopping-edit-item');
    const editQuantityInput = node.querySelector('.shopping-edit-quantity');
    const editCategoryInput = node.querySelector('.shopping-edit-category');

    node.querySelector('.edit-btn').addEventListener('click', () => {
      const otherOpenForm = list.querySelector('.shopping-edit-form:not([hidden])');
      if (otherOpenForm && otherOpenForm !== editForm) {
        otherOpenForm.hidden = true;
        otherOpenForm.closest('.shopping-item').querySelector('.shopping-view').hidden = false;
      }
      editItemInput.value = item.item;
      editQuantityInput.value = item.quantity;
      editCategoryInput.value = item.category;
      viewSection.hidden = true;
      editForm.hidden = false;
    });

    node.querySelector('.cancel-btn').addEventListener('click', () => {
      editForm.hidden = true;
      viewSection.hidden = false;
    });

    editForm.addEventListener('submit', (e) => {
      e.preventDefault();
      updateShoppingItem(item.id, {
        item: editItemInput.value,
        quantity: editQuantityInput.value,
        category: editCategoryInput.value,
      });
    });

    node.querySelector('.delete-btn').addEventListener('click', () => deleteShoppingItem(item.id));

    if (openEdit && openEdit.id === item.id) {
      editItemInput.value = openEdit.item;
      editQuantityInput.value = openEdit.quantity;
      editCategoryInput.value = openEdit.category;
      viewSection.hidden = true;
      editForm.hidden = false;
    }

    list.appendChild(node);
  });

  document.getElementById('shopping-empty-state').hidden = shoppingItems.filter((i) => !i.deleted).length !== 0;
}

document.getElementById('shopping-add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const itemInput = document.getElementById('shopping-item-input');
  const quantityInput = document.getElementById('shopping-quantity-input');
  const categoryInput = document.getElementById('shopping-category-input');
  addShoppingItem(itemInput.value, quantityInput.value, categoryInput.value);
  itemInput.value = '';
  quantityInput.value = '';
  categoryInput.value = '';
  itemInput.focus();
});

document.getElementById('shopping-search-input').addEventListener('input', renderShoppingList);

document.getElementById('shopping-sort-input').addEventListener('change', (e) => {
  selectedShoppingSort = e.target.value;
  renderShoppingList();
});

// ---- Notes ----

const NOTES_KEY = 'secondMemory.notes.v1';

let notes = migrateSyncFields(loadCollection(NOTES_KEY), NOTES_KEY, getDeviceId());

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

function matchesNoteSearch(note, term) {
  if (!term) return true;
  const haystack = `${note.title} ${note.body}`.toLowerCase();
  return haystack.includes(term.toLowerCase());
}

function noteBodySnippet(body, length = 150) {
  const trimmed = body.trim();
  return trimmed.length > length ? `${trimmed.slice(0, length)}…` : trimmed;
}

// 'date_modified_desc' is the proposed default — Notes already surfaces
// dateModified prominently in the UI ("Updated {date}"), so recency-of-edit
// is the natural default.
let selectedNotesSort = 'date_modified_desc';

const NOTE_SORTS = {
  date_modified_desc: compareByField((n) => n.dateModified, -1, { text: false }),
  date_modified_asc: compareByField((n) => n.dateModified, 1, { text: false }),
  date_added_desc: compareByField((n) => n.dateAdded, -1, { text: false }),
  date_added_asc: compareByField((n) => n.dateAdded, 1, { text: false }),
  title_asc: compareByField((n) => n.title, 1),
};

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

    node.querySelector('.note-modified').textContent = `Updated ${new Date(note.dateModified).toLocaleString()}`;

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
      editTitleInput.value = note.title;
      editBodyInput.value = note.body;
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
      const result = updateNote(note.id, editTitleInput.value, editBodyInput.value);
      if (!result.ok) {
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
const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

let links = migrateSyncFields(loadCollection(LINKS_KEY), LINKS_KEY, getDeviceId());

function addLink(label, url, notes) {
  const trimmedLabel = label.trim();
  const trimmedUrl = url.trim();
  if (!trimmedLabel) return { ok: false, error: 'Label is required.' };
  if (!trimmedUrl) return { ok: false, error: 'URL is required.' };
  const now = new Date().toISOString();
  const link = {
    id: makeId(),
    label: trimmedLabel,
    url: trimmedUrl,
    notes: notes.trim(),
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

function matchesLinkSearch(link, term) {
  if (!term) return true;
  const haystack = `${link.label} ${link.url} ${link.notes}`.toLowerCase();
  return haystack.includes(term.toLowerCase());
}

function hrefFor(url) {
  return URL_SCHEME_RE.test(url) ? url : `https://${url}`;
}

// 'date_added_asc' is the default, matching current unsorted behavior.
let selectedLinksSort = 'date_added_asc';

const LINK_SORTS = {
  date_added_asc: compareByField((l) => l.dateAdded, 1, { text: false }),
  date_added_desc: compareByField((l) => l.dateAdded, -1, { text: false }),
  label_asc: compareByField((l) => l.label, 1),
};

function renderLinks() {
  const searchTerm = document.getElementById('resume-search-input').value;
  const comparator = LINK_SORTS[selectedLinksSort] || LINK_SORTS.date_added_asc;
  const visible = links
    .filter((l) => !l.deleted)
    .filter((l) => matchesLinkSearch(l, searchTerm))
    .sort(comparator);
  const list = document.getElementById('resume-list');
  const template = document.getElementById('resume-card-template');

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
      editLabelInput.value = link.label;
      editUrlInput.value = link.url;
      editNotesInput.value = link.notes;
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
      const result = updateLink(link.id, {
        label: editLabelInput.value,
        url: editUrlInput.value,
        notes: editNotesInput.value,
      });
      if (!result.ok) {
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

// ---- Degree & Coursework ----

const COURSES_KEY = 'secondMemory.courses.v1';
const COURSE_STATUSES = ['completed', 'in_progress', 'planned'];

let courses = migrateSyncFields(loadCollection(COURSES_KEY), COURSES_KEY, getDeviceId());

function parseCredits(value) {
  if (value === '' || value === null || value === undefined) return { ok: true, credits: null };
  const num = Number(value);
  if (Number.isNaN(num)) return { ok: false, error: 'Credits must be a number.' };
  if (num < 0) return { ok: false, error: 'Credits cannot be negative.' };
  return { ok: true, credits: num };
}

function addCourse(fields) {
  const trimmedTitle = fields.title.trim();
  if (!trimmedTitle) return { ok: false, error: 'Title is required.' };
  const creditsResult = parseCredits(fields.credits);
  if (!creditsResult.ok) return { ok: false, error: creditsResult.error };
  const status = COURSE_STATUSES.includes(fields.status) ? fields.status : 'planned';
  const now = new Date().toISOString();
  const course = {
    id: makeId(),
    title: trimmedTitle,
    code: fields.code.trim(),
    credits: creditsResult.credits,
    term: fields.term.trim(),
    status,
    grade: null,
    notes: fields.notes.trim(),
    dateAdded: now,
    updatedAt: now,
    deviceId: getDeviceId(),
    deleted: false,
    version: 0,
  };
  courses.push(course);
  saveCollection(COURSES_KEY, courses);
  recordUndo('courses', course.id, null, structuredClone(course));
  renderCourses();
  return { ok: true };
}

function updateCourseStatus(id, newStatus) {
  const course = courses.find((c) => c.id === id);
  if (!course || !COURSE_STATUSES.includes(newStatus)) return;
  const before = structuredClone(course);
  course.status = newStatus;
  if (newStatus !== 'completed') course.grade = null;
  stampSync(course);
  saveCollection(COURSES_KEY, courses);
  recordUndo('courses', id, before, structuredClone(course));
  renderCourses();
}

function updateCourseGrade(id, grade) {
  const course = courses.find((c) => c.id === id);
  if (!course) return;
  const before = structuredClone(course);
  const trimmedGrade = grade.trim();
  course.grade = trimmedGrade ? trimmedGrade : null;
  stampSync(course);
  saveCollection(COURSES_KEY, courses);
  recordUndo('courses', id, before, structuredClone(course));
}

function deleteCourse(id) {
  const course = courses.find((c) => c.id === id);
  if (!course) return;
  const before = structuredClone(course);
  course.deleted = true;
  stampSync(course);
  saveCollection(COURSES_KEY, courses);
  recordUndo('courses', id, before, structuredClone(course));
  renderCourses();
}

function restoreCourse(id) {
  const course = courses.find((c) => c.id === id);
  if (!course || !course.deleted) return;
  const before = structuredClone(course);
  course.deleted = false;
  stampSync(course);
  saveCollection(COURSES_KEY, courses);
  recordUndo('courses', id, before, structuredClone(course));
  renderCourses();
}

function updateCourse(id, fields) {
  const course = courses.find((c) => c.id === id);
  if (!course) return { ok: false, error: 'Course not found.' };
  const trimmedTitle = fields.title.trim();
  if (!trimmedTitle) return { ok: false, error: 'Title is required.' };
  const creditsResult = parseCredits(fields.credits);
  if (!creditsResult.ok) return { ok: false, error: creditsResult.error };
  const before = structuredClone(course);
  course.title = trimmedTitle;
  course.code = fields.code.trim();
  course.credits = creditsResult.credits;
  course.term = fields.term.trim();
  course.notes = fields.notes.trim();
  stampSync(course);
  saveCollection(COURSES_KEY, courses);
  recordUndo('courses', id, before, structuredClone(course));
  renderCourses();
  return { ok: true };
}

function matchesCourseSearch(course, term) {
  if (!term) return true;
  const haystack = [course.title, course.code, course.term, course.grade, course.notes]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(term.toLowerCase());
}

const COURSE_STATUS_LABELS = { completed: 'completed', in_progress: 'in progress', planned: 'planned' };

// 'all' is the default/initial state.
let selectedCourseTerm = 'all';

function matchesCourseTerm(course, termKey) {
  return termKey === 'all' || normalizeChipKey(course.term) === termKey;
}

function renderCourseTermFilters(nonDeletedCourses) {
  const container = document.getElementById('coursework-term-filters');
  const options = [{ key: 'all', label: 'All' }, ...deriveChipOptions(nonDeletedCourses, (c) => c.term)];
  renderChipFilter(
    container,
    options,
    () => selectedCourseTerm,
    (key) => { selectedCourseTerm = key; },
    renderCourses
  );
}

// 'title_asc' is the proposed default. No Term sort option is offered —
// `term` is free text (e.g. "Fall 2026") with no structured year/season
// split, so a plain localeCompare sort would be alphabetical, not
// chronological ("Fall 2025"/"Fall 2026" would both sort before every
// "Spring" term). Deliberate omission, not an oversight.
let selectedCoursesSort = 'title_asc';

const COURSE_SORTS = {
  title_asc: compareByField((c) => c.title, 1),
  code_asc: compareByField((c) => c.code, 1),
  credits_desc: compareByField((c) => c.credits, -1, { text: false }),
  credits_asc: compareByField((c) => c.credits, 1, { text: false }),
  date_added_desc: compareByField((c) => c.dateAdded, -1, { text: false }),
  date_added_asc: compareByField((c) => c.dateAdded, 1, { text: false }),
};

function renderCoursesStats(nonDeletedCourses) {
  const el = document.getElementById('coursework-stats');
  if (!el) return;

  const parts = COURSE_STATUSES.map((status) => {
    const withCredits = nonDeletedCourses
      .filter((c) => c.status === status)
      .filter((c) => c.credits !== null && c.credits !== undefined);
    if (withCredits.length === 0) return null;
    const sum = withCredits.reduce((total, c) => total + c.credits, 0);
    return `${sum} credit${sum === 1 ? '' : 's'} ${COURSE_STATUS_LABELS[status]}`;
  }).filter(Boolean);

  el.textContent = parts.length ? parts.join(' · ') : 'No credits recorded yet.';
}

function renderCourses() {
  const searchTerm = document.getElementById('coursework-search-input').value;
  const nonDeleted = courses.filter((c) => !c.deleted);
  const template = document.getElementById('coursework-card-template');

  renderCoursesStats(nonDeleted);
  renderCourseTermFilters(nonDeleted);

  const comparator = COURSE_SORTS[selectedCoursesSort] || COURSE_SORTS.title_asc;
  const visible = nonDeleted
    .filter((c) => matchesCourseSearch(c, searchTerm))
    .filter((c) => matchesCourseTerm(c, selectedCourseTerm));

  const lists = COURSE_STATUSES.map((status) => document.querySelector(`[data-course-list="${status}"]`));

  let openEdit = null;
  for (const list of lists) {
    const openForm = list.querySelector('.course-edit-form:not([hidden])');
    if (openForm) {
      openEdit = {
        id: openForm.closest('.course-card').dataset.courseId,
        title: openForm.querySelector('.course-edit-title').value,
        code: openForm.querySelector('.course-edit-code').value,
        credits: openForm.querySelector('.course-edit-credits').value,
        term: openForm.querySelector('.course-edit-term').value,
        notes: openForm.querySelector('.course-edit-notes').value,
      };
      break;
    }
  }

  COURSE_STATUSES.forEach((status, index) => {
    const list = lists[index];
    list.innerHTML = '';
    const items = visible.filter((c) => c.status === status).sort(comparator);
    document.querySelector(`[data-course-count="${status}"]`).textContent = items.length;

    items.forEach((course) => {
      const node = template.content.cloneNode(true);
      const card = node.querySelector('.course-card');
      card.dataset.courseId = course.id;
      const viewSection = node.querySelector('.course-view');
      const editForm = node.querySelector('.course-edit-form');

      node.querySelector('.course-title').textContent = course.title;

      const codeEl = node.querySelector('.course-code');
      if (course.code) {
        codeEl.textContent = course.code;
        codeEl.hidden = false;
      }

      const setField = (fieldClass, wrapperClass, value) => {
        const wrapper = node.querySelector(`.${wrapperClass}`);
        if (value !== '' && value !== null && value !== undefined) {
          node.querySelector(`.${fieldClass}`).textContent = value;
          wrapper.hidden = false;
        }
      };
      setField('course-term', 'course-term-field', course.term);
      setField('course-credits', 'course-credits-field', course.credits === null ? '' : String(course.credits));

      const gradeLabel = node.querySelector('.grade-label');
      const gradeInput = node.querySelector('.grade-input');
      if (status === 'completed') {
        gradeLabel.hidden = false;
        gradeInput.value = course.grade || '';
        gradeInput.addEventListener('change', (e) => updateCourseGrade(course.id, e.target.value));
      }

      const notesEl = node.querySelector('.course-notes');
      if (course.notes) {
        notesEl.textContent = course.notes;
        notesEl.hidden = false;
      }

      const moveSelect = node.querySelector('.move-select');
      moveSelect.value = course.status;
      moveSelect.addEventListener('change', (e) => updateCourseStatus(course.id, e.target.value));

      const editTitleInput = node.querySelector('.course-edit-title');
      const editCodeInput = node.querySelector('.course-edit-code');
      const editCreditsInput = node.querySelector('.course-edit-credits');
      const editTermInput = node.querySelector('.course-edit-term');
      const editNotesInput = node.querySelector('.course-edit-notes');
      const editError = node.querySelector('.course-edit-error');

      node.querySelector('.edit-btn').addEventListener('click', () => {
        lists.forEach((otherList) => {
          const otherOpenForm = otherList.querySelector('.course-edit-form:not([hidden])');
          if (otherOpenForm && otherOpenForm !== editForm) {
            otherOpenForm.hidden = true;
            otherOpenForm.closest('.course-card').querySelector('.course-view').hidden = false;
          }
        });
        editTitleInput.value = course.title;
        editCodeInput.value = course.code;
        editCreditsInput.value = course.credits === null ? '' : String(course.credits);
        editTermInput.value = course.term;
        editNotesInput.value = course.notes;
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
        const result = updateCourse(course.id, {
          title: editTitleInput.value,
          code: editCodeInput.value,
          credits: editCreditsInput.value,
          term: editTermInput.value,
          notes: editNotesInput.value,
        });
        if (!result.ok) {
          editError.textContent = result.error;
          editError.hidden = false;
        }
      });

      node.querySelector('.delete-btn').addEventListener('click', () => deleteCourse(course.id));

      if (openEdit && openEdit.id === course.id) {
        editTitleInput.value = openEdit.title;
        editCodeInput.value = openEdit.code;
        editCreditsInput.value = openEdit.credits;
        editTermInput.value = openEdit.term;
        editNotesInput.value = openEdit.notes;
        viewSection.hidden = true;
        editForm.hidden = false;
      }

      list.appendChild(node);
    });
  });

  document.getElementById('coursework-empty-state').hidden = nonDeleted.length !== 0;
}

document.getElementById('coursework-add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const titleInput = document.getElementById('coursework-title-input');
  const codeInput = document.getElementById('coursework-code-input');
  const creditsInput = document.getElementById('coursework-credits-input');
  const termInput = document.getElementById('coursework-term-input');
  const statusInput = document.getElementById('coursework-status-input');
  const notesInput = document.getElementById('coursework-notes-input');
  const errorEl = document.getElementById('coursework-form-error');

  const result = addCourse({
    title: titleInput.value,
    code: codeInput.value,
    credits: creditsInput.value,
    term: termInput.value,
    status: statusInput.value,
    notes: notesInput.value,
  });

  if (!result.ok) {
    errorEl.textContent = result.error;
    errorEl.hidden = false;
    return;
  }

  errorEl.hidden = true;
  titleInput.value = '';
  codeInput.value = '';
  creditsInput.value = '';
  termInput.value = '';
  statusInput.value = 'planned';
  notesInput.value = '';
  titleInput.focus();
});

document.getElementById('coursework-search-input').addEventListener('input', renderCourses);

document.getElementById('coursework-sort-input').addEventListener('change', (e) => {
  selectedCoursesSort = e.target.value;
  renderCourses();
});

// ---- Budget (Bills + rolling 5-week calendar) ----
// Storage key: secondMemory.bills.v1. See docs/specs/budget-tab.md.

const BILLS_KEY = 'secondMemory.bills.v1';
const BILL_FREQUENCIES = ['one_time', 'weekly', 'biweekly', 'monthly', 'yearly'];
const BILL_FREQUENCY_LABELS = {
  one_time: 'One-time', weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly', yearly: 'Yearly',
};

let bills = migrateSyncFields(loadCollection(BILLS_KEY), BILLS_KEY, getDeviceId());

// ---- Date helpers ----
// All date-key values are local-date-derived 'YYYY-MM-DD' strings — never
// `toISOString()`-derived, which is UTC, not local (the existing
// `isTodoOverdue()`/`todayForFilename()` bug pattern this new code must not
// repeat). Comparisons between two date keys use plain string comparison,
// which is correct for this fixed zero-padded format.

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
  // UTC-anchored per the research brief — never diff local-millisecond
  // timestamps, that's DST-unsafe. Every UTC day is exactly 86,400,000ms.
  return Math.round((Date.UTC(b.y, b.m, b.d) - Date.UTC(a.y, a.m, a.d)) / 86400000);
}

// Local calendar-day arithmetic (safe from the DST pitfall above because it
// increments the day-of-month FIELD, letting Date's constructor normalize
// month/year rollover — the same technique the calendar window math uses).
function shiftDateKey(key, deltaDays) {
  const { y, m, d } = parseDateKey(key);
  return dateKeyFromLocalDate(new Date(y, m, d + deltaDays));
}

// ---- Occurrence generation ----

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

// Closed-form occurrence count through a date, no day-by-day loop — needed
// for the weekly-total carry-forward formula, which must ask "how many
// occurrences has this bill had, on or before this date" for a bill whose
// anchor could be arbitrarily far in the past.
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

function unpaidAmountThrough(bill, throughKey) {
  const totalOccurrences = occurrenceCountThrough(bill, throughKey);
  if (totalOccurrences === 0) return 0;
  const paidCount = (bill.paidDates || [])
    .filter((d) => d <= throughKey && occursOnDate(bill, d))
    .length;
  return Math.max(0, totalOccurrences - paidCount) * bill.amount;
}

// Walks forward from the bill's anchor dueDate to find the single earliest
// occurrence date that is real (per occursOnDate) and not already paid, up
// through and including throughKey. A plain day-by-day walk (not a
// closed-form jump) is deliberately the simplest-correct approach here —
// this only runs on an explicit user click (the "mark oldest unpaid as
// paid" button's handler); render-time code uses the O(1)-ish
// unpaidAmountThrough instead to avoid paying this walk's cost on every render.
function oldestUnpaidOccurrence(bill, throughKey) {
  const paidSet = new Set(bill.paidDates || []);
  let dateKey = bill.dueDate;
  while (dateKey <= throughKey) {
    if (occursOnDate(bill, dateKey) && !paidSet.has(dateKey)) return dateKey;
    dateKey = shiftDateKey(dateKey, 1);
  }
  return null;
}

// ---- Calendar window ----

function getCalendarWindowDays(today = new Date()) {
  const dow = (today.getDay() + 6) % 7; // days since Monday (getDay() is 0 = Sunday)
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
  return days.map(dateKeyFromLocalDate); // 35 date-key strings, Monday-start
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const BUDGET_WEEK_LABELS = ['2 weeks ago', 'Last week', 'This week', 'Next week', '2 weeks from now'];

// Cumulative "total currently owed as of the end of this week" — the same
// unpaid occurrence contributes to every week's total from the week it's due
// through every subsequent week, for as long as it stays unpaid. Deliberate,
// not a bug — see docs/specs/budget-tab.md §4.
function weekTotal(weekEndKey, allBills) {
  return allBills
    .filter((b) => !b.deleted)
    .reduce((sum, b) => sum + unpaidAmountThrough(b, weekEndKey), 0);
}

// ---- Manual per-day number ----
// Local-only, deliberately not a SYNC_COLLECTIONS member: own localStorage
// key, plain flat date-key-to-number map, not synced/exported/undo-tracked.
// See docs/specs/budget-tab.md §1.2/§10.2 (Architect decision #2).

const BUDGET_DAILY_NUMBERS_KEY = 'secondMemory.budgetDailyNumbers.v1';

function loadBudgetDailyNumbers() {
  try {
    const raw = localStorage.getItem(BUDGET_DAILY_NUMBERS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch {
    return {};
  }
}

function saveBudgetDailyNumbers(map) {
  localStorage.setItem(BUDGET_DAILY_NUMBERS_KEY, JSON.stringify(map));
}

let budgetDailyNumbers = loadBudgetDailyNumbers();

// ---- Bill CRUD ----

function validateBillFields(fields) {
  const trimmedName = fields.name.trim();
  if (!trimmedName) return { ok: false, error: 'Bill name is required.' };
  const amount = Number(fields.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'Amount must be a number greater than $0.' };
  }
  const dueDate = fields.dueDate;
  if (!dueDate) return { ok: false, error: 'Due date is required.' };
  const frequency = BILL_FREQUENCIES.includes(fields.frequency) ? fields.frequency : 'monthly';
  return { ok: true, name: trimmedName, amount, dueDate, frequency, category: fields.category.trim() };
}

function addBill(fields) {
  const result = validateBillFields(fields);
  if (!result.ok) return result;
  const now = new Date().toISOString();
  const bill = {
    id: makeId(),
    name: result.name,
    amount: result.amount,
    dueDate: result.dueDate,
    frequency: result.frequency,
    category: result.category,
    paidDates: [],
    dateAdded: now,
    updatedAt: now,
    deviceId: getDeviceId(),
    deleted: false,
    version: 0,
  };
  bills.push(bill);
  saveCollection(BILLS_KEY, bills);
  recordUndo('bills', bill.id, null, structuredClone(bill));
  renderBudget();
  return { ok: true };
}

// Never touches paidDates — only toggleBillPaid (and the "mark oldest unpaid
// as paid" button, which calls the same function) ever mutates it.
function updateBill(id, fields) {
  const bill = bills.find((b) => b.id === id);
  if (!bill) return { ok: false, error: 'Bill not found.' };
  const result = validateBillFields(fields);
  if (!result.ok) return result;
  const before = structuredClone(bill);
  bill.name = result.name;
  bill.amount = result.amount;
  bill.dueDate = result.dueDate;
  bill.frequency = result.frequency;
  bill.category = result.category;
  stampSync(bill);
  saveCollection(BILLS_KEY, bills);
  recordUndo('bills', id, before, structuredClone(bill));
  renderBudget();
  return { ok: true };
}

function deleteBill(id) {
  const bill = bills.find((b) => b.id === id);
  if (!bill) return;
  const before = structuredClone(bill);
  bill.deleted = true;
  stampSync(bill);
  saveCollection(BILLS_KEY, bills);
  recordUndo('bills', id, before, structuredClone(bill));
  renderBudget();
}

function restoreBill(id) {
  const bill = bills.find((b) => b.id === id);
  if (!bill || !bill.deleted) return;
  const before = structuredClone(bill);
  bill.deleted = false;
  stampSync(bill);
  saveCollection(BILLS_KEY, bills);
  recordUndo('bills', id, before, structuredClone(bill));
  renderBudget();
}

// Direct structural match to toggleTodoCompleted/toggleShoppingChecked: find
// record, snapshot before, mutate exactly one field, stampSync,
// saveCollection, recordUndo, re-render. paidDates is never touched anywhere
// else — see updateBill above.
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

function matchesBillSearch(bill, term) {
  if (!term) return true;
  const haystack = `${bill.name} ${bill.category}`.toLowerCase();
  return haystack.includes(term.toLowerCase());
}

// 'all' is the default/initial state, same convention as every other
// chip-filtered collection.
let selectedBillCategory = 'all';

function matchesBillCategory(bill, categoryKey) {
  return categoryKey === 'all' || normalizeChipKey(bill.category) === categoryKey;
}

// Deterministic category -> palette-color mapping for the calendar's
// occurrence dots. Categories are free-text (no fixed enum), so this hashes
// the normalized string (same normalization matchesBillCategory uses, so
// "Rent"/"rent " share a color) into one of exactly 3 palette colors — never
// var(--accent-2), which is reserved app-wide for error/overdue/destructive
// semantics per DECISIONS.md. Blank categories return null (neutral/no dot)
// rather than being hashed in.
const BILL_CATEGORY_PALETTE = ['var(--accent)', 'var(--accent-rose)', 'var(--accent-lavender)'];

function billCategoryColor(category) {
  const key = normalizeChipKey(category);
  if (!key) return null;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash += key.charCodeAt(i);
  return BILL_CATEGORY_PALETTE[hash % BILL_CATEGORY_PALETTE.length];
}

function renderBillCategoryFilters(nonDeletedBills) {
  const container = document.getElementById('budget-category-filters');
  const options = [{ key: 'all', label: 'All' }, ...deriveChipOptions(nonDeletedBills, (b) => b.category)];
  renderChipFilter(
    container,
    options,
    () => selectedBillCategory,
    (key) => { selectedBillCategory = key; },
    renderBudget
  );
}

// 'due_date_asc' is the default/initial state, matching the add-form's sort
// <select>'s first (and pre-selected) option.
let selectedBillsSort = 'due_date_asc';

const BILL_SORTS = {
  due_date_asc: compareByField((b) => b.dueDate, 1, { text: false }),
  due_date_desc: compareByField((b) => b.dueDate, -1, { text: false }),
  name_asc: compareByField((b) => b.name, 1),
  amount_desc: compareByField((b) => b.amount, -1, { text: false }),
  amount_asc: compareByField((b) => b.amount, 1, { text: false }),
};

function renderBudgetStats(nonDeletedBills) {
  const el = document.getElementById('budget-stats');
  if (!el) return;
  const today = todayKey();
  const overallUnpaid = nonDeletedBills.reduce((sum, b) => sum + unpaidAmountThrough(b, today), 0);
  const count = nonDeletedBills.length;
  el.textContent = `$${overallUnpaid.toFixed(2)} unpaid across ${count} bill${count === 1 ? '' : 's'}.`;
}

// Renders the 35-day rolling calendar into #budget-calendar (everything
// after the static .budget-weekday-row) and the month/year header. Always
// runs against the full live `bills` array, and unaffected by the Bills
// list's search filter below — but the category chip filter DOES apply here
// too (occurrence rendering only; every total stays unfiltered, see the
// matchesBillCategory comment inside the render loop below).
function renderBudgetCalendar(nonDeletedBills, focusedManualInput) {
  const today = new Date();
  const todayK = todayKey();
  const dueSoonEndK = shiftDateKey(todayK, 2);
  document.getElementById('budget-month-label').textContent =
    `${MONTH_NAMES[today.getMonth()]} ${today.getFullYear()}`;

  // "This month" total: same cumulative unpaidAmountThrough semantics as the
  // weekly totals below, just anchored at the current calendar month's last
  // day instead of a week-end — deliberately unfiltered by category, same
  // carve-out as weekTotal() (see matchesBillCategory filter further down).
  const monthEndKey = dateKeyFromParts(
    today.getFullYear(), today.getMonth(), daysInMonth(today.getFullYear(), today.getMonth())
  );
  const monthTotal = nonDeletedBills.reduce((sum, b) => sum + unpaidAmountThrough(b, monthEndKey), 0);
  const monthTotalEl = document.getElementById('budget-month-total');
  if (monthTotalEl) {
    monthTotalEl.innerHTML = `${MONTH_NAMES[today.getMonth()]} total: <strong>$${monthTotal.toFixed(2)}</strong>`;
  }

  // 90-day forecast: a third, longer time horizon alongside the week totals
  // (rolling, per-week) and the month total (current calendar month) above —
  // same unpaidAmountThrough cumulative math, just anchored 90 days out
  // instead of at a week/month boundary. Deliberately unfiltered by category,
  // same carve-out as monthTotal/weekTotal (see matchesBillCategory comment
  // further down).
  const forecastEndKey = shiftDateKey(todayK, 90);
  const forecastTotal = nonDeletedBills.reduce((sum, b) => sum + unpaidAmountThrough(b, forecastEndKey), 0);
  const forecastEl = document.getElementById('budget-forecast-total');
  if (forecastEl) {
    const { y: forecastYear, m: forecastMonth, d: forecastDay } = parseDateKey(forecastEndKey);
    forecastEl.innerHTML =
      `By ${MONTH_NAMES[forecastMonth]} ${forecastDay}, ${forecastYear}: ` +
      `<strong>~$${forecastTotal.toFixed(2)}</strong> in recurring bills`;
  }

  const windowDays = getCalendarWindowDays(today);
  const calendarEl = document.getElementById('budget-calendar');
  calendarEl.querySelectorAll('.budget-week').forEach((el) => el.remove());

  for (let weekIndex = 0; weekIndex < 5; weekIndex++) {
    const weekDays = windowDays.slice(weekIndex * 7, weekIndex * 7 + 7);
    const weekEndKey = weekDays[6];

    const weekEl = document.createElement('div');
    weekEl.className = 'budget-week';
    weekEl.dataset.weekIndex = String(weekIndex);
    weekEl.classList.toggle('budget-week-current', weekIndex === 2);

    const cellsEl = document.createElement('div');
    cellsEl.className = 'budget-week-cells';

    weekDays.forEach((dateKey) => {
      const { m, d } = parseDateKey(dateKey);

      const cellEl = document.createElement('div');
      cellEl.className = 'budget-day-cell';
      cellEl.dataset.dateKey = dateKey;
      cellEl.classList.toggle('budget-day-today', dateKey === todayK);

      const headerEl = document.createElement('div');
      headerEl.className = 'budget-day-header';
      const dateSpan = document.createElement('span');
      dateSpan.className = 'budget-day-date';
      dateSpan.textContent = String(d);
      headerEl.appendChild(dateSpan);
      cellEl.appendChild(headerEl);

      const occurrencesEl = document.createElement('ul');
      occurrencesEl.className = 'budget-day-occurrences scroll-block';
      nonDeletedBills
        .filter((bill) => occursOnDate(bill, dateKey))
        // Calendar-only category filter — the same chip selection filters the
        // Bills list below. Deliberately does NOT touch weekTotal()/monthTotal
        // above or renderBudgetStats(), which always sum the full
        // nonDeletedBills array regardless of the selected chip (see §3 of
        // the cycle's spec: totals must never look smaller than the true
        // unpaid amount just because a category filter is active).
        .filter((bill) => matchesBillCategory(bill, selectedBillCategory))
        .forEach((bill) => {
          const itemEl = document.createElement('li');
          itemEl.className = 'budget-occurrence';
          const paid = (bill.paidDates || []).includes(dateKey);
          const overdue = !paid && dateKey < todayK;
          // Mutually exclusive by construction: overdue is strictly before
          // today, due-soon is today-or-later, so a single dateKey can never
          // satisfy both.
          const dueSoon = !paid && dateKey >= todayK && dateKey <= dueSoonEndK;
          itemEl.classList.toggle('overdue', overdue);
          itemEl.classList.toggle('due-soon', dueSoon);

          const label = document.createElement('label');
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.className = 'budget-occurrence-checkbox';
          checkbox.dataset.billId = bill.id;
          checkbox.dataset.dateKey = dateKey;
          checkbox.checked = paid;
          checkbox.addEventListener('change', (e) => toggleBillPaid(bill.id, dateKey, e.target.checked));

          const categoryColor = billCategoryColor(bill.category);
          let dotSpan = null;
          if (categoryColor) {
            dotSpan = document.createElement('span');
            dotSpan.className = 'budget-occurrence-dot';
            dotSpan.style.backgroundColor = categoryColor;
          }

          const nameSpan = document.createElement('span');
          nameSpan.className = 'budget-occurrence-name';
          nameSpan.textContent = bill.name;

          const amountText = `$${bill.amount.toFixed(2)}`;
          label.title = bill.category ? `${bill.name} — ${amountText} (${bill.category})` : `${bill.name} — ${amountText}`;

          label.appendChild(checkbox);
          if (dotSpan) label.appendChild(dotSpan);
          label.appendChild(nameSpan);
          itemEl.appendChild(label);
          occurrencesEl.appendChild(itemEl);
        });
      cellEl.appendChild(occurrencesEl);

      const footerEl = document.createElement('div');
      footerEl.className = 'budget-day-footer';
      const manualInput = document.createElement('input');
      manualInput.type = 'number';
      manualInput.step = 'any';
      manualInput.className = 'budget-day-manual-input';
      manualInput.dataset.dateKey = dateKey;
      manualInput.setAttribute('aria-label', `Note for ${MONTH_NAMES[m]} ${d}`);
      manualInput.value = (dateKey in budgetDailyNumbers) ? String(budgetDailyNumbers[dateKey]) : '';
      manualInput.addEventListener('change', (e) => {
        const value = e.target.value;
        if (value === '') {
          delete budgetDailyNumbers[dateKey];
        } else {
          budgetDailyNumbers[dateKey] = Number(value);
        }
        saveBudgetDailyNumbers(budgetDailyNumbers);
        // Deliberately no renderBudget() call here — nothing else on screen
        // depends on this value, and re-rendering on every change would risk
        // the exact cross-cell focus-loss bug this preservation logic guards
        // against. See docs/specs/budget-tab.md §7.
      });
      footerEl.appendChild(manualInput);
      cellEl.appendChild(footerEl);

      cellsEl.appendChild(cellEl);
    });

    weekEl.appendChild(cellsEl);

    const totalEl = document.createElement('p');
    totalEl.className = 'budget-week-total';
    totalEl.innerHTML = `${BUDGET_WEEK_LABELS[weekIndex]}: <strong>$${weekTotal(weekEndKey, nonDeletedBills).toFixed(2)}</strong>`;
    weekEl.appendChild(totalEl);

    calendarEl.appendChild(weekEl);
  }

  if (focusedManualInput) {
    const restored = calendarEl.querySelector(
      `.budget-day-manual-input[data-date-key="${focusedManualInput.dateKey}"]`
    );
    if (restored) {
      restored.value = focusedManualInput.value;
      restored.focus();
    }
  }
}

function renderBudgetList(nonDeletedBills, openEdit) {
  const searchTerm = document.getElementById('budget-search-input').value;
  const comparator = BILL_SORTS[selectedBillsSort] || BILL_SORTS.due_date_asc;
  const visible = nonDeletedBills
    .filter((b) => matchesBillSearch(b, searchTerm))
    .filter((b) => matchesBillCategory(b, selectedBillCategory))
    .sort(comparator);

  const list = document.getElementById('budget-list');
  const template = document.getElementById('budget-card-template');
  const todayK = todayKey();

  list.innerHTML = '';

  visible.forEach((bill) => {
    const node = template.content.cloneNode(true);
    const card = node.querySelector('.bill-card');
    card.dataset.billId = bill.id;
    const viewSection = node.querySelector('.bill-view');
    const editForm = node.querySelector('.bill-edit-form');

    node.querySelector('.bill-name').textContent = bill.name;
    node.querySelector('.bill-amount').textContent = `$${bill.amount.toFixed(2)}`;
    node.querySelector('.bill-due').textContent = `Due: ${bill.dueDate}`;
    node.querySelector('.bill-frequency').textContent = BILL_FREQUENCY_LABELS[bill.frequency] || bill.frequency;

    const categoryEl = node.querySelector('.bill-category');
    if (bill.category) {
      categoryEl.textContent = bill.category;
      categoryEl.hidden = false;
    }

    const markOldestBtn = node.querySelector('.mark-oldest-paid-btn');
    const hasUnpaid = unpaidAmountThrough(bill, todayK) > 0;
    markOldestBtn.disabled = !hasUnpaid;
    markOldestBtn.addEventListener('click', () => {
      const target = oldestUnpaidOccurrence(bill, todayKey());
      if (target) toggleBillPaid(bill.id, target, true);
    });

    const editNameInput = node.querySelector('.bill-edit-name');
    const editAmountInput = node.querySelector('.bill-edit-amount');
    const editDueDateInput = node.querySelector('.bill-edit-duedate');
    const editFrequencyInput = node.querySelector('.bill-edit-frequency');
    const editCategoryInput = node.querySelector('.bill-edit-category');
    const editError = node.querySelector('.bill-edit-error');

    node.querySelector('.edit-btn').addEventListener('click', () => {
      // Only one bill can be in edit mode at a time — close any other open
      // bill edit form first, same invariant as every other collection.
      const otherOpenForm = list.querySelector('.bill-edit-form:not([hidden])');
      if (otherOpenForm && otherOpenForm !== editForm) {
        otherOpenForm.hidden = true;
        otherOpenForm.closest('.bill-card').querySelector('.bill-view').hidden = false;
      }
      editNameInput.value = bill.name;
      editAmountInput.value = String(bill.amount);
      editDueDateInput.value = bill.dueDate;
      editFrequencyInput.value = bill.frequency;
      editCategoryInput.value = bill.category;
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
      const result = updateBill(bill.id, {
        name: editNameInput.value,
        amount: editAmountInput.value,
        dueDate: editDueDateInput.value,
        frequency: editFrequencyInput.value,
        category: editCategoryInput.value,
      });
      if (!result.ok) {
        editError.textContent = result.error;
        editError.hidden = false;
      }
    });

    node.querySelector('.delete-btn').addEventListener('click', () => deleteBill(bill.id));

    if (openEdit && openEdit.id === bill.id) {
      editNameInput.value = openEdit.name;
      editAmountInput.value = openEdit.amount;
      editDueDateInput.value = openEdit.dueDate;
      editFrequencyInput.value = openEdit.frequency;
      editCategoryInput.value = openEdit.category;
      viewSection.hidden = true;
      editForm.hidden = false;
    }

    list.appendChild(node);
  });

  document.getElementById('budget-empty-state').hidden = nonDeletedBills.length !== 0;
}

// Generalizes the "preserve in-progress unsaved input across a re-render"
// pattern to the two kinds of in-progress state specific to this tab: the
// Bills list's open edit form (identical to every other collection) AND a
// currently-focused .budget-day-manual-input (a real, non-obvious risk
// unique to this tab — toggling any single paid-checkbox anywhere calls
// renderBudget(), which wipes and rebuilds all 35 day cells including
// whichever one the user might be mid-typing into). See
// docs/specs/budget-tab.md §6.1.
function renderBudget() {
  const nonDeleted = bills.filter((b) => !b.deleted);

  const activeEl = document.activeElement;
  const focusedManualInput = (activeEl && activeEl.classList && activeEl.classList.contains('budget-day-manual-input'))
    ? { dateKey: activeEl.dataset.dateKey, value: activeEl.value }
    : null;

  const list = document.getElementById('budget-list');
  const openForm = list.querySelector('.bill-edit-form:not([hidden])');
  const openEdit = openForm
    ? {
        id: openForm.closest('.bill-card').dataset.billId,
        name: openForm.querySelector('.bill-edit-name').value,
        amount: openForm.querySelector('.bill-edit-amount').value,
        dueDate: openForm.querySelector('.bill-edit-duedate').value,
        frequency: openForm.querySelector('.bill-edit-frequency').value,
        category: openForm.querySelector('.bill-edit-category').value,
      }
    : null;

  renderBudgetStats(nonDeleted);
  renderBillCategoryFilters(nonDeleted);
  renderBudgetCalendar(nonDeleted, focusedManualInput);
  renderBudgetList(nonDeleted, openEdit);

  renderHome(); // Home aggregates books/todos/bills — keep this in sync
}

document.getElementById('budget-add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const nameInput = document.getElementById('budget-name-input');
  const amountInput = document.getElementById('budget-amount-input');
  const dueDateInput = document.getElementById('budget-duedate-input');
  const frequencyInput = document.getElementById('budget-frequency-input');
  const categoryInput = document.getElementById('budget-category-input');
  const errorEl = document.getElementById('budget-form-error');

  const result = addBill({
    name: nameInput.value,
    amount: amountInput.value,
    dueDate: dueDateInput.value,
    frequency: frequencyInput.value,
    category: categoryInput.value,
  });

  if (!result.ok) {
    errorEl.textContent = result.error;
    errorEl.hidden = false;
    return;
  }

  errorEl.hidden = true;
  nameInput.value = '';
  amountInput.value = '';
  dueDateInput.value = '';
  frequencyInput.value = 'monthly';
  categoryInput.value = '';
  nameInput.focus();
});

document.getElementById('budget-search-input').addEventListener('input', renderBudget);

document.getElementById('budget-sort-input').addEventListener('change', (e) => {
  selectedBillsSort = e.target.value;
  renderBudget();
});

// ---- Home ----
// Pure, render-only aggregation over the live books/todos/bills arrays — no
// own storage key, nothing to sync/export/undo. Re-rendered by hooking the
// end of renderBooks()/renderTodos()/renderBudget() rather than adding new
// call sites at every mutation (see docs/specs/home-dashboard.md §5).

const HOME_DUE_SOON_DAYS = 7;

function computeHomeBills(nonDeletedBills) {
  const todayK = todayKey();
  const yesterdayK = shiftDateKey(todayK, -1);

  // Overdue: real unpaid balance strictly before today. unpaidAmountThrough
  // (closed-form) on purpose — NOT oldestUnpaidOccurrence, which is an
  // unbounded day-by-day walk restricted to the "mark oldest unpaid" button's
  // click handler for cost reasons. Home re-renders on every add/edit/delete/
  // undo/redo/sync across three collections, so it must stay cheap.
  const overdue = nonDeletedBills
    .map((bill) => ({ bill, amount: unpaidAmountThrough(bill, yesterdayK) }))
    .filter((x) => x.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  // Due soon: unpaid occurrences landing on any of the next HOME_DUE_SOON_DAYS
  // days (today inclusive) — a bounded per-bill loop, same technique
  // renderBudgetCalendar() already uses.
  const dueSoon = [];
  nonDeletedBills.forEach((bill) => {
    for (let i = 0; i <= HOME_DUE_SOON_DAYS; i++) {
      const dateKey = shiftDateKey(todayK, i);
      if (occursOnDate(bill, dateKey) && !(bill.paidDates || []).includes(dateKey)) {
        dueSoon.push({ bill, dateKey });
      }
    }
  });
  dueSoon.sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));

  return { overdue, dueSoon };
}

function computeHomeTodos(nonDeletedTodos) {
  const overdue = nonDeletedTodos
    .filter((t) => !t.completed && isTodoOverdue(t))
    .sort(compareByField((t) => t.dueDate, 1, { text: false }));

  // Deliberately the same UTC idiom isTodoOverdue() already uses internally
  // (toISOString, not the corrected local-date todayKey()) so this widget's
  // two buckets partition cleanly against isTodoOverdue()'s own boundary
  // instead of drifting apart near local midnight. See
  // docs/specs/home-dashboard.md §11.1 — not a bug, not to be "fixed" here.
  const dueSoonThroughKey = new Date(Date.now() + HOME_DUE_SOON_DAYS * 86400000).toISOString().slice(0, 10);

  const dueSoon = nonDeletedTodos
    .filter((t) => !t.completed && t.dueDate && !isTodoOverdue(t) && t.dueDate <= dueSoonThroughKey)
    .sort(compareByField((t) => t.dueDate, 1, { text: false }));

  return { overdue, dueSoon };
}

function computeCurrentlyReading(nonDeletedBooks) {
  return nonDeletedBooks.filter((b) => b.status === 'currently_reading').sort(BOOK_SORTS.author_asc);
}

function renderHome() {
  const nonDeletedBills = bills.filter((b) => !b.deleted);
  const nonDeletedTodos = todos.filter((t) => !t.deleted);
  const nonDeletedBooks = books.filter((b) => !b.deleted);

  const { overdue: overdueBills, dueSoon: dueSoonBills } = computeHomeBills(nonDeletedBills);
  const { overdue: overdueTodos, dueSoon: dueSoonTodos } = computeHomeTodos(nonDeletedTodos);
  const currentlyReading = computeCurrentlyReading(nonDeletedBooks);

  const actionableCount = overdueBills.length + dueSoonBills.length + overdueTodos.length + dueSoonTodos.length;

  const statsEl = document.getElementById('home-stats');
  const emptyEl = document.getElementById('home-empty-state');
  const billsPanel = document.getElementById('home-bills-panel');
  const todoPanel = document.getElementById('home-todo-panel');
  const readingPanel = document.getElementById('home-reading-panel');
  const billsList = document.getElementById('home-bills-list');
  const todoList = document.getElementById('home-todo-list');
  const readingList = document.getElementById('home-reading-list');

  billsList.innerHTML = '';
  todoList.innerHTML = '';
  readingList.innerHTML = '';

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

  if (actionableCount > 0) {
    statsEl.textContent = `${actionableCount} thing${actionableCount === 1 ? '' : 's'} ` +
      `need${actionableCount === 1 ? 's' : ''} your attention this week.`;
    statsEl.hidden = false;
    emptyEl.hidden = true;
    billsPanel.hidden = false;
    todoPanel.hidden = false;

    overdueBills.forEach(({ bill, amount }) => {
      billsList.appendChild(makeHomeRow(() => setActiveTab('budget'), (btn) => {
        const name = document.createElement('strong');
        name.className = 'bill-name';
        name.textContent = bill.name;
        const due = document.createElement('span');
        due.className = 'bill-due overdue';
        due.textContent = `$${amount.toFixed(2)} overdue`;
        btn.append(name, due);
      }));
    });

    dueSoonBills.forEach(({ bill, dateKey }) => {
      billsList.appendChild(makeHomeRow(() => setActiveTab('budget'), (btn) => {
        const name = document.createElement('strong');
        name.className = 'bill-name';
        name.textContent = bill.name;
        const due = document.createElement('span');
        due.className = 'bill-due';
        due.textContent = `$${bill.amount.toFixed(2)} due ${dateKey}`;
        btn.append(name, due);
      }));
    });

    [...overdueTodos, ...dueSoonTodos].forEach((todo) => {
      todoList.appendChild(makeHomeRow(() => setActiveTab('todo'), (btn) => {
        const task = document.createElement('span');
        task.className = 'todo-task';
        task.textContent = todo.task;
        const due = document.createElement('span');
        due.className = 'todo-due';
        due.textContent = todo.dueDate;
        due.classList.toggle('overdue', isTodoOverdue(todo));
        btn.append(task, due);
      }));
    });
  } else {
    statsEl.hidden = true;
    emptyEl.hidden = false;
    billsPanel.hidden = true;
    todoPanel.hidden = true;
  }

  if (currentlyReading.length > 0) {
    readingPanel.hidden = false;
    currentlyReading.forEach((book) => {
      readingList.appendChild(makeHomeRow(() => setActiveTab('books'), (btn) => {
        const title = document.createElement('strong');
        title.className = 'book-title';
        title.textContent = book.title;
        const author = document.createElement('span');
        author.className = 'book-author';
        author.textContent = book.author || '';
        btn.append(title, author);
      }));
    });
  } else {
    readingPanel.hidden = true;
  }
}

// ---- Device Sync ----
// Optional: the app is fully functional offline with no sync configured, and
// keeps working from local data if the server is ever unreachable — sync is
// a best-effort background layer, never a requirement for any UI action.

const SYNC_CONFIG_KEY = 'secondMemory.syncConfig.v1';

function loadSyncConfig() {
  try {
    const raw = localStorage.getItem(SYNC_CONFIG_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && parsed.serverUrl && parsed.token) return parsed;
  } catch {
    // fall through
  }
  return null;
}

function saveSyncConfig(config) {
  localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(config));
}

// Maps each collection to the wire-protocol name the server expects, its
// localStorage key, and how to read/replace/render it — lets the sync
// function stay generic instead of nine hand-written copies.
const SYNC_COLLECTIONS = [
  { name: 'books', label: 'Books', key: BOOKS_KEY, get: () => books, set: (v) => { books = v; }, render: renderBooks, delete: deleteBook, restore: restoreBook },
  { name: 'recipes', label: 'Recipes', key: RECIPES_KEY, get: () => recipes, set: (v) => { recipes = v; }, render: renderRecipes, delete: deleteRecipe, restore: restoreRecipe },
  { name: 'medications', label: 'Medications', key: MEDICATIONS_KEY, get: () => medications, set: (v) => { medications = v; }, render: renderMedications, delete: deleteMedication, restore: restoreMedication },
  { name: 'diagnoses', label: 'Diagnoses', key: DIAGNOSES_KEY, get: () => diagnoses, set: (v) => { diagnoses = v; }, render: renderDiagnoses, delete: deleteDiagnosis, restore: restoreDiagnosis },
  { name: 'todos', label: 'To-Do', key: TODOS_KEY, get: () => todos, set: (v) => { todos = v; }, render: renderTodos, delete: deleteTodo, restore: restoreTodo },
  { name: 'shoppingList', label: 'Shopping List', key: SHOPPING_KEY, get: () => shoppingItems, set: (v) => { shoppingItems = v; }, render: renderShoppingList, delete: deleteShoppingItem, restore: restoreShoppingItem },
  { name: 'notes', label: 'Notes', key: NOTES_KEY, get: () => notes, set: (v) => { notes = v; }, render: renderNotes, delete: deleteNote, restore: restoreNote },
  { name: 'links', label: 'Resume', key: LINKS_KEY, get: () => links, set: (v) => { links = v; }, render: renderLinks, delete: deleteLink, restore: restoreLink },
  { name: 'courses', label: 'Coursework', key: COURSES_KEY, get: () => courses, set: (v) => { courses = v; }, render: renderCourses, delete: deleteCourse, restore: restoreCourse },
  { name: 'bills', label: 'Bills', key: BILLS_KEY, get: () => bills, set: (v) => { bills = v; }, render: renderBudget, delete: deleteBill, restore: restoreBill },
];

// ---- Undo/redo application mechanics ----
// Applies one side (`before` on undo, `after` on redo) of a recorded entry
// back onto the live collection, generalized across all nine collections via
// the get/set/render/delete/restore lookup above.

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

  if (!record) return; // defensive: id no longer exists at all — see spec §7.1

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
  Object.keys(snapshot).forEach((key) => {
    // Never restore identity/version bookkeeping from history — id and
    // dateAdded never change; version is server-assigned only; updatedAt/
    // deviceId are always freshly stamped below, not replayed from the old
    // snapshot, because this undo/redo action IS a new local mutation, not
    // a replay of the old timestamp. `deleted` was already handled above.
    if (['id', 'dateAdded', 'version', 'updatedAt', 'deviceId', 'deleted'].includes(key)) return;
    record[key] = snapshot[key];
  });
  stampSync(record);
  saveCollection(cfg.key, items);
  cfg.render(); // only this one collection re-renders — never the whole app
}

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

const RECORD_LABEL_FIELD = {
  books: 'title', recipes: 'title', medications: 'name', diagnoses: 'condition',
  todos: 'task', shoppingList: 'item', notes: 'title', links: 'label', courses: 'title', bills: 'name',
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

document.getElementById('undo-btn').addEventListener('click', undo);
document.getElementById('redo-btn').addEventListener('click', redo);

let syncInFlight = false;
let lastSyncedAt = null;
let lastSyncTone = null;

function setSyncStatus(text, tone) {
  lastSyncTone = tone;
  const el = document.getElementById('sync-status-text');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('sync-ok', tone === 'ok');
  el.classList.toggle('sync-failed', tone === 'failed');
}

async function runSync() {
  const config = loadSyncConfig();
  if (!config || syncInFlight) return;
  syncInFlight = true;
  setSyncStatus('Syncing…', null);

  const payload = { deviceId: getDeviceId(), collections: {} };
  SYNC_COLLECTIONS.forEach((c) => { payload.collections[c.name] = c.get(); });

  try {
    const response = await fetch(`${config.serverUrl.replace(/\/+$/, '')}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sync-Token': config.token },
      body: JSON.stringify(payload),
    });

    if (response.status === 401) {
      setSyncStatus('Sync failed — check passphrase', 'failed');
      return;
    }
    if (!response.ok) {
      setSyncStatus('Sync failed — retrying', 'failed');
      return;
    }

    const data = await response.json();
    SYNC_COLLECTIONS.forEach((c) => {
      const incoming = data.collections && Array.isArray(data.collections[c.name]) ? data.collections[c.name] : c.get();
      c.set(incoming);
      saveCollection(c.key, incoming);
      c.render();
    });

    lastSyncedAt = new Date();
    const conflicts = Array.isArray(data.conflicts) ? data.conflicts : [];
    if (conflicts.length > 0) {
      const collectionNames = [...new Set(conflicts.map((c) => c.collection))]
        .map((name) => SYNC_COLLECTIONS.find((c) => c.name === name)?.label || name);
      const noun = conflicts.length === 1 ? 'conflict' : 'conflicts';
      setSyncStatus(
        `Synced — ${conflicts.length} ${noun} merged as duplicates in ${collectionNames.join(', ')}. Review and remove any you don't need.`,
        'failed'
      );
    } else {
      setSyncStatus('Synced just now', 'ok');
    }
  } catch {
    setSyncStatus('Sync failed — retrying', 'failed');
  } finally {
    syncInFlight = false;
  }
}

// Ticks the visible "Synced Xm ago" label between actual sync attempts,
// without ever overwriting a currently-shown error/in-progress state.
setInterval(() => {
  if (lastSyncTone !== 'ok' || syncInFlight || !lastSyncedAt) return;
  const minutes = Math.floor((Date.now() - lastSyncedAt.getTime()) / 60000);
  setSyncStatus(minutes <= 0 ? 'Synced just now' : `Synced ${minutes}m ago`, 'ok');
}, 30000);

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
    const urlInput = document.getElementById('sync-url-input');
    const tokenInput = document.getElementById('sync-token-input');
    const url = urlInput.value.trim();
    const token = tokenInput.value.trim();
    if (!url || !token) return;
    saveSyncConfig({ serverUrl: url, token });
    setupSection.hidden = true;
    statusSection.hidden = false;
    runSync();
  });

  changeBtn.addEventListener('click', () => {
    setupSection.hidden = false;
    statusSection.hidden = true;
  });

  runSync();
  setInterval(runSync, 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') runSync();
  });
  window.addEventListener('online', runSync);
}

// ---- Data export / import ----
// Import's merge algorithm intentionally mirrors sync_server.py's
// merge_collection()/_content_matches() (see DECISIONS.md) so a client-side
// restore behaves the same way a genuine sync conflict does: never silently
// discard a record, treat a byte-for-byte replay as a no-op, and keep both
// sides on a genuine conflict rather than picking a winner.

function buildExportPayload() {
  const collections = {};
  SYNC_COLLECTIONS.forEach((c) => { collections[c.name] = c.get(); });
  return { collections };
}

function todayForFilename() {
  return new Date().toISOString().slice(0, 10);
}

function exportData() {
  const json = JSON.stringify(buildExportPayload(), null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `second-memory-export-${todayForFilename()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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

function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

// Port of sync_server.py's _content_matches(): true if two records are
// identical in every field except `version` — i.e. this import record is a
// re-import of something already merged in, not a genuine conflicting edit.
function contentMatchesIgnoringVersion(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.delete('version');
  return [...keys].every((k) => deepEqual(a[k], b[k]));
}

// Port of sync_server.py's merge_collection(), adapted to merge an imported
// file's records onto the in-memory client collection instead of the
// server's onto a client's. Same three cases: (a) new id -> add as a new
// record, (b) known id with an equal-or-newer incoming version -> replace
// the local record with the imported one, (c) known id with an older
// incoming version -> a no-op if the content is otherwise identical,
// otherwise kept as a new record under a freshly generated id (the local
// record is left untouched) so nothing is ever silently discarded. Mutates
// `localItems` in place and returns counts for the summary message.
function mergeCollectionFromImport(localItems, importedItems) {
  const byId = new Map(localItems.map((item) => [item.id, item]));
  let added = 0;
  let updated = 0;
  let duplicated = 0;

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
      const record = { ...incoming };
      const index = localItems.findIndex((item) => item.id === incoming.id);
      localItems[index] = record;
      byId.set(record.id, record);
      updated += 1;
      return;
    }

    if (contentMatchesIgnoringVersion(existing, incoming)) return;

    const record = { ...incoming, id: makeId() };
    localItems.push(record);
    byId.set(record.id, record);
    duplicated += 1;
  });

  return { added, updated, duplicated };
}

function setDataIoStatus(text, tone) {
  const el = document.getElementById('data-io-status');
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  el.classList.toggle('sync-ok', tone === 'ok');
  el.classList.toggle('sync-failed', tone === 'failed');
}

function importData(parsed) {
  const importedCollections = extractImportCollections(parsed);
  if (!importedCollections) {
    setDataIoStatus("Import failed — that file doesn't look like a Second Memory export.", 'failed');
    return;
  }

  const summaries = [];
  let anyChanged = false;

  SYNC_COLLECTIONS.forEach((c) => {
    const incoming = importedCollections[c.name];
    if (!Array.isArray(incoming) || incoming.length === 0) return;
    const localItems = c.get();
    const result = mergeCollectionFromImport(localItems, incoming);
    if (!result.added && !result.updated && !result.duplicated) return;

    anyChanged = true;
    saveCollection(c.key, localItems);
    c.render();
    const parts = [];
    if (result.added) parts.push(`${result.added} new`);
    if (result.updated) parts.push(`${result.updated} updated`);
    if (result.duplicated) parts.push(`${result.duplicated} merged as duplicates`);
    summaries.push(`${parts.join(', ')} in ${c.label}`);
  });

  if (!anyChanged) {
    setDataIoStatus('Import complete — nothing new to merge.', 'ok');
    return;
  }

  setDataIoStatus(`Import complete — ${summaries.join('; ')}.`, 'ok');
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

// ---- Init ----

renderBooks();
renderRecipes();
renderMedications();
renderDiagnoses();
renderTodos();
renderShoppingList();
renderNotes();
renderLinks();
renderCourses();
renderBudget();
updateUndoRedoButtons();
setActiveTab(loadUiState().activeTab || 'home');
initSyncUI();
