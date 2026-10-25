// Regression tests for the second and third reviews and the v71-v76 features: each check fails if its bug comes back.
const tt = new Date().toISOString();
const r2 = { dateAdded: tt, updatedAt: tt, deviceId: 'test', deleted: false, version: 0 };

// ---- links ----
check('a bare email address becomes a mail link', hrefFor('me@site.com') === 'mailto:me@site.com');
check('web addresses and script-looking text are still safe', hrefFor('example.com') === 'https://example.com' && hrefFor('javascript:alert(1)') === 'https://javascript:alert(1)' && hrefFor('https://a.b/c') === 'https://a.b/c');


// ---- edit forms for records with missing fields ----
recipes.length = 0; books.length = 0;
recipes.push({ ...r2, id: 'rx1', title: 'Bare recipe' });
books.push({ ...r2, id: 'bx1', title: 'Bare book', status: 'owned_unread', rating: null });
nav('recipes'); renderRecipes();
let opened = true;
try { document.querySelector('#recipes-list .edit-btn').click(); } catch { opened = false; }
check('Edit opens for a recipe with no ingredients, steps, category or notes (and shows no "undefined")', opened && !document.querySelector('#recipes-list .recipe-edit-form').hidden && document.querySelector('#recipes-list .recipe-edit-notes').value === '' && document.querySelector('#recipes-list .recipe-edit-category').value === '');
nav('books'); renderBooks();
document.querySelector('#books-collection .book-card .edit-btn').click();
check('Edit opens for a book with no author, and searching for "undefined" does not match it', document.querySelector('#books-collection .book-edit-author').value === '' && matchesBookSearch(books[0], 'undefined') === false);
recipes.length = 0; books.length = 0;

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


// ---- recipes: the add form is a dropdown ----
recipes.length = 0;
for (let i = 0; i < 3; i++) recipes.push({ ...r2, id: 'rc' + i, title: 'Recipe ' + i, category: '', ingredients: [], steps: [], notes: '' });
nav('recipes'); renderRecipes(); await sleep(50);
const addBox = $('recipes-add-details');
check('the recipe form sits in a dropdown that starts closed', addBox.tagName === 'DETAILS' && !addBox.open && addBox.contains($('recipes-add-form')));
check('recipes are an ordinary list, one card under another', document.querySelectorAll('#recipes-list > .recipe-card').length === 3 && getComputedStyle($('recipes-list')).overflowX !== 'auto');
set('recipes-title-input', 'Brand new'); addBox.open = true; $('recipes-add-form').requestSubmit(); await sleep(50);
check('adding a recipe closes the dropdown again', !addBox.open && recipes.some((r) => r.title === 'Brand new'));
recipes.length = 0; renderRecipes();

// ---- friendlier app: undo toast, phone bottom bar, empty-state buttons, text size ----
notes.length = 0;
addNote('Toast me', 'body');
const toastNote = notes[0];
deleteNote(toastNote.id);
check('deleting shows a toast with an Undo button', !$('toast').hidden && /Toast me/.test($('toast-text').textContent) && !$('toast-undo').hidden, $('toast-text').textContent);
$('toast-undo').click(); await sleep(30);
check('the toast Undo brings the item back and hides the toast', notes.find((t) => t.id === toastNote.id).deleted === false && $('toast').hidden);
addNote('Second', 'body');
check('adding something clears an old toast', $('toast').hidden);
notes.length = 0; renderNotes();

nav('recipes');
check('the bottom bar marks the current screen', document.querySelector('.bottom-bar [data-quick-tab="recipes"]').getAttribute('aria-current') === 'page' && !document.querySelector('.bottom-bar [data-quick-tab="home"]').hasAttribute('aria-current'));
document.querySelector('.bottom-bar [data-quick-tab="notes"]').click();
check('a bottom bar button switches screen', !$('notes-collection').hidden && $('home-collection').hidden);
check('the bottom bar no longer offers the screens that moved out', !document.querySelector('.bottom-bar [data-quick-tab="todo"], .bottom-bar [data-quick-tab="shopping"]'));

