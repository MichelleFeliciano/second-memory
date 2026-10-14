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

// ---- diagnosis with no status draws as a plain card ----
diagnoses.length = 0;
diagnoses.push({ ...r2, id: 'dgx', condition: 'No status', dateDiagnosed: null, provider: '', notes: '' });
nav('diagnoses'); renderDiagnoses();
check('a status-less diagnosis draws as a plain card', document.querySelectorAll('#diagnoses-list .diagnosis-card').length === 1);
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

// ---- recipes: the add form is a dropdown and the cards scroll sideways with arrows ----
recipes.length = 0;
for (let i = 0; i < 6; i++) recipes.push({ ...r2, id: 'rc' + i, title: 'Recipe ' + i, category: '', ingredients: [], steps: [], notes: '' });
nav('recipes'); renderRecipes(); await sleep(50);
const addBox = $('recipes-add-details');
check('the recipe form sits in a dropdown that starts closed', addBox.tagName === 'DETAILS' && !addBox.open && addBox.contains($('recipes-add-form')));
const track = $('recipes-list');
check('recipes sit in one row that scrolls sideways', getComputedStyle(track).overflowX === 'auto' && track.scrollWidth > track.clientWidth);
check('the back arrow starts dimmed and the forward arrow is ready', $('recipes-prev').disabled && !$('recipes-next').disabled, [track.scrollLeft, track.clientWidth, track.scrollWidth, $('recipes-prev').disabled, $('recipes-next').disabled].join(','));
track.style.scrollBehavior = 'auto'; track.scrollLeft = 300; await sleep(400);
const scrolledTo = track.scrollLeft; // the row snaps to a card edge
track.dispatchEvent(new Event('scroll')); // a hidden test page may not fire scroll events by itself
check('after scrolling, the back arrow is ready', scrolledTo > 0 && !$('recipes-prev').disabled, scrolledTo + ',' + $('recipes-prev').disabled);
renderRecipes();
check('redrawing keeps the scroll position', track.scrollLeft === scrolledTo, track.scrollLeft + ' vs ' + scrolledTo);
set('recipes-title-input', 'Brand new'); addBox.open = true; $('recipes-add-form').requestSubmit(); await sleep(50);
check('adding a recipe closes the dropdown again', !addBox.open && recipes.some((r) => r.title === 'Brand new'));
recipes.length = 0; renderRecipes();

// ---- friendlier app: undo toast, phone bottom bar, Home panels, empty-state buttons, text size ----
todos.length = 0; shoppingItems.length = 0; weights.length = 0;
addTodo('Toast me', '', '');
const toastTodo = todos[0];
deleteTodo(toastTodo.id);
check('deleting shows a toast with an Undo button', !$('toast').hidden && /Toast me/.test($('toast-text').textContent) && !$('toast-undo').hidden, $('toast-text').textContent);
$('toast-undo').click(); await sleep(30);
check('the toast Undo brings the item back and hides the toast', todos.find((t) => t.id === toastTodo.id).deleted === false && $('toast').hidden);
addTodo('Second', '', '');
check('adding something clears an old toast', $('toast').hidden);

nav('shopping');
check('the bottom bar marks the current screen', document.querySelector('.bottom-bar [data-quick-tab="shopping"]').getAttribute('aria-current') === 'page' && !document.querySelector('.bottom-bar [data-quick-tab="home"]').hasAttribute('aria-current'));
document.querySelector('.bottom-bar [data-quick-tab="notes"]').click();
check('a bottom bar button switches screen', !$('notes-collection').hidden && $('home-collection').hidden);

weights.length = 0; shoppingItems.length = 0;
shoppingItems.push({ ...r2, id: 'hs1', item: 'Milk', quantity: '2', category: '', checked: false }, { ...r2, id: 'hs2', item: 'Eggs', quantity: '', category: '', checked: true });
nav('home'); renderHome();
check('Home shows the weigh-in box until today has a weight', !$('home-weigh-panel').hidden);
check('Home lists only unchecked shopping items', !$('home-shopping-panel').hidden && /Milk/.test($('home-shopping-list').textContent) && !/Eggs/.test($('home-shopping-list').textContent));
set('home-weigh-input', 'abc'); $('home-weigh-form').requestSubmit();
check('a bad weight on Home shows an error and saves nothing', !$('home-weigh-error').hidden && weights.length === 0);
set('home-weigh-input', '150.4'); $('home-weigh-form').requestSubmit(); await sleep(30);
check('saving on Home records today and hides the box', weights.length === 1 && weights[0].date === todayKey() && weights[0].weight === 150.4 && $('home-weigh-panel').hidden);
shoppingItems.length = 0; weights.length = 0; todos.length = 0; renderHome(); renderWeights(); renderShoppingList(); renderTodos();

