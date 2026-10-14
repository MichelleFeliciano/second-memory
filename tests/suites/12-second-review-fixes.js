// Regression tests for the second full review: each check fails if its bug comes back.
const tt = new Date().toISOString();
const r2 = { dateAdded: tt, updatedAt: tt, deviceId: 'test', deleted: false, version: 0 };

// ---- repeating to-do: re-ticking after un-ticking never makes a second next task ----
todos.length = 0;
addTodo('Water plants', dk(0), 'daily');
const parent = todos[0];
toggleTodoCompleted(parent.id, true);
const kept = todos.find((t) => t.id === parent.spawnedId);
kept.task = 'Water plants (edited)'; kept.updatedAt = new Date(Date.now() + 5000).toISOString();
toggleTodoCompleted(parent.id, false);
toggleTodoCompleted(parent.id, true);
check('un-ticking keeps an edited next task and re-ticking does not add another', todos.filter((t) => !t.deleted && t.task.startsWith('Water plants') && !t.completed && t.id !== parent.id).length === 1, JSON.stringify(todos.map((t) => [t.task, t.completed, t.deleted])));

// ---- links ----
check('a bare email address becomes a mail link', hrefFor('me@site.com') === 'mailto:me@site.com');
check('web addresses and script-looking text are still safe', hrefFor('example.com') === 'https://example.com' && hrefFor('javascript:alert(1)') === 'https://javascript:alert(1)' && hrefFor('https://a.b/c') === 'https://a.b/c');

// ---- diagnosis with no status: the Move menu shows Active ----
diagnoses.length = 0;
diagnoses.push({ ...r2, id: 'dgx', condition: 'No status', dateDiagnosed: null, provider: '', notes: '' });
nav('diagnoses'); renderDiagnoses();
check('the Move menu of a status-less diagnosis shows Active', document.querySelector('[data-diagnosis-list="active"] .diagnosis-card .move-select').value === 'active');
diagnoses.length = 0; renderDiagnoses();

// ---- edit forms for records with missing fields ----
recipes.length = 0; books.length = 0; medications.length = 0;
recipes.push({ ...r2, id: 'rx1', title: 'Bare recipe' });
books.push({ ...r2, id: 'bx1', title: 'Bare book', status: 'owned_unread', rating: null });
medications.push({ ...r2, id: 'mx1', name: 'Bare med' });
nav('recipes'); renderRecipes();
let opened = true;
try { document.querySelector('#recipes-list .edit-btn').click(); } catch { opened = false; }
check('Edit opens for a recipe with no ingredients, steps, category or notes (and shows no "undefined")', opened && !document.querySelector('#recipes-list .recipe-edit-form').hidden && document.querySelector('#recipes-list .recipe-edit-notes').value === '' && document.querySelector('#recipes-list .recipe-edit-category').value === '');
nav('books'); renderBooks();
document.querySelector('#books-collection .book-card .edit-btn').click();
check('Edit opens for a book with no author, and searching for "undefined" does not match it', document.querySelector('#books-collection .book-edit-author').value === '' && matchesBookSearch(books[0], 'undefined') === false);
nav('medications'); renderMedications();
document.querySelector('#medications-list .edit-btn').click();
check('Edit opens for a medication with no dosage or notes', document.querySelector('#medications-list .med-edit-dosage').value === '' && document.querySelector('#medications-list .med-edit-notes').value === '');
recipes.length = 0; books.length = 0; medications.length = 0;

// ---- recipe scaling details ----
check('"1-1/2 cups" is one and a half', scaleIngredientLine('1-1/2 cups flour', 2) === '3 cups flour');
check('list markers are kept and the amount is scaled', scaleIngredientLine('- 2 cups flour', 2) === '- 4 cups flour' && scaleIngredientLine('1) 2 cups flour', 2) === '1) 4 cups flour' && scaleIngredientLine('2. 1 cup milk', 2) === '2. 2 cups milk');
check('bunch pluralises properly', scaleIngredientLine('1 bunch cilantro', 2) === '2 bunches cilantro' && scaleIngredientLine('2 bunches parsley', 0.5) === '1 bunch parsley');

// ---- cook mode: the arrow key does not end the recipe ----
recipes.push({ ...r2, id: 'rk1', title: 'Two steps', category: '', ingredients: ['1 egg'], steps: ['One', 'Two'], notes: '' });
openCookMode('rk1');
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
check('ArrowRight on the last step stays put (only the Done button closes)', !$('cook-mode').hidden && /Step 2 of 2/.test($('cook-progress').textContent));
$('cook-next').click();
check('the Done button still closes it', $('cook-mode').hidden);
recipes.length = 0;

// ---- weight ----
check('a goal of 0.04 is refused', (() => { nav('weight'); set('weight-goal-input', '0.04'); $('weight-goal-form').requestSubmit(); return !$('weight-goal-error').hidden && loadWeightGoal() === null; })());
weights.length = 0;
weights.push({ ...r2, id: 'wa', date: dk(-200), weight: 190, note: '' }, { ...r2, id: 'wb', date: dk(-150), weight: 180, note: '' });
check('no "last 30 days" change when the newest weight is months old', weightChangeLast30(weights) === null);
weights.length = 0;