books.length = 0; renderBooks();
const emptyBtn = document.querySelector('#books-empty-state .empty-state-add');
check('an empty screen offers an Add one now button', !!emptyBtn);
emptyBtn.click();
check('it opens the add form', document.querySelector('#books-collection details.add-dropdown').open);



$('text-size-btn').click();
check('Text size cycles to Large', document.documentElement.getAttribute('data-text') === 'large' && /Large/.test($('text-size-btn').textContent));
$('text-size-btn').click(); $('text-size-btn').click();
check('and back to Normal', !document.documentElement.hasAttribute('data-text') && /Normal/.test($('text-size-btn').textContent));



$('contrast-btn').click();
check('Contrast switches to High', document.documentElement.getAttribute('data-contrast') === 'high' && /High/.test($('contrast-btn').textContent));
$('contrast-btn').click();
check('and back to Normal', !document.documentElement.hasAttribute('data-contrast') && /Normal/.test($('contrast-btn').textContent));


// ---- v76: wake the sync server, snooze, shopping groups and share, swipe, customise Home ----
{
  // wake-up poke: only when sync is set up, and only once in ten minutes
  const pokes = [];
  const realFetch = window.fetch;
  window.fetch = (url, opts) => { pokes.push([String(url), opts && opts.mode]); return Promise.resolve(new Response('')); };
  lastWakeAt = 0;
  const hadConfig = localStorage.getItem(SYNC_CONFIG_KEY);
  localStorage.removeItem(SYNC_CONFIG_KEY);
  wakeSyncServer();
  check('no wake-up request when sync is not set up', pokes.length === 0);
  saveSyncConfig({ token: 'test-pass' });
  wakeSyncServer();
  check('with sync set up the server gets a plain no-cors request with no passphrase', pokes.length === 1 && /onrender\.com\/$/.test(pokes[0][0]) && pokes[0][1] === 'no-cors');
  wakeSyncServer();
  check('and is not poked again within ten minutes', pokes.length === 1);
  window.fetch = realFetch;
  if (hadConfig) localStorage.setItem(SYNC_CONFIG_KEY, hadConfig); else localStorage.removeItem(SYNC_CONFIG_KEY);
  check('a failed sync says when the last good one was', (() => { recordBackupTime(LAST_SYNC_AT_KEY); return / Last synced today\./.test(lastSyncNote()); })());
}

// customise Home
books.length = 0;
books.push({ ...r2, id: 'cr1', title: 'Reading now', author: 'A', status: 'currently_reading', rating: null });
nav('home'); renderBooks(); renderHome();
check('Customize Home has a checkbox for the one panel left, on', document.querySelectorAll('#home-customize-list input').length === 1 && [...document.querySelectorAll('#home-customize-list input')].every((c) => c.checked));
check('the Currently reading panel shows before it is switched off', !$('home-reading-panel').hidden && /Reading now/.test($('home-reading-list').textContent));
const readingBox = [...document.querySelectorAll('#home-customize-list label')].find((l) => /Currently reading/.test(l.textContent)).querySelector('input');
readingBox.click();
check('unticking a panel hides it', $('home-reading-panel').hidden && loadHiddenHomePanels().has('home-reading-panel'));
readingBox.click();
check('ticking it again brings it back', !$('home-reading-panel').hidden);
localStorage.setItem(HOME_PANELS_KEY, 'garbage');
check('a damaged Home setting switches nothing off', loadHiddenHomePanels().size === 0);
localStorage.setItem(HOME_PANELS_KEY, JSON.stringify(['home-todo-panel', 'home-weigh-panel', 'home-reading-panel']));
check('panels that moved out of this app are quietly forgotten from an old Home setting', loadHiddenHomePanels().size === 1 && loadHiddenHomePanels().has('home-reading-panel'));
localStorage.removeItem(HOME_PANELS_KEY);
books.length = 0; renderBooks(); renderHome();
check('with nothing to show, Home says everything is caught up', !$('home-empty-state').hidden && $('home-stats').hidden);