books.length = 0; renderBooks();
const emptyBtn = document.querySelector('#books-empty-state .empty-state-add');
check('an empty screen offers an Add one now button', !!emptyBtn);
emptyBtn.click();
check('it opens the add form', document.querySelector('#books-collection details.add-dropdown').open);

$('text-size-btn').click();
check('Text size cycles to Large', document.documentElement.getAttribute('data-text') === 'large' && /Large/.test($('text-size-btn').textContent));
$('text-size-btn').click(); $('text-size-btn').click();
check('and back to Normal', !document.documentElement.hasAttribute('data-text') && /Normal/.test($('text-size-btn').textContent));

// ---- buy again, pinned recipes, refill pickup, Home weight, weekly backup, contrast ----
shoppingItems.length = 0;
shoppingItems.push({ ...r2, id: 'ba1', item: 'Milk', quantity: '2', category: 'dairy', checked: true });
shoppingItems.push({ ...r2, id: 'ba2', item: 'Eggs', quantity: '', category: '', checked: false, deleted: true });
shoppingItems.push({ ...r2, id: 'ba3', item: 'Bread', quantity: '', category: '', checked: true });
shoppingItems.push({ ...r2, id: 'ba4', item: 'bread', quantity: '', category: '', checked: false });
nav('shopping'); renderShoppingList();
check('Buy again offers earlier items that are not on the list now', buyAgainSuggestions().map((s) => s.item).sort().join(',') === 'Eggs,Milk', buyAgainSuggestions().map((s) => s.item).join(','));
check('the chips show on the shopping screen', !$('shopping-buy-again').hidden && /Milk \(2\)/.test($('shopping-buy-again-chips').textContent));
[...document.querySelectorAll('#shopping-buy-again-chips .chip')].find((c) => /Milk/.test(c.textContent)).click();
const readded = shoppingItems.find((i) => i.item === 'Milk' && !i.checked && !i.deleted);
check('tapping a chip adds it back with its old quantity and category', !!readded && readded.quantity === '2' && readded.category === 'dairy');
check('and it leaves the suggestions', !buyAgainSuggestions().some((s) => s.item === 'Milk'));
shoppingItems.length = 0; renderShoppingList();

recipes.length = 0;
recipes.push({ ...r2, id: 'pr1', title: 'Aaa soup', category: '', ingredients: [], steps: ['Stir'], notes: '' });
recipes.push({ ...r2, id: 'pr2', title: 'Zzz cake', category: '', ingredients: [], steps: [], notes: '' });
nav('recipes'); selectedRecipesSort = 'title_asc'; renderRecipes();
const recipeTitles = () => [...document.querySelectorAll('#recipes-list .recipe-title')].map((e) => e.textContent).join('|');
check('recipes start in the chosen order', recipeTitles() === 'Aaa soup|Zzz cake', recipeTitles());
toggleRecipePinned('pr2');
check('a pinned recipe moves to the front', recipeTitles() === 'Zzz cake|Aaa soup' && recipes.find((r) => r.id === 'pr2').pinned === true);
check('its button reads Pinned', /Pinned/.test(document.querySelector('#recipes-list .pin-btn').textContent) && document.querySelector('#recipes-list .pin-btn').getAttribute('aria-pressed') === 'true');
check('Home lists pinned recipes', !$('home-recipes-panel').hidden && /Zzz cake/.test($('home-recipes-list').textContent));
undo(); await sleep(30);
check('undo unpins it', !recipes.find((r) => r.id === 'pr2').pinned && recipeTitles() === 'Aaa soup|Zzz cake');
toggleRecipePinned('pr1'); renderHome();
let openedCook = false;
const realOpenCook = window.openCookMode; window.openCookMode = () => { openedCook = true; };
document.querySelector('#home-recipes-list .home-item-link').click();
window.openCookMode = realOpenCook;
check('a pinned recipe with steps opens Cook mode from Home', openedCook);
recipes.length = 0; selectedRecipesSort = 'date_added_asc'; renderRecipes();

