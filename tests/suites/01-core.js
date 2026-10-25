// Core behaviour that every list shares: tabs, adding, editing, deleting, undo/redo,
// searching, sorting, safe handling of hostile text, and backup export/import.
const live = (arr) => arr.filter((r) => !r.deleted).length; // records still showing (not tombstoned)
let networkCalls = 0; // counted by the stub below and checked at the very end
window.fetch = () => { networkCalls += 1; return Promise.reject(new Error('blocked')); };

// ---- the removed Coursework feature must stay removed ----
check('no Coursework tab or section', !document.querySelector('[data-tab="coursework"], #coursework-collection'));
check('no course/deadline collections in sync', !SYNC_COLLECTIONS.some((c) => /course|deadline/i.test(c.name)));
check('no Appointments tab or section, and none in sync', !document.querySelector('[data-tab="appointments"], #appointments-collection') && !SYNC_COLLECTIONS.some((c) => c.name === 'appointments'));
check('page text has no coursework wording', !/coursework|degree|deadline/i.test(document.body.innerText));

// ---- Budget moved to its own app and must stay out of this one ----
check('no Budget tab, section, banner or sync lists', !document.querySelector('[data-tab="budget"], #budget-collection, #reminder-banner, #home-bills-panel, #budget-card-template, #recurring-income-card-template') && !TABS.includes('budget')
  && SYNC_COLLECTIONS.length === 4 && !SYNC_COLLECTIONS.some((c) => ['bills', 'income', 'recurringIncome'].includes(c.name)), SYNC_COLLECTIONS.map((c) => c.name).join());
check('a Second Memory export has no bills, income or recurring income', (() => { const keys = Object.keys(buildExportPayload().collections); return keys.length === 4 && !keys.includes('bills') && !keys.includes('income') && !keys.includes('recurringIncome') && !('paydaySettings' in buildExportPayload().local); })());

// ---- every tab opens exactly its own section ----
for (const t of TABS) {
  nav(t);
  const visible = [...document.querySelectorAll('main .collection')].filter((s) => !s.hidden).map((s) => s.id);
  check('tab "' + t + '" shows only its section', visible.length === 1 && visible[0] === t + '-collection', visible.join(','));
}
check('an unknown saved tab falls back to Home', (() => { setActiveTab('coursework'); return !$('home-collection').hidden; })());

// ---- add one record to every list through its real form ----
const specs = [
  ['books', () => books, 'books-add-form', { 'books-title-input': 'TBook', 'books-author-input': 'Auth' }],
  ['recipes', () => recipes, 'recipes-add-form', { 'recipes-title-input': 'TRecipe', 'recipes-ingredients-input': 'a\nb', 'recipes-steps-input': '1\n2' }],
  ['notes', () => notes, 'notes-add-form', { 'notes-title-input': 'TNote', 'notes-body-input': 'body' }],
  ['resume', () => links, 'resume-add-form', { 'resume-label-input': 'TLink', 'resume-url-input': 'example.com' }],
];
for (const [tab, arr, form, fill] of specs) {
  nav(tab);
  const before = live(arr());
  Object.entries(fill).forEach(([id, v]) => set(id, v));
  $(form).requestSubmit();
  await sleep(30);
  check('add through ' + form, live(arr()) === before + 1, before + ' -> ' + live(arr()));
}

// ---- edit: open, cancel, save closes the form and keeps the data ----
for (const t of ['books', 'recipes', 'notes', 'resume']) {
  nav(t);
  const sec = $(t + '-collection');
  const openForm = () => [...sec.querySelectorAll('form')].find((f) => !f.hidden && /edit-form/.test(f.className));
  sec.querySelector('.edit-btn').click();
  check(t + ': Edit opens a form', !!openForm());
  if (!openForm()) continue;
  openForm().querySelector('.cancel-btn').click();
  check(t + ': Cancel closes it', !openForm());
  sec.querySelector('.edit-btn').click();
  openForm().requestSubmit();
  await sleep(30);
  check(t + ': Save closes it', !openForm());
}

// ---- delete, undo, redo ----
const delSpecs = [['books', () => books], ['recipes', () => recipes], ['notes', () => notes], ['resume', () => links]];
for (const [t, arr] of delSpecs) {
  nav(t);
  const before = live(arr());
  $(t + '-collection').querySelector('.delete-btn').click(); await sleep(20);
  const afterDelete = live(arr());
  $('undo-btn').click(); await sleep(20);
  const afterUndo = live(arr());
  $('redo-btn').click(); await sleep(20);
  const afterRedo = live(arr());
  $('undo-btn').click(); await sleep(20);
  check(t + ': delete, undo, redo, undo', afterDelete === before - 1 && afterUndo === before && afterRedo === before - 1 && live(arr()) === before,
    [before, afterDelete, afterUndo, afterRedo, live(arr())].join(' > '));
}
check('undo tooltip names what it would undo', (() => { addNote('Tooltip item', 'body'); return /Tooltip item/.test($('undo-btn').title); })());