// ---- Update now button and the new-version banner ----
{
  const realReload = window.reloadApp;
  let reloads = 0;
  window.reloadApp = () => { reloads += 1; };
  const realSW = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
  const fakeSW = (registration) => Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: async () => registration, addEventListener() {}, controller: null } });
  const status = () => $('update-status').textContent;

  fakeSW(undefined);
  $('update-now-btn').click(); await sleep(30);
  check('with no offline install, Update now simply reloads', reloads === 1);

  fakeSW({ update: async () => {}, installing: null, waiting: null });
  $('update-now-btn').click(); await sleep(30);
  check('with nothing new it says you have the latest version and does not reload', reloads === 1 && new RegExp('latest version \\(' + APP_VERSION + '\\)').test(status()), status());

  const worker = { state: 'installing', _cb: null, addEventListener(type, cb) { this._cb = cb; } };
  fakeSW({ update: async () => {}, installing: worker, waiting: null });
  $('update-now-btn').click(); await sleep(30);
  check('a new version downloading is waited for', reloads === 1 && /Downloading/.test(status()), status());
  worker.state = 'activated'; worker._cb(); await sleep(30);
  check('once the new version takes over the app reloads', reloads === 2 && /Reloading/.test(status()), status());

  fakeSW({ update: async () => { throw new Error('offline'); }, installing: null, waiting: null });
  $('update-now-btn').click(); await sleep(30);
  check('when the check fails it says so and does not reload', reloads === 2 && /Couldn't check/.test(status()), status());

  check('the banner starts hidden', $('update-banner').hidden === true);
  noteNewVersionReady();
  check('a new version arriving behind the page shows the banner', $('update-banner').hidden === false);
  $('update-banner-btn').click();
  check('the banner button reloads', reloads === 3);
  $('update-now-btn').click(); await sleep(30);
  check('Update now reloads at once when a new version is already waiting', reloads === 4);

  newVersionReady = false; $('update-banner').hidden = true;
  if (realSW) Object.defineProperty(navigator, 'serviceWorker', realSW); else delete navigator.serviceWorker;
  window.reloadApp = realReload;
}


// ---- v79: Settings check ----
{
  localStorage.removeItem(SYNC_CONFIG_KEY); localStorage.removeItem(LOCK_KEY); localStorage.removeItem(EXPORT_AT_KEY);
  books.length = 0; books.push({ ...r2, id: 'sc1', title: 'Some book', author: '', status: 'owned_unread', rating: null });
  $('settings-check').open = true;
  await renderSettingsCheck();
  const rows = () => [...document.querySelectorAll('#settings-check-list li')].map((li) => li.querySelector('.check-mark').textContent + ' ' + li.firstElementChild.nextSibling.textContent);
  const joined = () => rows().join(' | ');
  check('the checklist shows sync, backup, lock and offline rows (and no reminders row any more)', /Sync: not set up/.test(joined()) && /Backup file: never/.test(joined()) && !/Reminders/.test(joined()) && /App lock: off/.test(joined()) && /Offline use/.test(joined()), joined());
  check('a backup that was never made is flagged Check with a button', /^Check Backup file/.test(rows().find((r) => /Backup file/.test(r))) && [...document.querySelectorAll('#settings-check-list li')].some((li) => /Backup file/.test(li.textContent) && li.querySelector('.check-action')));
  recordBackupTime(EXPORT_AT_KEY);
  saveSyncConfig({ token: 'x' }); recordBackupTime(LAST_SYNC_AT_KEY);
  await renderSettingsCheck();
  check('after a backup and a sync the rows turn OK', /^OK Backup file: today/.test(rows().find((r) => /Backup file/.test(r))) && /^OK Last sync: today/.test(rows().find((r) => /Last sync/.test(r))), joined());
  books.length = 0; localStorage.removeItem(SYNC_CONFIG_KEY); localStorage.removeItem(EXPORT_AT_KEY); localStorage.removeItem(LAST_SYNC_AT_KEY);
  $('settings-check').open = false;
}


