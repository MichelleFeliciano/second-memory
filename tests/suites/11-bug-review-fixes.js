// Regression tests for bugs found in the whole-code review: each check fails if its bug comes back.
const stamp = new Date().toISOString();
const old = '2026-01-01T00:00:00.000Z';
const rb = { dateAdded: old, updatedAt: old, deviceId: 'test', deleted: false, version: 0 };

// ---- importing an older backup never duplicates a record that was edited since ----
books.length = 0;
books.push({ ...rb, id: 'bk1', title: 'Edited later', author: 'A', status: 'owned_unread', rating: null, version: 3, updatedAt: '2026-06-01T00:00:00.000Z' });
const oldBackup = { collections: { books: [{ ...rb, id: 'bk1', title: 'Old title', author: 'A', status: 'owned_unread', rating: null, version: 1, updatedAt: '2026-02-01T00:00:00.000Z' }] } };
importData(oldBackup); importData(oldBackup);
check('an older backup of an edited book adds no duplicate, even imported twice', books.length === 1 && books[0].title === 'Edited later', JSON.stringify(books.map((b) => b.title)));
importData({ collections: { books: [{ ...rb, id: 'bk1', title: 'Newer than local', author: 'A', status: 'owned_unread', rating: null, version: 1, updatedAt: '2026-09-01T00:00:00.000Z' }] } });
check('a genuinely newer backup copy is still kept (as a copy, nothing is lost)', books.length === 2 && books.some((b) => b.title === 'Newer than local'));

// ---- import refuses records that would break a screen ----
check('import refuses text fields that are not text', !isValidImportRecord('bills', { id: 'x', name: 5, amount: 5, dueDate: dk(1), frequency: 'monthly' }) && !isValidImportRecord('medications', { id: 'x', name: null }) && !isValidImportRecord('diagnoses', { id: 'x', condition: 'c' }) && !isValidImportRecord('recipes', { id: 'x', title: 't', ingredients: 'not a list' }) && !isValidImportRecord('books', { id: 'x', title: 't', status: 'nonsense' }) && !isValidImportRecord('todos', { id: 'x' }));
check('import still accepts normal records', isValidImportRecord('bills', { id: 'x', name: 'n', amount: 5, dueDate: dk(1), frequency: 'monthly' }) && isValidImportRecord('diagnoses', { id: 'x', condition: 'c', status: 'active' }) && isValidImportRecord('recipes', { id: 'x', title: 't', ingredients: ['a'], steps: [] }) && isValidImportRecord('notes', { id: 'x', title: '', body: 'b' }));

// ---- a damaged saved list cannot stop the app loading ----
localStorage.setItem('secondMemory.testlist.v1', JSON.stringify([null, 5, 'x', { id: 'ok' }, [1]]));
check('stray non-records in a saved list are dropped on load', loadCollection('secondMemory.testlist.v1').length === 1);
localStorage.removeItem('secondMemory.testlist.v1');

// ---- a refused book edit changes nothing ----
books.length = 0;
addBook('Original', 'Auth', 'owned_read');
const bk = books[0];
check('an edit with a future finished date is refused', updateBook(bk.id, { title: 'Changed', author: 'X', dateFinished: dk(9) }) === false);
check('...and the book is exactly as it was', bk.title === 'Original' && bk.author === 'Auth' && bk.dateFinished === todayKey());

// ---- a weight that rounds to zero is refused ----
check('0.04 lb is refused (it would be saved as 0.0)', !validateWeightFields({ date: dk(0), value: '0.04' }).ok && validateWeightFields({ date: dk(0), value: '0.05' }).ok === true && validateWeightFields({ date: dk(0), value: '0.05' }).weight === 0.1);

// ---- the shopping list gets the scaled amounts shown on the recipe card ----
recipes.length = 0; shoppingItems.length = 0;
recipes.push({ ...rb, id: 'rz1', title: 'Soup', category: '', ingredients: ['1 cup rice', '2 carrots'], steps: ['Boil'], notes: '' });
addRecipeToShoppingList(recipes[0], 2);
check('adding a 2x recipe to the shopping list uses the doubled amounts', shoppingItems.some((i) => i.item === '2 cups rice') && shoppingItems.some((i) => i.item === '4 carrots'), JSON.stringify(shoppingItems.map((i) => i.item)));
check('a recipe with no ingredient or step lists does not break search or the screen', (() => {
  recipes.push({ ...rb, id: 'rz2', title: 'Bare', category: '', notes: '' });
  nav('recipes'); renderRecipes();
  return matchesRecipeSearch(recipes[1], 'bare') === true;
})());
recipes.length = 0; renderRecipes();

