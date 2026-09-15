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

// ---- UI state (active tab) ----

const UI_STORAGE_KEY = 'secondMemory.ui.v1';
const TABS = ['books', 'recipes', 'medications', 'diagnoses', 'todo', 'shopping', 'notes', 'resume', 'coursework'];

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
  const activeTab = TABS.includes(tab) ? tab : 'books';
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
const BOOK_STATUSES = ['want_to_buy', 'owned_unread', 'owned_read'];

let books = migrateSyncFields(loadCollection(BOOKS_KEY), BOOKS_KEY, getDeviceId());

function addBook(title, author, status) {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) return;
  const now = new Date().toISOString();
  books.push({
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
  });
  saveCollection(BOOKS_KEY, books);
  renderBooks();
}

function updateBookStatus(id, newStatus) {
  const book = books.find((b) => b.id === id);
  if (!book || !BOOK_STATUSES.includes(newStatus)) return;
  book.status = newStatus;
  if (newStatus !== 'owned_read') book.rating = null;
  stampSync(book);
  saveCollection(BOOKS_KEY, books);
  renderBooks();
}

function updateBookRating(id, rating) {
  const book = books.find((b) => b.id === id);
  if (!book) return;
  book.rating = rating ? Number(rating) : null;
  stampSync(book);
  saveCollection(BOOKS_KEY, books);
}

function deleteBook(id) {
  const book = books.find((b) => b.id === id);
  if (!book) return;
  book.deleted = true;
  stampSync(book);
  saveCollection(BOOKS_KEY, books);
  renderBooks();
}

function matchesBookSearch(book, term) {
  if (!term) return true;
  const haystack = `${book.title} ${book.author}`.toLowerCase();
  return haystack.includes(term.toLowerCase());
}

function renderBooks() {
  const searchTerm = document.getElementById('books-search-input').value;
  const visible = books.filter((b) => !b.deleted).filter((b) => matchesBookSearch(b, searchTerm));
  const template = document.getElementById('books-card-template');

  BOOK_STATUSES.forEach((status) => {
    const list = document.querySelector(`[data-list="${status}"]`);
    list.innerHTML = '';
    const itemsForStatus = visible.filter((b) => b.status === status);
    document.querySelector(`[data-count="${status}"]`).textContent = itemsForStatus.length;

    itemsForStatus.forEach((book) => {
      const node = template.content.cloneNode(true);
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

      node.querySelector('.delete-btn').addEventListener('click', () => deleteBook(book.id));

      list.appendChild(node);
    });
  });

  document.getElementById('books-empty-state').hidden = books.filter((b) => !b.deleted).length !== 0;
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
  recipes.push({
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
  });
  saveCollection(RECIPES_KEY, recipes);
  renderRecipes();
}

function deleteRecipe(id) {
  const recipe = recipes.find((r) => r.id === id);
  if (!recipe) return;
  recipe.deleted = true;
  stampSync(recipe);
  saveCollection(RECIPES_KEY, recipes);
  renderRecipes();
}

function matchesRecipeSearch(recipe, term) {
  if (!term) return true;
  const haystack = [recipe.title, recipe.category, ...recipe.ingredients, ...recipe.steps, recipe.notes]
    .join(' ')
    .toLowerCase();
  return haystack.includes(term.toLowerCase());
}

