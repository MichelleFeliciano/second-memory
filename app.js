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

// ---- UI state (active tab) ----

const UI_STORAGE_KEY = 'secondMemory.ui.v1';
const TABS = ['books', 'recipes', 'medications', 'diagnoses'];

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

let books = loadCollection(BOOKS_KEY);

function addBook(title, author, status) {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) return;
  books.push({
    id: makeId(),
    title: trimmedTitle,
    author: author.trim(),
    status: BOOK_STATUSES.includes(status) ? status : 'want_to_buy',
    rating: null,
    dateAdded: new Date().toISOString(),
  });
  saveCollection(BOOKS_KEY, books);
  renderBooks();
}

function updateBookStatus(id, newStatus) {
  const book = books.find((b) => b.id === id);
  if (!book || !BOOK_STATUSES.includes(newStatus)) return;
  book.status = newStatus;
  if (newStatus !== 'owned_read') book.rating = null;
  saveCollection(BOOKS_KEY, books);
  renderBooks();
}

function updateBookRating(id, rating) {
  const book = books.find((b) => b.id === id);
  if (!book) return;
  book.rating = rating ? Number(rating) : null;
  saveCollection(BOOKS_KEY, books);
}

function deleteBook(id) {
  books = books.filter((b) => b.id !== id);
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
  const visible = books.filter((b) => matchesBookSearch(b, searchTerm));
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

  document.getElementById('books-empty-state').hidden = books.length !== 0;
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

let recipes = loadCollection(RECIPES_KEY);

function splitLines(text) {
  return text.split('\n').map((s) => s.trim()).filter(Boolean);
}

function addRecipe(title, category, ingredientsText, stepsText, notes) {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) return;
  recipes.push({
    id: makeId(),
    title: trimmedTitle,
    category: category.trim(),
    ingredients: splitLines(ingredientsText),
    steps: splitLines(stepsText),
    notes: notes.trim(),
    dateAdded: new Date().toISOString(),
  });
  saveCollection(RECIPES_KEY, recipes);
  renderRecipes();
}

function deleteRecipe(id) {
  recipes = recipes.filter((r) => r.id !== id);
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
  const visible = recipes.filter((r) => matchesRecipeSearch(r, searchTerm));
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

  document.getElementById('recipes-empty-state').hidden = recipes.length !== 0;
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

let medications = loadCollection(MEDICATIONS_KEY);

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
  medications.push({
    id: makeId(),
    name: trimmedName,
    dosage: fields.dosage.trim(),
    frequency: fields.frequency.trim(),
    prescribingDoctor: fields.prescribingDoctor.trim(),
    startDate,
    endDate,
    notes: fields.notes.trim(),
    dateAdded: new Date().toISOString(),
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
  saveCollection(MEDICATIONS_KEY, medications);
  renderMedications();
  return { ok: true };
}

function deleteMedication(id) {
  medications = medications.filter((m) => m.id !== id);
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
  const visible = medications.filter((m) => matchesMedicationSearch(m, searchTerm));
  const template = document.getElementById('medications-card-template');

  const current = visible.filter((m) => m.endDate === null);
  const former = visible.filter((m) => m.endDate !== null);

  renderMedicationGroup('current', current, template);
  renderMedicationGroup('former', former, template);

  document.getElementById('medications-empty-state').hidden = medications.length !== 0;
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

let diagnoses = loadCollection(DIAGNOSES_KEY);

function addDiagnosis(condition, dateDiagnosed, provider, notes) {
  const trimmedCondition = condition.trim();
  if (!trimmedCondition) return;
  diagnoses.push({
    id: makeId(),
    condition: trimmedCondition,
    dateDiagnosed: dateDiagnosed || null,
    provider: provider.trim(),
    status: 'active',
    notes: notes.trim(),
    dateAdded: new Date().toISOString(),
  });
  saveCollection(DIAGNOSES_KEY, diagnoses);
  renderDiagnoses();
}

function updateDiagnosisStatus(id, newStatus) {
  const diagnosis = diagnoses.find((d) => d.id === id);
  if (!diagnosis || !DIAGNOSIS_STATUSES.includes(newStatus)) return;
  diagnosis.status = newStatus;
  saveCollection(DIAGNOSES_KEY, diagnoses);
  renderDiagnoses();
}

function deleteDiagnosis(id) {
  diagnoses = diagnoses.filter((d) => d.id !== id);
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
  const visible = diagnoses.filter((d) => matchesDiagnosisSearch(d, searchTerm));
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

  document.getElementById('diagnoses-empty-state').hidden = diagnoses.length !== 0;
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

// ---- Init ----

renderBooks();
renderRecipes();
renderMedications();
renderDiagnoses();
setActiveTab(loadUiState().activeTab || 'books');
