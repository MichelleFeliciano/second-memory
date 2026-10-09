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
check('a plain range is still a range', scaleIngredientLine('2-3 cloves garlic', 2) === '4-6 cloves garlic');

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

// ---- budget: day income boxes ----
income.length = 0;
setIncomeForDate('2026-10-05', '10.999');
check('a day amount is rounded to whole cents', income.find((r) => r.dateKey === '2026-10-05').amount === 11);
income.length = 0;
nav('budget'); renderBudget();
const box = document.querySelector('.budget-day-manual-input');
setIncomeForDate(box.dataset.dateKey, '50');
await sleep(30);
setIncomeForDate(box.dataset.dateKey, '9999999999');
await sleep(30);
check('an out-of-range amount is refused and the saved one stays', income.find((r) => r.dateKey === box.dataset.dateKey).amount === 50);
income.length = 0;
// pay period message
savePaydaySettings({ payDateKey: null, frequency: 'biweekly' }); renderPayPeriod();
check('with no payday set the pay period says to set one', /Set a recent payday/.test($('pay-period-empty-state').textContent), $('pay-period-empty-state').textContent);
savePaydaySettings({ payDateKey: dk(-3), frequency: 'biweekly' }); renderPayPeriod();
check('with a payday set the pay period shows bills or the usual empty message', !/Set a recent payday/.test($('pay-period-empty-state').textContent));

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

// ---- third review: missing optional fields and bad optional values ----
bills.length = 0; income.length = 0; shoppingItems.length = 0;
bills.push({ ...r2, id: 'bc1', name: 'Rent', amount: 900, dueDate: dk(5), frequency: 'monthly', paidDates: [] });
nav('budget'); renderBudget();
check('a bill with no category is not found by searching "undefined"', matchesBillSearch(bills[0], 'undefined') === false);
document.querySelector('#budget-list .edit-btn').click();
check('Edit opens for a bill with no category without showing "undefined"', document.querySelector('#budget-list .bill-edit-category').value === '');
bills.length = 0;
check('the import check refuses a book with a bad rating or author', !isValidImportRecord('books', { id: 'x', title: 'T', status: 'owned_read', rating: -1 }) && !isValidImportRecord('books', { id: 'x', title: 'T', status: 'owned_read', rating: 1e9 }) && !isValidImportRecord('books', { id: 'x', title: 'T', status: 'owned_read', author: 123 }) && isValidImportRecord('books', { id: 'x', title: 'T', status: 'owned_read', rating: 4, author: 'A' }) && isValidImportRecord('books', { id: 'x', title: 'T', status: 'owned_unread', rating: null }));
check('backup file names use the local date', todayForFilename() === todayKey());
check('the current tab is announced to screen readers', document.querySelectorAll('.nav-item[aria-current="page"]').length === 1);