// ---- sort, search and filter chips never throw ----
// No check() here on purpose: a throw would crash the suite (reported as "suite crashed"), and the
// runner adds a "no uncaught errors" check for anything thrown inside event handlers.
for (const sel of document.querySelectorAll('select[id$="-sort-input"]')) {
  for (const o of [...sel.options]) { sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
}
for (const inp of document.querySelectorAll('input[type="search"]')) {
  inp.value = 'zzzz'; inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true }));
}
for (const chip of document.querySelectorAll('.chip')) chip.click();

// ---- hostile text is shown as text, never run ----
window.__xss = 0;
const evil = '<img src=x onerror="window.__xss=1">';
nav('books'); set('books-title-input', evil); set('books-author-input', evil); $('books-add-form').requestSubmit();
nav('recipes'); set('recipes-title-input', evil); set('recipes-ingredients-input', evil); $('recipes-add-form').requestSubmit();
nav('notes'); set('notes-title-input', evil); set('notes-body-input', evil); $('notes-add-form').requestSubmit();
nav('home'); await sleep(200);
check('hostile text does not run', window.__xss === 0);
check('hostile text does not become page elements', document.querySelectorAll('img[src="x"]').length === 0);
check('javascript: links are not clickable as scripts', !/^javascript:/i.test(hrefFor('javascript:alert(1)')) && !/^data:/i.test(hrefFor('data:text/html,x')));
check('plain links keep working', hrefFor('https://a.com/x') === 'https://a.com/x' && hrefFor('example.com') === 'https://example.com' && hrefFor('mailto:a@b.com') === 'mailto:a@b.com' && hrefFor('localhost:3000') === 'https://localhost:3000');

// ---- blank titles are rejected without wiping what was typed ----
nav('books');
const booksBefore = live(books);
set('books-title-input', '   '); set('books-author-input', 'KeepMe'); $('books-add-form').requestSubmit(); await sleep(30);
check('blank book title adds nothing', live(books) === booksBefore);
check('blank book title keeps the other typed fields', $('books-author-input').value === 'KeepMe');

// ---- backup export / import ----
const payload = JSON.parse(JSON.stringify(buildExportPayload()));
const counts = () => SYNC_COLLECTIONS.map((c) => c.name + ':' + c.get().length).join(',');
const before = counts();
importData(payload); importData(payload);
check('importing your own export twice changes nothing', counts() === before);
const victim = books.find((b) => !b.deleted);
deleteBook(victim.id);
importData(JSON.parse(JSON.stringify(payload)));
check('an older backup never brings back a deleted record', books.find((b) => b.id === victim.id).deleted === true);
importData({ collections: {
  bills: [{ id: 'old-bill', name: 'Old bill', amount: 5, dueDate: dk(0), frequency: 'monthly', paidDates: [], dateAdded: 'x', updatedAt: 'x', deviceId: 'x', deleted: false, version: 1 }],
  income: [{ id: dk(0), dateKey: dk(0), amount: 5, dateAdded: 'x', updatedAt: 'x', deviceId: 'x', deleted: false, version: 1 }],
  recurringIncome: [{ id: 'old-ri', name: 'Pay', amount: 5, dueDate: dk(0), frequency: 'weekly', dateAdded: 'x', updatedAt: 'x', deviceId: 'x', deleted: false, version: 1 }],
  appointments: [{ id: 'old-appt', title: 'Old appointment', date: dk(2) }],
  courses: [{ id: 'old-course', title: 'Old class' }],
} });
check('lists that are no longer in the app are ignored and never stored', typeof appointments === 'undefined' && typeof bills === 'undefined' && typeof income === 'undefined' && typeof recurringIncome === 'undefined' && !JSON.stringify(buildExportPayload()).includes('old-bill') && !localStorage.getItem('secondMemory.bills.v1'));
check('an old backup that still has courses imports without trouble', !('courses' in buildExportPayload().collections));
check('import rejects impossible dates', !isRealDateKey('2026-02-30') && !isRealDateKey('2026-13-01') && isRealDateKey('2028-02-29'));
let renderOk = true;
try { renderHome(); } catch { renderOk = false; }
check('app still renders after a bad import', renderOk);