medications.length = 0;
medications.push({ id: 'pk1', name: 'Pill', dosage: '', frequency: '', prescribingDoctor: '', startDate: null, endDate: null, refillDate: dk(-2), notes: '', ...r2 });
nav('medications'); renderMedications();
check('the first pickup asks how many days', document.querySelector('#medications-list .refill-interval').hidden === true);
document.querySelector('#medications-list .refill-picked-btn').click();
check('tapping Picked up shows 30 / 60 / 90 days', document.querySelector('#medications-list .refill-interval').hidden === false);
document.querySelector('#medications-list .refill-interval .chip[data-days="60"]').click();
check('choosing 60 days sets the next refill and remembers the number', medications[0].refillDate === shiftDateKey(todayKey(), 60) && medications[0].refillEveryDays === 60);
check('the button now says how long until the next one', /next in 60 days/.test(document.querySelector('#medications-list .refill-picked-btn').textContent));
medications[0].refillDate = dk(-1); renderMedications();
document.querySelector('#medications-list .refill-picked-btn').click();
check('with a remembered interval one tap is enough', medications[0].refillDate === shiftDateKey(todayKey(), 60));
check('a wrong number of days is refused', markRefillPickedUp('pk1', 0) === false && markRefillPickedUp('pk1', 1.5) === false && markRefillPickedUp('pk1', 400) === false && markRefillPickedUp('nope', 30) === false);
undo(); await sleep(30);
check('undo puts the old refill date back', medications[0].refillDate === dk(-1));
medications.length = 0; renderMedications();

weights.length = 0;
weights.push({ ...r2, id: 'wt1', date: dk(-6), weight: 160, note: '' }, { ...r2, id: 'wt2', date: dk(-3), weight: 159, note: '' }, { ...r2, id: 'wt3', date: dk(0), weight: 158.5, note: '' });
nav('home'); renderHome();
check('Home shows the weight trend', !$('home-weight-panel').hidden && /158\.5 lb/.test($('home-weight-text').textContent) && /down 1\.5 lb over the last 7 days/.test($('home-weight-text').textContent), $('home-weight-text').textContent);
check('and a small line of recent weights', document.querySelectorAll('#home-weight-spark polyline').length === 1);
weights.length = 1; renderHome();
check('one weight is not enough for a trend', $('home-weight-panel').hidden);
weights.length = 0; renderHome();

check('the full backup reminder comes after a week', EXPORT_DUE_DAYS === 7);

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

// snooze
todos.length = 0;
todos.push({ ...r2, id: 'sn1', task: 'Late one', dueDate: dk(-2), completed: false, repeat: '' });
todos.push({ ...r2, id: 'sn2', task: 'Future one', dueDate: dk(5), completed: false, repeat: '' });
todos.push({ ...r2, id: 'sn3', task: 'No date', dueDate: null, completed: false, repeat: '' });
nav('todo'); selectedTodoFilter = 'all'; renderTodos();
const snoozeShown = (title) => [...document.querySelectorAll('#todo-list .todo-item')].find((li) => li.querySelector('.todo-task').textContent === title).querySelector('.snooze-btn').hidden === false;
check('snooze buttons show only on overdue or due-today to-dos', snoozeShown('Late one') && !snoozeShown('Future one') && !snoozeShown('No date'));
[...document.querySelectorAll('#todo-list .todo-item')].find((li) => li.querySelector('.todo-task').textContent === 'Late one').querySelector('.snooze-btn[data-days="1"]').click();
check('Tomorrow moves the due date to tomorrow', todos[0].dueDate === dk(1));
undo(); await sleep(30);
check('undo puts the old date back', todos[0].dueDate === dk(-2));
snoozeTodo('sn1', 7);
check('Next week moves it seven days out', todos[0].dueDate === dk(7));
check('snooze refuses bad input and finished to-dos', snoozeTodo('sn1', 0) === false && snoozeTodo('nope', 1) === false && (() => { todos[1].completed = true; const r = snoozeTodo('sn2', 1); todos[1].completed = false; return r === false; })());
todos.length = 0; renderTodos();

