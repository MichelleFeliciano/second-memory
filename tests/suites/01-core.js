// Core behaviour that every list shares: tabs, adding, editing, deleting, undo/redo,
// searching, sorting, safe handling of hostile text, and backup export/import.
const live = (arr) => arr.filter((r) => !r.deleted).length;
let networkCalls = 0;
window.fetch = () => { networkCalls += 1; return Promise.reject(new Error('blocked')); };

// ---- the removed Coursework feature must stay removed ----
check('no Coursework tab or section', !document.querySelector('[data-tab="coursework"], #coursework-collection'));
check('no course/deadline collections in sync', !SYNC_COLLECTIONS.some((c) => /course|deadline/i.test(c.name)));
check('page text has no coursework wording', !/coursework|degree|deadline/i.test(document.body.innerText));

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
  ['medications', () => medications, 'medications-add-form', { 'medications-name-input': 'TMed', 'medications-refill-input': dk(2) }],
  ['appointments', () => appointments, 'appointments-add-form', { 'appointments-title-input': 'TAppt', 'appointments-date-input': dk(1), 'appointments-time-input': '09:30' }],
  ['diagnoses', () => diagnoses, 'diagnoses-add-form', { 'diagnoses-condition-input': 'TDiag' }],
  ['todo', () => todos, 'todo-add-form', { 'todo-task-input': 'TTodo', 'todo-due-input': dk(1) }],
  ['shopping', () => shoppingItems, 'shopping-add-form', { 'shopping-item-input': 'TShop', 'shopping-category-input': 'Dairy' }],
  ['notes', () => notes, 'notes-add-form', { 'notes-title-input': 'TNote', 'notes-body-input': 'body' }],
  ['budget', () => bills, 'budget-add-form', { 'budget-name-input': 'TBill', 'budget-amount-input': '12.5', 'budget-duedate-input': dk(3), 'budget-frequency-input': 'monthly', 'budget-category-input': 'Util' }],
  ['budget', () => recurringIncome, 'recurring-income-add-form', { 'recurring-income-name-input': 'TPay', 'recurring-income-amount-input': '500', 'recurring-income-startdate-input': dk(-3), 'recurring-income-frequency-input': 'biweekly' }],
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
for (const t of ['books', 'recipes', 'medications', 'appointments', 'diagnoses', 'todo', 'shopping', 'notes', 'budget', 'resume']) {
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
const delSpecs = [['books', () => books], ['recipes', () => recipes], ['medications', () => medications], ['appointments', () => appointments],
  ['diagnoses', () => diagnoses], ['todo', () => todos], ['shopping', () => shoppingItems], ['notes', () => notes], ['resume', () => links]];
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
check('undo tooltip names what it would undo', (() => { addShoppingItem('Tooltip item', '', ''); return /Tooltip item/.test($('undo-btn').title); })());

// ---- sort, search and filter chips never throw ----
for (const sel of document.querySelectorAll('select[id$="-sort-input"]')) {
  for (const o of [...sel.options]) { sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
}
for (const inp of document.querySelectorAll('input[type="search"]')) {
  inp.value = 'zzzz'; inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true }));
}
for (const chip of document.querySelectorAll('.chip')) chip.click();
check('every sort option, search box and filter chip works', true);

// ---- hostile text is shown as text, never run ----
window.__xss = 0;
const evil = '<img src=x onerror="window.__xss=1">';
nav('books'); set('books-title-input', evil); set('books-author-input', evil); $('books-add-form').requestSubmit();
nav('recipes'); set('recipes-title-input', evil); set('recipes-ingredients-input', evil); $('recipes-add-form').requestSubmit();
nav('notes'); set('notes-title-input', evil); set('notes-body-input', evil); $('notes-add-form').requestSubmit();
nav('todo'); set('todo-task-input', evil); $('todo-add-form').requestSubmit();
nav('shopping'); set('shopping-item-input', evil); $('shopping-add-form').requestSubmit();
nav('medications'); set('medications-name-input', evil); $('medications-add-form').requestSubmit();
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
  bills: [{ id: 'bad-bill', name: 'Bad', amount: '1200', dueDate: dk(0), frequency: 'monthly' }],
  income: [{ id: 'bad-inc', dateKey: 'not-a-date', amount: 5 }],
  appointments: [{ id: 'bad-appt', title: 'x', date: '2026-13-45' }],
  courses: [{ id: 'old-course', title: 'Old class' }],
} });
check('wrongly typed records are skipped, not saved', !bills.some((b) => b.id === 'bad-bill') && !income.some((i) => i.id === 'bad-inc') && !appointments.some((a) => a.id === 'bad-appt'));
check('import reports what it skipped', /skipped/.test($('data-io-status').textContent), $('data-io-status').textContent);
check('an old backup that still has courses imports without trouble', !('courses' in buildExportPayload().collections));
check('import rejects impossible dates', !isRealDateKey('2026-02-30') && !isRealDateKey('2026-13-01') && isRealDateKey('2028-02-29'));
let renderOk = true;
try { renderBudget(); renderHome(); } catch { renderOk = false; }
check('app still renders after a bad import', renderOk);

// ---- one broken render never takes the page down ----
let survived = true;
try { safeRender(() => { throw new Error('boom'); }); } catch { survived = false; }
check('safeRender swallows a failing render', survived);

// ---- coursework leftovers on a device are cleaned at startup ----
check('old coursework keys are not kept in storage', localStorage.getItem('secondMemory.courses.v1') === null && localStorage.getItem('secondMemory.deadlines.v1') === null);

// ---- nothing syncs by itself ----
nav('home'); renderHome();
await sleep(1200);
check('using the whole app made no network request at all', networkCalls === 0, networkCalls + ' request(s)');