// ---- lists that moved to other apps are kept, shown nowhere, exported and imported ----
const oldRecord = (extra) => ({ dateAdded: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deviceId: 'x', deleted: false, version: 1, ...extra });
const RETIRED_SAMPLE = {
  todos: [oldRecord({ id: 'r-todo', task: 'Old to-do', completed: false, dueDate: dk(1), repeat: 'weekly' })],
  shoppingList: [oldRecord({ id: 'r-shop', item: 'Old item', quantity: '2', category: 'Dairy', checked: false })],
  medications: [oldRecord({ id: 'r-med', name: 'Old med', kind: 'equipment', refillDate: dk(3), refillEveryDays: 90 })],
  diagnoses: [oldRecord({ id: 'r-dx', condition: 'Old condition' })],
  weights: [oldRecord({ id: 'r-wt', date: dk(-1), weight: 150.5 })],
};
check('no retired list is a tab, a section or part of syncing', RETIRED_LISTS.every((r) => !SYNC_COLLECTIONS.some((c) => c.name === r.name)) && !document.querySelector('#todo-collection, #shopping-collection, #medications-collection, #diagnoses-collection, #weight-collection, #calendar-collection'));
check('nothing is held for them to begin with', RETIRED_LISTS.every((r) => readRetiredList(r.key).length === 0) && !('todos' in buildExportPayload().collections));
updateMovedCard();
check('with nothing held, there is no "lists moved" notice', $('moved-card').hidden);
importData({ collections: RETIRED_SAMPLE, local: { weightGoal: 140 } });
check('importing an older export keeps every retired list on this device', RETIRED_LISTS.every((r) => readRetiredList(r.key).length === 1 && readRetiredList(r.key)[0].id === RETIRED_SAMPLE[r.name][0].id));
check('the stored records are exactly as they were (nothing dropped or reshaped)', RETIRED_LISTS.every((r) => JSON.stringify(readRetiredList(r.key)) === JSON.stringify(RETIRED_SAMPLE[r.name])));
check('the weight goal is kept', readRetiredWeightGoal() === 140);
check('a device that holds moved lists shows the notice on Home, naming the apps and offering Export', !$('moved-card').hidden && /Petalkeeper/.test($('moved-card').textContent) && /MealMate/.test($('moved-card').textContent) && /Caregiver/.test($('moved-card').textContent) && !!$('moved-export'));
$('moved-dismiss').click();
check('Got it hides the notice and remembers', $('moved-card').hidden && localStorage.getItem('secondMemory.movedNoticeSeen.v1') === '1');
const keptExport = JSON.parse(JSON.stringify(buildExportPayload()));
check('an export carries the retired lists in the same place as before, so the other apps can read it', RETIRED_LISTS.every((r) => keptExport.collections[r.name] && keptExport.collections[r.name][0].id === RETIRED_SAMPLE[r.name][0].id) && keptExport.local.weightGoal === 140);
importData(keptExport); importData(keptExport);
check('importing that export again changes nothing', RETIRED_LISTS.every((r) => JSON.stringify(readRetiredList(r.key)) === JSON.stringify(RETIRED_SAMPLE[r.name])));
const edited = JSON.parse(JSON.stringify(keptExport));
edited.collections.todos[0].task = 'Old to-do (edited elsewhere)'; edited.collections.todos[0].updatedAt = '2026-02-01T00:00:00.000Z'; edited.collections.todos[0].version = 2;
edited.collections.todos.push(oldRecord({ id: 'r-todo-2', task: 'Second to-do', completed: true }));
edited.local.weightGoal = 99;
importData(edited);
check('a newer copy updates a held record and a new record is added', readRetiredList(RETIRED_LISTS[0].key).length === 2 && readRetiredList(RETIRED_LISTS[0].key)[0].task.includes('edited elsewhere'));
check('an imported weight goal never replaces the one already here', readRetiredWeightGoal() === 140);
importData({ collections: { todos: [{ id: '', task: 'no id' }, null, 5] } });
check('records with no id are skipped, not stored', readRetiredList(RETIRED_LISTS[0].key).length === 2);
check('the held lists never reach the screen', !/Old to-do|Old item|Old med|Old condition/.test(document.body.innerText));
check('the searchable lists no longer include them', runGlobalSearch('Old', false).every((g) => !/Medication|Diagnos|To-Do|Shopping/.test(g.source.label)));

// ---- one broken render never takes the page down ----
let survived = true;
try { safeRender(() => { throw new Error('boom'); }); } catch { survived = false; }
check('safeRender swallows a failing render', survived);

// ---- nothing syncs by itself ----
// Proves the app never touched the network during everything above (fetch was replaced at the top).
nav('home'); renderHome();
await sleep(1200);
check('using the whole app made no network request at all', networkCalls === 0, networkCalls + ' request(s)');