// ---- v80: automatic sync ----
{
  const realRunSync = window.runSync;
  let runs = 0;
  let tone = 'ok';
  window.runSync = async () => { runs += 1; lastSyncTone = tone; };
  const reset = () => { runs = 0; lastAutoSyncAt = 0; autoSyncBackoffUntil = 0; clearTimeout(autoSyncTimer); tone = 'ok'; };
  const hadConfig = localStorage.getItem(SYNC_CONFIG_KEY);

  check('test pages start with Auto-sync off', autoSyncOn() === false);
  localStorage.removeItem(AUTO_SYNC_KEY);
  check('with no setting it is on', autoSyncOn() === true);

  localStorage.removeItem(SYNC_CONFIG_KEY); reset();
  scheduleAutoSync(10); await sleep(60);
  check('nothing runs when sync is not set up', runs === 0);

  saveSyncConfig({ token: 'x' }); updateAutoSyncButton();
  check('the Menu button shows On once sync is set up', !$('autosync-btn').disabled && /On/.test($('autosync-btn').textContent), $('autosync-btn').textContent);
  localStorage.setItem(SYNC_SNAPSHOT_KEY, JSON.stringify({}));

  // 'open' syncs even with nothing to send; 'change' does not
  books.length = 0; recipes.length = 0; notes.length = 0; links.length = 0;
  localStorage.setItem(SYNC_SNAPSHOT_KEY, JSON.stringify({}));
  reset(); scheduleAutoSync(10, 'change'); await sleep(60);
  check('a change-triggered sync is skipped when there is nothing to send', runs === 0);
  reset(); scheduleAutoSync(10, 'open'); await sleep(60);
  check('an open-triggered sync runs even with nothing to send', runs === 1);

  // spacing and back-off
  scheduleAutoSync(10, 'open'); await sleep(60);
  check('a second try within 30 seconds is skipped', runs === 1);
  reset(); tone = 'failed'; scheduleAutoSync(10, 'open'); await sleep(60);
  check('a failed sync starts a back-off', runs === 1 && autoSyncBackoffUntil > Date.now() + 4 * 60000);
  lastAutoSyncAt = 0; scheduleAutoSync(10, 'open'); await sleep(60);
  check('during the back-off nothing else runs', runs === 1);

  // switching off, a sync already running, a hidden page
  reset(); localStorage.setItem(AUTO_SYNC_KEY, 'off'); scheduleAutoSync(10, 'open'); await sleep(60);
  check('switched off, nothing is planned', runs === 0);
  localStorage.removeItem(AUTO_SYNC_KEY);
  reset(); syncInFlight = true; await autoSyncNow('open'); syncInFlight = false;
  check('it never starts while a sync is already running', runs === 0);
  reset();
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  await autoSyncNow('open');
  check('it never runs while the app is in the background', runs === 0);
  delete document.visibilityState;

  // the Menu switch
  reset(); $('autosync-btn').click();
  check('the button turns Auto-sync off and says so', autoSyncOn() === false && /Off/.test($('autosync-btn').textContent) && localStorage.getItem(AUTO_SYNC_KEY) === 'off');
  $('autosync-btn').click();
  check('and back on', autoSyncOn() === true && /On/.test($('autosync-btn').textContent));
  clearTimeout(autoSyncTimer);
  localStorage.removeItem(SYNC_CONFIG_KEY); updateAutoSyncButton();
  check('without sync set up the button is disabled', $('autosync-btn').disabled && /set up sync first/.test($('autosync-btn').textContent));

  // clean up
  if (hadConfig) localStorage.setItem(SYNC_CONFIG_KEY, hadConfig); else localStorage.removeItem(SYNC_CONFIG_KEY);
  localStorage.removeItem(SYNC_SNAPSHOT_KEY);
  localStorage.setItem(AUTO_SYNC_KEY, 'off');
  window.runSync = realRunSync;
  updateAutoSyncButton();
}