// ---- repeating to-dos ----
check('a monthly task due on the 31st goes to the 28th and then back to the 31st (with the anchor kept)', nextRepeatDate('2999-01-31', 'monthly', 31) === '2999-02-28' && nextRepeatDate('2999-02-28', 'monthly', 31) === '2999-03-31');
check('the 31st anchor is remembered from one task to the next', (() => {
  todos.length = 0;
  addTodo('Rent', '2026-01-31', 'monthly');
  const t1 = todos[0];
  return repeatAnchorDay(t1) === 31 && (() => { t1.repeatDay = 31; t1.dueDate = '2026-02-28'; return repeatAnchorDay(t1) === 31; })() && (() => { t1.dueDate = '2026-02-10'; return repeatAnchorDay(t1) === 10; })();
})());
check('a daily task years overdue still comes due in the future', nextRepeatDate(dk(-1500), 'daily') === dk(1));
check('a weekly task years overdue keeps its weekday and is in the future', (() => { const n = nextRepeatDate(dk(-2000), 'weekly'); return n > todayKey() && n <= dk(7) && new Date(n + 'T00:00').getDay() === new Date(dk(-2000) + 'T00:00').getDay(); })());
todos.length = 0;
addTodo('Chore', dk(0), 'daily');
const chore = todos[0];
toggleTodoCompleted(chore.id, true);
const child = todos.find((t) => t.id === chore.spawnedId);
child.task = 'Chore (edited)'; child.updatedAt = new Date(Date.now() + 5000).toISOString();
toggleTodoCompleted(chore.id, false);
check('unticking keeps a next task you edited', !child.deleted && child.task === 'Chore (edited)');
todos.length = 0;
addTodo('Chore2', dk(0), 'daily');
toggleTodoCompleted(todos[0].id, true);
const untouched = todos.find((t) => t.id === todos[0].spawnedId);
toggleTodoCompleted(todos[0].id, false);
check('unticking still removes an untouched next task', untouched.deleted === true);

// ---- journal safety ----
journalEntries.length = 0; localStorage.removeItem('secondMemory.journalDeleted.v1');
journalEntries.push({ id: 'jd1', type: 'daily', date: dk(-2), answers: { on_mind: 'private' }, dateAdded: stamp, updatedAt: stamp });
saveJournalEntries();
const realConfirm = window.confirm; window.confirm = () => true;
deleteJournalEntry('jd1');
window.confirm = realConfirm;
check('a deleted journal entry is remembered as deleted', loadDeletedJournalIds().includes('jd1') && journalEntries.length === 0);
const brought = mergeJournalEntries([{ id: 'jd1', type: 'daily', date: dk(-2), answers: { on_mind: 'private' } }, { id: 'jd2', type: 'daily', date: dk(-3), answers: { on_mind: 'fine' } }]);
check('restoring a backup does not bring back a deleted entry (others still restore)', brought === 1 && !journalEntries.some((e) => e.id === 'jd1') && journalEntries.some((e) => e.id === 'jd2'));
check('journal entries with non-text answers are refused on restore', !isValidJournalEntry({ id: 'z', type: 'daily', date: dk(0), answers: { on_mind: { a: 1 } } }) && isValidJournalEntry({ id: 'z', type: 'daily', date: dk(0), answers: { on_mind: 'ok', day_rating: 4 } }));
// skip keeps typed text
nav('journal');
openJournalWizard('daily');
journalDraft.step = 1; renderJournalStep();
document.querySelector('#journal-answer textarea').value = 'typed before skipping';
$('journal-skip-btn').click();
check('Skip keeps what was already typed', journalDraft.answers.on_mind === 'typed before skipping');
$('journal-cancel-btn').click();
// an entry deleted while being edited is saved again, not lost
journalEntries.length = 0;
journalEntries.push({ id: 'je1', type: 'daily', date: dk(-1), answers: { on_mind: 'first' }, dateAdded: stamp, updatedAt: stamp });
openJournalWizard('daily', journalEntries[0]);
journalEntries.length = 0;
journalDraft.answers.on_mind = 'edited while deleted';
finishJournalEntry();
check('editing an entry that was deleted meanwhile saves it again instead of losing the text', journalEntries.length === 1 && journalEntries[0].answers.on_mind === 'edited while deleted' && journalEntries[0].id === 'je1');
journalEntries.length = 0; saveJournalEntries(); renderJournal();
journalEntries.push({ id: 't1', type: 'therapy', date: dk(-1), answers: { topics: 'a' } }, { id: 't2', type: 'therapy', date: dk(-1), answers: { topics: 'b' }, dateAdded: stamp });
check('two same-day sessions, one without a saved time, sort without error', therapySessions(5).length === 2);
journalEntries.length = 0;