// ---- journal ----
check('a journal entry with an impossible date is refused on restore', !isValidJournalEntry({ id: 'q', type: 'daily', date: '2024-13-05', answers: { on_mind: 'x' } }) && !isValidJournalEntry({ id: 'q', type: 'daily', date: '2024-00-05', answers: { on_mind: 'x' } }) && isValidJournalEntry({ id: 'q', type: 'daily', date: '2024-12-05', answers: { on_mind: 'x' } }));
journalEntries.length = 0; saveJournalEntries();
nav('journal');
openJournalWizard('daily');
journalDraft.answers.on_mind = 'half written';
const realConfirm = window.confirm;
let asked = false;
window.confirm = () => { asked = true; return false; };
$('journal-prompt-btn').click();
window.confirm = realConfirm;
check('"Write about this" asks before throwing away an entry being written', asked && journalDraft && journalDraft.answers.on_mind === 'half written');
$('journal-cancel-btn').click();

// ---- sync reminder counts a sync that reported a conflict ----
check('the stale-sync clock is reset by any sync that reached the server', (() => {
  const src = runSync.toString();
  const beforeBranches = src.indexOf('recordBackupTime(LAST_SYNC_AT_KEY)');
  return beforeBranches > -1 && beforeBranches < src.indexOf('const conflicts');
})());

check('the import check refuses a book with a bad rating or author', !isValidImportRecord('books', { id: 'x', title: 'T', status: 'owned_read', rating: -1 }) && !isValidImportRecord('books', { id: 'x', title: 'T', status: 'owned_read', rating: 1e9 }) && !isValidImportRecord('books', { id: 'x', title: 'T', status: 'owned_read', author: 123 }) && isValidImportRecord('books', { id: 'x', title: 'T', status: 'owned_read', rating: 4, author: 'A' }) && isValidImportRecord('books', { id: 'x', title: 'T', status: 'owned_unread', rating: null }));
check('backup file names use the local date', todayForFilename() === todayKey());
check('the current tab is announced to screen readers', document.querySelectorAll('.nav-item[aria-current="page"]').length === 1);

// ---- second line-by-line review: weight / to-do / notes range ----
check('a repeating to-do with an unreadable due date gets a real next date', /^\d{4}-\d{2}-\d{2}$/.test(nextRepeatDate('garbage', 'weekly', null)) && /^\d{4}-\d{2}-\d{2}$/.test(nextRepeatDate('2026-99-99', 'monthly', null)));
{
  const stamp = { dateAdded: new Date().toISOString(), updatedAt: new Date().toISOString(), deviceId: 'test', deleted: false, version: 1 };
  const noteCount = notes.length;
  notes.push({ ...stamp, id: 'nd-note', title: 'No modified stamp', body: 'x' });
  $('notes-search-input').value = '';
  renderNotes();
  const stampText = document.querySelector('[data-note-id="nd-note"] .note-modified').textContent;
  check('a note with no dateModified shows a real date, never "Invalid Date"', /^Updated /.test(stampText) && !/Invalid/.test(stampText));
  notes.length = noteCount;
  renderNotes();
}

// ---- Home search results follow the data ----
books.length = 0;
books.push({ ...r2, id: 'gsb', title: 'Zebrafinch Handbook', author: 'A', status: 'owned_unread', rating: null });
nav('home'); renderHome();
set('global-search-input', 'zebrafinch'); $('global-search-input').dispatchEvent(new Event('input', { bubbles: true }));
const hadHit = /Zebrafinch/.test($('global-search-results').textContent);
books[0].deleted = true; renderHome();
check('Home search results drop an item deleted meanwhile', hadHit && !/Zebrafinch/.test($('global-search-results').textContent));
set('global-search-input', ''); $('global-search-input').dispatchEvent(new Event('input', { bubbles: true }));
books.length = 0; renderBooks();

// ---- checked-off to-dos and shopping items sink to the bottom ----
todos.length = 0; shoppingItems.length = 0;
todos.push({ ...r2, id: 'tdA', task: 'A done', dueDate: dk(1), completed: true });
todos.push({ ...r2, id: 'tdB', task: 'B open', dueDate: dk(5), completed: false });
nav('todo'); selectedTodoFilter = 'all'; renderTodos();
check('done to-dos list after open ones', [...document.querySelectorAll('#todo-list .todo-task')].map((e) => e.textContent).join('|') === 'B open|A done');
shoppingItems.push({ ...r2, id: 'shA', item: 'Aaa checked', quantity: '', category: 'x', checked: true });
shoppingItems.push({ ...r2, id: 'shB', item: 'Bbb open', quantity: '', category: 'x', checked: false });
nav('shopping'); selectedShoppingChecked = 'all'; selectedShoppingCategory = 'all'; renderShoppingList();
check('checked shopping items list after open ones', [...document.querySelectorAll('#shopping-list .shopping-item-name')].map((e) => e.textContent).join('|') === 'Bbb open|Aaa checked');
todos.length = 0; shoppingItems.length = 0; renderTodos(); renderShoppingList();