// shopping groups and share
shoppingItems.length = 0;
shoppingItems.push({ ...r2, id: 'g1', item: 'Milk', quantity: '2', category: 'Dairy', checked: false });
shoppingItems.push({ ...r2, id: 'g2', item: 'Apples', quantity: '', category: 'Produce', checked: false });
shoppingItems.push({ ...r2, id: 'g3', item: 'Soap', quantity: '', category: '', checked: false });
shoppingItems.push({ ...r2, id: 'g4', item: 'Cheese', quantity: '', category: 'dairy', checked: true });
nav('shopping'); selectedShoppingCategory = 'all'; selectedShoppingChecked = 'all'; renderShoppingList();
const shopRows = () => [...document.querySelectorAll('#shopping-list > li')].map((li) => li.classList.contains('shopping-group') ? '#' + li.textContent : li.querySelector('.shopping-item-name').textContent).join('|');
check('with several categories the list is grouped under headings, Other last, ticked items last in a group', shopRows() === '#Dairy|Milk|Cheese|#Produce|Apples|#Other|Soap', shopRows());
shoppingItems.splice(1, 3); renderShoppingList();
check('one category means no headings', !document.querySelector('#shopping-list .shopping-group'));
shoppingItems.length = 0;
shoppingItems.push({ ...r2, id: 'g1', item: 'Milk', quantity: '2', category: 'Dairy', checked: false }, { ...r2, id: 'g2', item: 'Apples', quantity: '', category: 'Produce', checked: false }, { ...r2, id: 'g4', item: 'Cheese', quantity: '', category: '', checked: true });
check('the share text lists open items under their categories', shoppingListText() === 'Shopping list\n\nDairy:\n- Milk (2)\n\nProduce:\n- Apples', JSON.stringify(shoppingListText()));
const realShare = navigator.share; const realClip = navigator.clipboard;
let sharedText = null;
Object.defineProperty(navigator, 'share', { configurable: true, value: async (data) => { sharedText = data.text; } });
$('shopping-share-btn').click(); await sleep(30);
check('Share uses the phone share sheet when there is one', sharedText === shoppingListText());
Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
let copied = null;
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (s) => { copied = s; } } });
$('shopping-share-btn').click(); await sleep(30);
check('otherwise it copies the text and says so', copied === shoppingListText() && /Copied/.test($('shopping-share-status').textContent));
shoppingItems.length = 0; $('shopping-share-btn').click(); await sleep(30);
check('an empty list says there is nothing to share', /Nothing to share/.test($('shopping-share-status').textContent));
Object.defineProperty(navigator, 'share', { configurable: true, value: realShare });
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: realClip });
renderShoppingList();

// swipe
const swipe = async (el, dx, dy = 0, type = 'touch') => {
  const opts = (x, y) => ({ pointerType: type, clientX: x, clientY: y, bubbles: true });
  el.dispatchEvent(new PointerEvent('pointerdown', opts(100, 100)));
  el.dispatchEvent(new PointerEvent('pointermove', opts(100 + dx / 2, 100 + dy / 2)));
  el.dispatchEvent(new PointerEvent('pointerup', opts(100 + dx, 100 + dy)));
  await sleep(30);
};
todos.length = 0; addTodo('Swipe me', '', ''); nav('todo'); renderTodos();
const todoName = () => document.querySelector('#todo-list .todo-task');
await swipe(todoName(), 40);
check('a short swipe does nothing', todos[0].completed === false);
await swipe(todoName(), 150, 120);
check('a mostly-vertical swipe does nothing', todos[0].completed === false);
await swipe(todoName(), 150, 0, 'mouse');
check('a mouse drag is not a swipe', todos[0].completed === false);
await swipe(todoName(), 150);
check('swiping right checks the to-do off', todos[0].completed === true);
await swipe(document.querySelector('#todo-list .todo-task'), 150);
check('swiping right again unchecks it', todos[0].completed === false);
await swipe(document.querySelector('#todo-list .todo-task'), -150);
check('swiping left deletes it and offers Undo', todos[0].deleted === true && !$('toast').hidden);
$('toast-undo').click(); await sleep(30);
check('Undo brings it back', todos[0].deleted === false);
shoppingItems.length = 0; addShoppingItem('Swipe milk', '', ''); nav('shopping'); renderShoppingList();
await swipe(document.querySelector('#shopping-list .shopping-item-name'), 150);
check('swiping right checks a shopping item off', shoppingItems[0].checked === true);
await swipe(document.querySelector('#shopping-list .shopping-item-name'), -150);
check('swiping left deletes a shopping item', shoppingItems[0].deleted === true);
todos.length = 0; shoppingItems.length = 0; renderTodos(); renderShoppingList();

// customise Home
nav('home'); weights.length = 0; renderHome();
check('Customize Home has a checkbox for every panel, all on', document.querySelectorAll('#home-customize-list input').length === 7 && [...document.querySelectorAll('#home-customize-list input')].every((c) => c.checked));
check('the weigh-in panel shows before it is switched off', !$('home-weigh-panel').hidden);
const weighBox = [...document.querySelectorAll('#home-customize-list label')].find((l) => /Weigh in/.test(l.textContent)).querySelector('input');
weighBox.click();
check('unticking a panel hides it', $('home-weigh-panel').hidden && loadHiddenHomePanels().has('home-weigh-panel'));
weighBox.click();
check('ticking it again brings it back', !$('home-weigh-panel').hidden);
localStorage.setItem(HOME_PANELS_KEY, 'garbage');
check('a damaged Home setting switches nothing off', loadHiddenHomePanels().size === 0);
localStorage.removeItem(HOME_PANELS_KEY); renderHome();