// ---- money ----
bills.length = 0;
check('an amount is rounded to whole cents', validateBillFields({ name: 'x', amount: '19.999', dueDate: dk(1), frequency: 'monthly', category: '' }).amount === 20);
check('an amount that rounds to $0.00 is refused', !validateBillFields({ name: 'x', amount: '0.001', dueDate: dk(1), frequency: 'monthly', category: '' }).ok);
check('an absurd amount is refused', !validateBillFields({ name: 'x', amount: '1e21', dueDate: dk(1), frequency: 'monthly', category: '' }).ok && !validateRecurringIncomeFields({ name: 'x', amount: '5000000000', dueDate: dk(1), frequency: 'biweekly', category: '' }).ok);
// payments stay in paid history when a bill's schedule changes
addBill({ name: 'Gym', amount: '100', dueDate: '2026-01-01', frequency: 'monthly', category: 'Health', autopay: false });
const gym = bills[0];
gym.paidDates = ['2026-01-01', '2026-02-01', '2026-03-01'];
updateBill(gym.id, { name: 'Gym', amount: '100', dueDate: '2026-01-01', frequency: 'one_time', category: 'Health', autopay: false });
const paidFeb = computePaidByCategory(bills.filter((b) => !b.deleted), 2026, 1);
check('changing a bill to one-time does not make earlier payments vanish from paid history', paidFeb.length === 1 && paidFeb[0].total === 100, JSON.stringify(paidFeb));
// duplicate paid dates never undercount what is owed
bills.length = 0;
addBill({ name: 'Water', amount: '30', dueDate: dk(-10), frequency: 'one_time', category: '', autopay: false });
bills[0].paidDates = [dk(-10), dk(-10)];
check('the same payment listed twice is counted once', unpaidAmountThrough(bills[0], todayKey()) === 0);
// autopay bills are not "overdue"
bills.length = 0;
addBill({ name: 'Auto', amount: '10', dueDate: dk(-3), frequency: 'one_time', category: '', autopay: true });
addBill({ name: 'Manual', amount: '10', dueDate: dk(-3), frequency: 'one_time', category: '', autopay: false });
const homeBills = computeHomeBills(bills.filter((b) => !b.deleted));
check('a past-due autopay bill is not listed as overdue, a manual one still is', homeBills.overdue.length === 1 && homeBills.overdue[0].bill.name === 'Manual');
// income: a clear is never undone by an older duplicate, and clearing removes copies
income.length = 0;
const inc = (id, dateKey, amount, updatedAt, deleted) => ({ id, dateKey, amount, dateAdded: old, updatedAt, deviceId: 'x', deleted: !!deleted, version: 1 });
income.push(inc('2026-10-01', '2026-10-01', 50, '2026-10-01T10:00:00.000Z', false), inc('copy-1', '2026-10-01', 70, '2026-10-03T10:00:00.000Z', true));
check('a newer cleared record hides an older live duplicate for the date', uniqueIncomeByDate(income).filter((r) => !r.deleted).length === 0);
income.length = 0;
income.push(inc('2026-10-02', '2026-10-02', 20, old, false), inc('clone-2', '2026-10-02', 25, '2026-10-03T00:00:00.000Z', false));
setIncomeForDate('2026-10-02', '');
check('clearing a day clears every live record for it', income.filter((r) => r.dateKey === '2026-10-02' && !r.deleted).length === 0);
income.length = 0;

// ---- diagnoses with a missing status still show up ----
diagnoses.length = 0;
diagnoses.push({ ...rb, id: 'dg1', condition: 'Odd one', dateDiagnosed: null, provider: '', notes: '' });
nav('diagnoses'); renderDiagnoses();
check('a diagnosis with no status appears under Active', [...document.querySelectorAll('[data-diagnosis-list="active"] .diagnosis-card')].length === 1);
$('health-summary-btn') && nav('home');
check('and the health summary handles it', (() => { try { buildHealthSummaryData(); return true; } catch { return false; } })());
diagnoses.length = 0;

// ---- app lock ----
localStorage.removeItem('secondMemory.lockTries.v1');
await setAppLock('8642');
lockNow();
lockFailures = 0; lockBlockedUntil = 0;
for (let i = 0; i < 5; i++) { set('lock-pin-input', '0000'); $('lock-form').requestSubmit(); await sleep(250); }
const savedTries = JSON.parse(localStorage.getItem('secondMemory.lockTries.v1') || 'null');
check('the wrong-try pause is saved, so reloading the page cannot skip it', savedTries && savedTries.until > Date.now());
lockBlockedUntil = 0; lockFailures = 0; saveLockTries();
set('lock-pin-input', '8642'); $('lock-form').requestSubmit(); await sleep(400);
check('the right PIN unlocks and resets the saved tries', !document.documentElement.hasAttribute('data-locked') && JSON.parse(localStorage.getItem('secondMemory.lockTries.v1')).fails === 0);
nav('home');
$('health-summary-btn').click();
lockNow();
check('locking closes the health summary so it cannot be read or printed', $('health-summary').hidden && !document.body.classList.contains('summary-open'));
set('lock-pin-input', '8642'); $('lock-form').requestSubmit(); await sleep(400);
clearAppLock();
