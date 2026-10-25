// Regression tests for bugs found in the whole-code review: each check fails if its bug comes back.
const stamp = new Date().toISOString();
const old = '2026-01-01T00:00:00.000Z'; // an old save time, so edits made "now" are clearly newer
// the sync fields every record carries; spread into each sample record below
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
check('import refuses text fields that are not text', !isValidImportRecord('recipes', { id: 'x', title: null }) && !isValidImportRecord('recipes', { id: 'x', title: 't', ingredients: 'not a list' }) && !isValidImportRecord('books', { id: 'x', title: 't', status: 'nonsense' }) && !isValidImportRecord('notes', { id: 'x', title: 5 }));
check('import still accepts normal records', isValidImportRecord('recipes', { id: 'x', title: 't', ingredients: ['a'], steps: [] }) && isValidImportRecord('notes', { id: 'x', title: '', body: 'b' }));

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

// ---- a recipe with no lists ----
recipes.length = 0;
check('a recipe with no ingredient or step lists does not break search or the screen', (() => {
  recipes.push({ ...rb, id: 'rz1', title: 'Other', category: '', notes: '' });
  recipes.push({ ...rb, id: 'rz2', title: 'Bare', category: '', notes: '' });
  nav('recipes'); renderRecipes();
  return matchesRecipeSearch(recipes[1], 'bare') === true;
})());
recipes.length = 0; renderRecipes();

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

// ---- app lock ----
const idle = async () => { for (let i = 0; i < 80 && lockChecking; i++) await sleep(50); await sleep(40); }; // wait for a PIN check to finish (it takes longer on a slow phone)
localStorage.removeItem('secondMemory.lockTries.v1');
await setAppLock('8642');
lockNow();
lockFailures = 0; lockBlockedUntil = 0;
for (let i = 0; i < 5; i++) { set('lock-pin-input', '0000'); $('lock-form').requestSubmit(); await idle(); }
const savedTries = JSON.parse(localStorage.getItem('secondMemory.lockTries.v1') || 'null');
check('the wrong-try pause is saved, so reloading the page cannot skip it', savedTries && savedTries.until > Date.now());
lockBlockedUntil = 0; lockFailures = 0; saveLockTries();
set('lock-pin-input', '8642'); $('lock-form').requestSubmit(); await idle();
check('the right PIN unlocks and resets the saved tries', !document.documentElement.hasAttribute('data-locked') && JSON.parse(localStorage.getItem('secondMemory.lockTries.v1')).fails === 0);
nav('journal');
$('therapy-summary-btn').click();
lockNow();
check('locking closes the therapy summary so it cannot be read or printed', $('therapy-summary').hidden && !document.body.classList.contains('summary-open'));
set('lock-pin-input', '8642'); $('lock-form').requestSubmit(); await idle();
clearAppLock();