function renderRecipes() {
  const searchTerm = document.getElementById('recipes-search-input').value;
  const visible = recipes.filter((r) => !r.deleted).filter((r) => matchesRecipeSearch(r, searchTerm));
  const list = document.getElementById('recipes-list');
  const template = document.getElementById('recipes-card-template');
  list.innerHTML = '';

  visible.forEach((recipe) => {
    const node = template.content.cloneNode(true);
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

    node.querySelector('.delete-btn').addEventListener('click', () => deleteRecipe(recipe.id));

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
  medications.push({
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
  });
  saveCollection(MEDICATIONS_KEY, medications);
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
  med.startDate = newStart;
  med.endDate = newEnd;
  stampSync(med);
  saveCollection(MEDICATIONS_KEY, medications);
  renderMedications();
  return { ok: true };
}

function deleteMedication(id) {
  const med = medications.find((m) => m.id === id);
  if (!med) return;
  med.deleted = true;
  stampSync(med);
  saveCollection(MEDICATIONS_KEY, medications);
  renderMedications();
}

function matchesMedicationSearch(med, term) {
  if (!term) return true;
  const haystack = [med.name, med.dosage, med.frequency, med.prescribingDoctor, med.notes]
    .join(' ')
    .toLowerCase();
  return haystack.includes(term.toLowerCase());
}

function renderMedicationGroup(groupKey, items, template) {
  const list = document.querySelector(`[data-med-list="${groupKey}"]`);
  list.innerHTML = '';
  document.querySelector(`[data-med-count="${groupKey}"]`).textContent = items.length;

  items.forEach((med) => {
    const node = template.content.cloneNode(true);
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

    node.querySelector('.delete-btn').addEventListener('click', () => deleteMedication(med.id));

    list.appendChild(node);
  });
}

function renderMedications() {
  const searchTerm = document.getElementById('medications-search-input').value;
  const visible = medications.filter((m) => !m.deleted).filter((m) => matchesMedicationSearch(m, searchTerm));
  const template = document.getElementById('medications-card-template');

  const current = visible.filter((m) => m.endDate === null);
  const former = visible.filter((m) => m.endDate !== null);

  renderMedicationGroup('current', current, template);
  renderMedicationGroup('former', former, template);

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

// ---- Diagnoses ----

const DIAGNOSES_KEY = 'secondMemory.diagnoses.v1';
const DIAGNOSIS_STATUSES = ['active', 'monitoring', 'resolved'];

let diagnoses = migrateSyncFields(loadCollection(DIAGNOSES_KEY), DIAGNOSES_KEY, getDeviceId());

function addDiagnosis(condition, dateDiagnosed, provider, notes) {
  const trimmedCondition = condition.trim();
  if (!trimmedCondition) return;
  const now = new Date().toISOString();
  diagnoses.push({
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
  });
  saveCollection(DIAGNOSES_KEY, diagnoses);
  renderDiagnoses();
}

function updateDiagnosisStatus(id, newStatus) {
  const diagnosis = diagnoses.find((d) => d.id === id);
  if (!diagnosis || !DIAGNOSIS_STATUSES.includes(newStatus)) return;
  diagnosis.status = newStatus;
  stampSync(diagnosis);
  saveCollection(DIAGNOSES_KEY, diagnoses);
  renderDiagnoses();
}

function deleteDiagnosis(id) {
  const diagnosis = diagnoses.find((d) => d.id === id);
  if (!diagnosis) return;
  diagnosis.deleted = true;
  stampSync(diagnosis);
  saveCollection(DIAGNOSES_KEY, diagnoses);
  renderDiagnoses();
}

function matchesDiagnosisSearch(diagnosis, term) {
  if (!term) return true;
  const haystack = `${diagnosis.condition} ${diagnosis.provider} ${diagnosis.notes}`.toLowerCase();
  return haystack.includes(term.toLowerCase());
}

function renderDiagnoses() {
  const searchTerm = document.getElementById('diagnoses-search-input').value;
  const visible = diagnoses.filter((d) => !d.deleted).filter((d) => matchesDiagnosisSearch(d, searchTerm));
  const template = document.getElementById('diagnoses-card-template');

  DIAGNOSIS_STATUSES.forEach((status) => {
    const list = document.querySelector(`[data-diagnosis-list="${status}"]`);
    list.innerHTML = '';
    const items = visible.filter((d) => d.status === status);
    document.querySelector(`[data-diagnosis-count="${status}"]`).textContent = items.length;

    items.forEach((diagnosis) => {
      const node = template.content.cloneNode(true);
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

      node.querySelector('.delete-btn').addEventListener('click', () => deleteDiagnosis(diagnosis.id));

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

// ---- To-Do ----

const TODOS_KEY = 'secondMemory.todos.v1';

let todos = migrateSyncFields(loadCollection(TODOS_KEY), TODOS_KEY, getDeviceId());

function addTodo(task, dueDate) {
  const trimmedTask = task.trim();
  if (!trimmedTask) return;
  const now = new Date().toISOString();
  todos.push({
    id: makeId(),
    task: trimmedTask,
    completed: false,
    dueDate: dueDate || null,
    dateAdded: now,
    updatedAt: now,
    deviceId: getDeviceId(),
    deleted: false,
    version: 0,
  });
  saveCollection(TODOS_KEY, todos);
  renderTodos();
}

function toggleTodoCompleted(id, completed) {
  const todo = todos.find((t) => t.id === id);
  if (!todo) return;
  todo.completed = completed;
  stampSync(todo);
  saveCollection(TODOS_KEY, todos);
  renderTodos();
}

function deleteTodo(id) {
  const todo = todos.find((t) => t.id === id);
  if (!todo) return;
  todo.deleted = true;
  stampSync(todo);
  saveCollection(TODOS_KEY, todos);
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

function renderTodos() {
  const searchTerm = document.getElementById('todo-search-input').value;
  const visible = todos.filter((t) => !t.deleted).filter((t) => matchesTodoSearch(t, searchTerm));
  const list = document.getElementById('todo-list');
  const template = document.getElementById('todo-card-template');
  list.innerHTML = '';

  visible.forEach((todo) => {
    const node = template.content.cloneNode(true);
    const li = node.querySelector('.todo-item');
    li.classList.toggle('completed', todo.completed);

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

    node.querySelector('.delete-btn').addEventListener('click', () => deleteTodo(todo.id));

    list.appendChild(node);
  });

  document.getElementById('todo-empty-state').hidden = todos.filter((t) => !t.deleted).length !== 0;
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

// ---- Shopping List ----

const SHOPPING_KEY = 'secondMemory.shoppingList.v1';

let shoppingItems = migrateSyncFields(loadCollection(SHOPPING_KEY), SHOPPING_KEY, getDeviceId());

function addShoppingItem(item, quantity, category) {
  const trimmedItem = item.trim();
  if (!trimmedItem) return;
  const now = new Date().toISOString();
  shoppingItems.push({
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
  });
  saveCollection(SHOPPING_KEY, shoppingItems);
  renderShoppingList();
}

function toggleShoppingChecked(id, checked) {
  const item = shoppingItems.find((i) => i.id === id);
  if (!item) return;
  item.checked = checked;
  stampSync(item);
  saveCollection(SHOPPING_KEY, shoppingItems);
  renderShoppingList();
}

function deleteShoppingItem(id) {
  const item = shoppingItems.find((i) => i.id === id);
  if (!item) return;
  item.deleted = true;
  stampSync(item);
  saveCollection(SHOPPING_KEY, shoppingItems);
  renderShoppingList();
}

function matchesShoppingSearch(item, term) {
  if (!term) return true;
  const haystack = `${item.item} ${item.category} ${item.quantity}`.toLowerCase();
  return haystack.includes(term.toLowerCase());
}

function renderShoppingList() {
  const searchTerm = document.getElementById('shopping-search-input').value;
  const visible = shoppingItems.filter((i) => !i.deleted).filter((i) => matchesShoppingSearch(i, searchTerm));
  const list = document.getElementById('shopping-list');
  const template = document.getElementById('shopping-card-template');
  list.innerHTML = '';

  visible.forEach((item) => {
    const node = template.content.cloneNode(true);
    const li = node.querySelector('.shopping-item');
    li.classList.toggle('completed', item.checked);

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

    node.querySelector('.delete-btn').addEventListener('click', () => deleteShoppingItem(item.id));

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

// ---- Notes ----

const NOTES_KEY = 'secondMemory.notes.v1';

let notes = migrateSyncFields(loadCollection(NOTES_KEY), NOTES_KEY, getDeviceId());

function addNote(title, body) {
  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  if (!trimmedTitle && !trimmedBody) return { ok: false, error: 'A note needs a title or some text.' };
  const now = new Date().toISOString();
  notes.push({
    id: makeId(),
    title: trimmedTitle,
    body: trimmedBody,
    dateAdded: now,
    dateModified: now,
    updatedAt: now,
    deviceId: getDeviceId(),
    deleted: false,
    version: 0,
  });
  saveCollection(NOTES_KEY, notes);
  renderNotes();
  return { ok: true };
}

function updateNote(id, title, body) {
  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  if (!trimmedTitle && !trimmedBody) return { ok: false, error: 'A note needs a title or some text.' };
  const note = notes.find((n) => n.id === id);
  if (!note) return { ok: false, error: 'Note not found.' };
  const now = new Date().toISOString();
  note.title = trimmedTitle;
  note.body = trimmedBody;
  note.dateModified = now;
  note.updatedAt = now;
  note.deviceId = getDeviceId();
  saveCollection(NOTES_KEY, notes);
  renderNotes();
  return { ok: true };
}

function deleteNote(id) {
  const note = notes.find((n) => n.id === id);
  if (!note) return;
  note.deleted = true;
  stampSync(note);
  saveCollection(NOTES_KEY, notes);
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

function renderNotes() {
  const searchTerm = document.getElementById('notes-search-input').value;
  const visible = notes.filter((n) => !n.deleted).filter((n) => matchesNoteSearch(n, searchTerm));
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
  links.push({
    id: makeId(),
    label: trimmedLabel,
    url: trimmedUrl,
    notes: notes.trim(),
    dateAdded: now,
    updatedAt: now,
    deviceId: getDeviceId(),
    deleted: false,
    version: 0,
  });
  saveCollection(LINKS_KEY, links);
  renderLinks();
  return { ok: true };
}

function deleteLink(id) {
  const link = links.find((l) => l.id === id);
  if (!link) return;
  link.deleted = true;
  stampSync(link);
  saveCollection(LINKS_KEY, links);
  renderLinks();
}

function matchesLinkSearch(link, term) {
  if (!term) return true;
  const haystack = `${link.label} ${link.url} ${link.notes}`.toLowerCase();
  return haystack.includes(term.toLowerCase());
}

function hrefFor(url) {
  return URL_SCHEME_RE.test(url) ? url : `https://${url}`;
}

function renderLinks() {
  const searchTerm = document.getElementById('resume-search-input').value;
  const visible = links.filter((l) => !l.deleted).filter((l) => matchesLinkSearch(l, searchTerm));
  const list = document.getElementById('resume-list');
  const template = document.getElementById('resume-card-template');
  list.innerHTML = '';

  visible.forEach((link) => {
    const node = template.content.cloneNode(true);
    node.querySelector('.link-label').textContent = link.label;

    const anchor = node.querySelector('.link-url');
    anchor.textContent = link.url;
    anchor.href = hrefFor(link.url);

    const notesEl = node.querySelector('.link-notes');
    if (link.notes) {
      notesEl.textContent = link.notes;
      notesEl.hidden = false;
    }

    node.querySelector('.delete-btn').addEventListener('click', () => deleteLink(link.id));

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
  courses.push({
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
  });
  saveCollection(COURSES_KEY, courses);
  renderCourses();
  return { ok: true };
}

function updateCourseStatus(id, newStatus) {
  const course = courses.find((c) => c.id === id);
  if (!course || !COURSE_STATUSES.includes(newStatus)) return;
  course.status = newStatus;
  if (newStatus !== 'completed') course.grade = null;
  stampSync(course);
  saveCollection(COURSES_KEY, courses);
  renderCourses();
}

function updateCourseGrade(id, grade) {
  const course = courses.find((c) => c.id === id);
  if (!course) return;
  const trimmedGrade = grade.trim();
  course.grade = trimmedGrade ? trimmedGrade : null;
  stampSync(course);
  saveCollection(COURSES_KEY, courses);
}

function deleteCourse(id) {
  const course = courses.find((c) => c.id === id);
  if (!course) return;
  course.deleted = true;
  stampSync(course);
  saveCollection(COURSES_KEY, courses);
  renderCourses();
}

function matchesCourseSearch(course, term) {
  if (!term) return true;
  const haystack = [course.title, course.code, course.term, course.grade, course.notes]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(term.toLowerCase());
}

function renderCourses() {
  const searchTerm = document.getElementById('coursework-search-input').value;
  const visible = courses.filter((c) => !c.deleted).filter((c) => matchesCourseSearch(c, searchTerm));
  const template = document.getElementById('coursework-card-template');

  COURSE_STATUSES.forEach((status) => {
    const list = document.querySelector(`[data-course-list="${status}"]`);
    list.innerHTML = '';
    const items = visible.filter((c) => c.status === status);
    document.querySelector(`[data-course-count="${status}"]`).textContent = items.length;

    items.forEach((course) => {
      const node = template.content.cloneNode(true);
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

      node.querySelector('.delete-btn').addEventListener('click', () => deleteCourse(course.id));

      list.appendChild(node);
    });
  });

  document.getElementById('coursework-empty-state').hidden = courses.filter((c) => !c.deleted).length !== 0;
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
  { name: 'books', label: 'Books', key: BOOKS_KEY, get: () => books, set: (v) => { books = v; }, render: renderBooks },
  { name: 'recipes', label: 'Recipes', key: RECIPES_KEY, get: () => recipes, set: (v) => { recipes = v; }, render: renderRecipes },
  { name: 'medications', label: 'Medications', key: MEDICATIONS_KEY, get: () => medications, set: (v) => { medications = v; }, render: renderMedications },
  { name: 'diagnoses', label: 'Diagnoses', key: DIAGNOSES_KEY, get: () => diagnoses, set: (v) => { diagnoses = v; }, render: renderDiagnoses },
  { name: 'todos', label: 'To-Do', key: TODOS_KEY, get: () => todos, set: (v) => { todos = v; }, render: renderTodos },
  { name: 'shoppingList', label: 'Shopping List', key: SHOPPING_KEY, get: () => shoppingItems, set: (v) => { shoppingItems = v; }, render: renderShoppingList },
  { name: 'notes', label: 'Notes', key: NOTES_KEY, get: () => notes, set: (v) => { notes = v; }, render: renderNotes },
  { name: 'links', label: 'Resume', key: LINKS_KEY, get: () => links, set: (v) => { links = v; }, render: renderLinks },
  { name: 'courses', label: 'Coursework', key: COURSES_KEY, get: () => courses, set: (v) => { courses = v; }, render: renderCourses },
];

const ACTIVE_TAB_TO_COLLECTION = {
  books: 'books', recipes: 'recipes', medications: 'medications', diagnoses: 'diagnoses',
  todo: 'todos', shopping: 'shoppingList', notes: 'notes', resume: 'links', coursework: 'courses',
};

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

function renderActiveCollection() {
  const activeTab = loadUiState().activeTab || 'books';
  const entry = SYNC_COLLECTIONS.find((c) => c.name === ACTIVE_TAB_TO_COLLECTION[activeTab]);
  if (entry) entry.render();
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
    renderActiveCollection();
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
setActiveTab(loadUiState().activeTab || 'books');
initSyncUI();