// ---- v80: Help and the welcome card ----
{
  // Help and the welcome card
  localStorage.removeItem(WELCOME_SEEN_KEY); updateWelcomeCard();
  check('the welcome card shows on first run', $('welcome-card').hidden === false);
  check('Help in the Menu lists every tip and the welcome card the first few', document.querySelectorAll('#help-list li').length === HELP_TIPS.length && document.querySelectorAll('#welcome-list li').length === WELCOME_TIPS_SHOWN && HELP_TIPS.length >= 6);
  $('welcome-dismiss').click();
  check('Got it hides the card and remembers', $('welcome-card').hidden === true && localStorage.getItem(WELCOME_SEEN_KEY) === '1');
  updateWelcomeCard();
  check('it stays hidden next time', $('welcome-card').hidden === true);
  localStorage.removeItem(WELCOME_SEEN_KEY);
}


// ---- v80: recent searches and History ----
{
  // recent searches
  localStorage.removeItem(RECENT_SEARCHES_KEY); $('global-search-journal').checked = false;
  nav('home'); $('global-search-input').value = ''; renderRecentSearches();
  check('with no searches yet there are no chips', $('global-search-recent').hidden);
  for (const term of ['garlic', 'soup', 'Garlic', 'x', 'milk', 'bread', 'eggs', 'tea']) saveRecentSearch(term);
  check('terms are remembered newest first, without repeats, and one-letter terms are ignored', loadRecentSearches().join(',') === 'tea,eggs,bread,milk,Garlic', loadRecentSearches().join(','));
  check('the chips show while the box is empty, with a Clear chip', !$('global-search-recent').hidden && document.querySelectorAll('#global-search-recent .chip').length === 6);
  [...document.querySelectorAll('#global-search-recent .chip')].find((c) => c.textContent === 'milk').click();
  check('tapping a chip fills the box and runs the search', $('global-search-input').value === 'milk' && !$('global-search-results').hidden);
  check('the chips hide once there is text', $('global-search-recent').hidden === true);
  $('global-search-input').value = ''; $('global-search-input').dispatchEvent(new Event('input'));
  check('and come back when the box is emptied', !$('global-search-recent').hidden);
  $('global-search-journal').checked = true; saveRecentSearch('private thing'); $('global-search-journal').checked = false;
  check('a search that includes the journal is never remembered', !loadRecentSearches().includes('private thing'));
  [...document.querySelectorAll('#global-search-recent .chip')].find((c) => c.textContent === 'Clear').click();
  check('Clear forgets them all', loadRecentSearches().length === 0 && $('global-search-recent').hidden);
  localStorage.setItem(RECENT_SEARCHES_KEY, '{bad'); check('damaged saved searches count as none', loadRecentSearches().length === 0);
  localStorage.removeItem(RECENT_SEARCHES_KEY);

  // History
  notes.length = 0; renderNotes();
  undoStack.length = 0; redoStack.length = 0; updateUndoRedoButtons();
  $('history-box').open = true; renderHistory();
  check('History starts empty', /No changes yet/.test($('history-list').textContent));
  addNote('First', 'x'); addNote('Second', 'x'); addNote('Third', 'x');
  const rows = () => [...document.querySelectorAll('#history-list li')];
  check('History lists the changes newest first, capitalised', rows().length === 3 && /Added 'Third'/.test(rows()[0].textContent) && /Added 'First'/.test(rows()[2].textContent), rows().map((r) => r.textContent).join(' | '));
  check('the top one says Undo and the others say how many newer ones go too', rows()[0].querySelector('button').textContent === 'Undo' && rows()[2].querySelector('button').textContent === 'Undo this and 2 newer');
  rows()[1].querySelector('button').click(); await sleep(30);
  check('Undo this and 1 newer takes back two changes', notes.filter((x) => !x.deleted).map((x) => x.title).join(',') === 'First');
  check('an open History list refreshes itself', rows().length === 1 && /Added 'First'/.test(rows()[0].textContent));
  check('undoSteps never goes past the start', (undoSteps(10), notes.filter((x) => !x.deleted).length === 0));
  $('history-box').open = false; notes.length = 0; renderNotes(); undoStack.length = 0; updateUndoRedoButtons();
}