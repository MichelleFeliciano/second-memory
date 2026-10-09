// Autopay bills, the yearly reading goal, recipe scaling and cook mode, and the journal prompt.
const tn = new Date().toISOString();
const b0 = { dateAdded: tn, updatedAt: tn, deviceId: 'test', deleted: false, version: 0 };
const year = new Date().getFullYear();

// ================= autopay bills =================
bills.length = 0;
addBill({ name: 'Manual bill', amount: '40', dueDate: dk(1), frequency: 'monthly', category: '', autopay: false });
addBill({ name: 'Auto bill', amount: '90', dueDate: dk(1), frequency: 'monthly', category: '', autopay: true });
check('autopay is saved on the bill', bills.find((b) => b.name === 'Auto bill').autopay === true && bills.find((b) => b.name === 'Manual bill').autopay === false);
nav('budget');
const autoCard = [...document.querySelectorAll('#budget-list .bill-card')].find((c) => c.querySelector('.bill-name').textContent === 'Auto bill');
const manualCard = [...document.querySelectorAll('#budget-list .bill-card')].find((c) => c.querySelector('.bill-name').textContent === 'Manual bill');
check('an autopay bill shows an Autopay label and a manual one does not', !autoCard.querySelector('.bill-autopay').hidden && manualCard.querySelector('.bill-autopay').hidden);
renderHome();
const bannerText = () => ($('reminder-banner').hidden ? '' : $('reminder-banner-text').textContent);
reminderBannerDismissed = false; renderHome();
check('the top banner mentions the manual bill due tomorrow but not the autopay one', /Manual bill/.test(bannerText()) && !/Auto bill/.test(bannerText()), bannerText());
bills.find((b) => b.name === 'Manual bill').dueDate = dk(3); saveCollection(BILLS_KEY, bills); reminderBannerDismissed = false; renderHome();
check('the banner only looks two days ahead (a bill in 3 days is not in it)', !/Manual bill/.test(bannerText()), bannerText());
check('Home still lists the autopay bill and marks it', [...document.querySelectorAll('#home-bills-list .home-item')].some((li) => /Auto bill/.test(li.textContent) && /autopay/.test(li.textContent)));
// editing keeps/changes the flag
updateBill(bills.find((b) => b.name === 'Manual bill').id, { name: 'Manual bill', amount: '40', dueDate: dk(3), frequency: 'monthly', category: '', autopay: true });
check('editing can turn autopay on', bills.find((b) => b.name === 'Manual bill').autopay === true);
check('import accepts a true/false autopay and refuses anything else', isValidImportRecord('bills', { id: 'x', name: 'n', amount: 5, dueDate: dk(1), frequency: 'monthly', autopay: true }) && !isValidImportRecord('bills', { id: 'x', name: 'n', amount: 5, dueDate: dk(1), frequency: 'monthly', autopay: 'yes' }));
// the add form checkbox
set('budget-name-input', 'Form bill'); set('budget-amount-input', '12'); set('budget-duedate-input', dk(5));
$('budget-autopay-input').checked = true; $('budget-add-form').requestSubmit(); await sleep(30);
check('the add form saves the autopay box and then clears it', bills.find((b) => b.name === 'Form bill').autopay === true && $('budget-autopay-input').checked === false);

// ================= reading goal =================
books.length = 0; localStorage.removeItem('secondMemory.readingGoals.v1');
addBook('Finished one', 'A', 'owned_read');
addBook('Unread one', 'B', 'owned_unread');
check('a book added straight onto a read shelf gets today as its finished date', books.find((b) => b.title === 'Finished one').dateFinished === todayKey());
check('an unread book has no finished date', books.find((b) => b.title === 'Unread one').dateFinished === null);
updateBookStatus(books.find((b) => b.title === 'Unread one').id, 'owned_read');
check('moving a book onto a read shelf stamps today', books.find((b) => b.title === 'Unread one').dateFinished === todayKey());
updateBookStatus(books.find((b) => b.title === 'Unread one').id, 'owned_unread');
check('moving it back clears the date', books.find((b) => b.title === 'Unread one').dateFinished === null);
books.push({ ...b0, id: 'old1', title: 'Last year', author: '', status: 'owned_read', rating: null, dateFinished: `${year - 1}-06-01` });
books.push({ ...b0, id: 'old2', title: 'No date', author: '', status: 'owned_read', rating: null });
books.push({ ...b0, id: 'old3', title: 'Textbook', author: '', status: 'textbook_read', rating: null, dateFinished: todayKey() });
nav('books'); renderBooks();
check('only this year\'s finished books on read shelves count (not last year, not textbooks)', booksFinishedInYear(books, year) === 1);
check('with no goal it still says how many are finished', /1 book finished/.test($('reading-goal-text').textContent) && $('reading-goal-bar').hidden, $('reading-goal-text').textContent);
check('books with no finish date are mentioned', !$('reading-goal-undated').hidden && /1 finished book has no finish date/.test($('reading-goal-undated').textContent), $('reading-goal-undated').textContent);
set('reading-goal-input', '4'); $('reading-goal-form').requestSubmit();
check('setting a goal shows progress', /1 of 4 books finished \(3 to go\)/.test($('reading-goal-text').textContent) && !$('reading-goal-bar').hidden && Number($('reading-goal-bar').max) === 4 && Number($('reading-goal-bar').value) === 1, $('reading-goal-text').textContent);
set('reading-goal-input', '0'); $('reading-goal-form').requestSubmit();
check('a bad goal is refused and the old one stays', !$('reading-goal-error').hidden && loadReadingGoals()[String(year)] === 4);
updateBookStatus(books.find((b) => b.id === 'old2').id, 'owned_read');
check('reaching the goal says so', (() => { saveReadingGoal(year, 1); renderBooks(); return /Goal reached/.test($('reading-goal-text').textContent); })(), $('reading-goal-text').textContent);
$('reading-goal-clear').click();
check('Clear removes the goal', loadReadingGoals()[String(year)] === undefined && $('reading-goal-bar').hidden);
check('goals travel in the full backup', (() => { saveReadingGoal(year, 12); const out = buildExportPayload(); saveReadingGoal(year, null); return out.local.readingGoals[String(year)] === 12; })());
// editing the finished date
const finishedBook = books.find((b) => b.title === 'Finished one');
check('the finished date can be edited', updateBook(finishedBook.id, { title: 'Finished one', author: 'A', dateFinished: dk(-3) }) !== false && finishedBook.dateFinished === dk(-3));
check('a future finished date is refused', updateBook(finishedBook.id, { title: 'Finished one', author: 'A', dateFinished: dk(5) }) === false && finishedBook.dateFinished === dk(-3));
check('a blank finished date clears it', updateBook(finishedBook.id, { title: 'Finished one', author: 'A', dateFinished: '' }) !== false && finishedBook.dateFinished === null);
check('the card shows "Finished" with the date', (() => { finishedBook.dateFinished = dk(-3); renderBooks(); return [...document.querySelectorAll('.book-finished')].some((e) => !e.hidden && /Finished/.test(e.textContent)); })());
check('import checks the finished date', isValidImportRecord('books', { id: 'x', title: 't', status: 'owned_read', dateFinished: dk(-1) }) && isValidImportRecord('books', { id: 'x', title: 't', status: 'owned_read' }) && !isValidImportRecord('books', { id: 'x', title: 't', status: 'owned_read', dateFinished: 'soon' }));

// ================= recipe scaling =================
check('1/2 cup doubled is 1 cup', scaleIngredientLine('1/2 cup flour', 2) === '1 cup flour');
check('1 1/2 doubled is 3', scaleIngredientLine('1 1/2 cups milk', 2) === '3 cups milk');
check('1 cup halved is 1/2', scaleIngredientLine('1 cup sugar', 0.5) === '1/2 cup sugar');
check('3 eggs halved is 1 1/2', scaleIngredientLine('3 eggs', 0.5) === '1 1/2 eggs');
check('a range scales both ends', scaleIngredientLine('2-3 cloves garlic', 2) === '4-6 cloves garlic' && scaleIngredientLine('3 to 4 carrots', 2) === '6 to 8 carrots');
check('a line with no amount is left alone', scaleIngredientLine('salt to taste', 3) === 'salt to taste');
check('the half symbol is understood', scaleIngredientLine('½ tsp salt', 2) === '1 tsp salt' && scaleIngredientLine('1 ½ cups rice', 2) === '3 cups rice');
check('thirds come out as thirds', scaleIngredientLine('1/3 cup oil', 2) === '2/3 cup oil');
check('scale 1 changes nothing', scaleIngredientLine('1 1/2 cups milk', 1) === '1 1/2 cups milk');
check('measures turn singular or plural to match', scaleIngredientLine('1 cup sugar', 3) === '3 cups sugar' && scaleIngredientLine('2 cups sugar', 0.5) === '1 cup sugar' && scaleIngredientLine('1 cup sugar', 0.5) === '1/2 cup sugar' && scaleIngredientLine('2 tbsp butter', 2) === '4 tbsp butter' && scaleIngredientLine('1 can beans', 2) === '2 cans beans');
check('only the leading amount is scaled', scaleIngredientLine('2 14-oz cans tomatoes', 2) === '4 14-oz cans tomatoes');

recipes.length = 0;
recipes.push({ ...b0, id: 'rs1', title: 'Pancakes', category: '', ingredients: ['1 cup flour', '2 eggs', 'pinch of salt'], steps: ['Mix the dry things', 'Add the eggs', 'Cook on the pan'], notes: '' });
recipeScales.clear();
nav('recipes'); renderRecipes();
const ingText = () => [...document.querySelectorAll('#recipes-list .recipe-ingredients li')].map((li) => li.textContent);
check('the card starts at 1x', ingText().join('|') === '1 cup flour|2 eggs|pinch of salt' && document.querySelector('#recipes-list .recipe-scale .chip-active').dataset.scale === '1');
document.querySelector('#recipes-list .recipe-scale [data-scale="2"]').click();
check('2x doubles the amounts on the card', ingText().join('|') === '2 cups flour|4 eggs|pinch of salt', ingText().join('|'));
check('the original recipe is not changed', recipes[0].ingredients[0] === '1 cup flour');
check('the chosen scale button is highlighted', document.querySelector('#recipes-list .recipe-scale .chip-active').dataset.scale === '2');

// ================= cook mode =================
document.querySelector('#recipes-list .cook-mode-btn').click(); await sleep(30);
check('cook mode opens on step 1 with the recipe name and scale', !$('cook-mode').hidden && /Pancakes \(2×\)/.test($('cook-title').textContent) && /Step 1 of 3/.test($('cook-progress').textContent) && $('cook-step').textContent === 'Mix the dry things', $('cook-title').textContent);
check('the scaled ingredients are listed in cook mode', [...document.querySelectorAll('#cook-ingredients-list li')].map((l) => l.textContent).join('|') === '2 cups flour|4 eggs|pinch of salt');
check('Back is off on the first step', $('cook-prev').disabled);
$('cook-next').click();
check('Next moves on', /Step 2 of 3/.test($('cook-progress').textContent) && $('cook-step').textContent === 'Add the eggs' && !$('cook-prev').disabled);
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
check('the arrow key moves on too, and the last step says Done', /Step 3 of 3/.test($('cook-progress').textContent) && $('cook-next').textContent === 'Done');
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
check('the left arrow goes back', /Step 2 of 3/.test($('cook-progress').textContent));
$('cook-next').click(); $('cook-next').click();
check('Done on the last step closes cook mode', $('cook-mode').hidden);
openCookMode('rs1'); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
check('Esc closes cook mode', $('cook-mode').hidden);
recipes[0].steps = []; renderRecipes();
check('a recipe with no steps has no cook mode button', document.querySelector('#recipes-list .cook-mode-btn').hidden);

// ================= journal prompt and look-back =================
const todayPrompt = journalPromptForDate(todayKey());
check('there is a prompt for today and a different one tomorrow', typeof todayPrompt === 'string' && todayPrompt.length > 10 && journalPromptForDate(dk(1)) !== todayPrompt);
check('the prompt is the same all day', journalPromptForDate(todayKey()) === todayPrompt);
check('every day of a long stretch has a prompt', Array.from({ length: 400 }, (_, i) => journalPromptForDate(dk(i))).every((p) => typeof p === 'string' && p.length > 0));
journalEntries.length = 0;
nav('journal');
check('the prompt shows on the Journal tab', $('journal-prompt-text').textContent === todayPrompt);
check('no look-back box when nothing was written a year ago', $('journal-lookback').hidden);
const lastYearKey = sameDateLastYear(todayKey());
check('same date last year keeps the month and day', lastYearKey.slice(5) === todayKey().slice(5) && Number(lastYearKey.slice(0, 4)) === Number(todayKey().slice(0, 4)) - 1);
check('Feb 29 falls back to Feb 28', sameDateLastYear('2028-02-29') === '2027-02-28');
journalEntries.push({ id: 'ly1', type: 'daily', date: lastYearKey, answers: { on_mind: 'A quiet day at the lake with a very long description that keeps going on and on and on so that it must be trimmed down for the list view to stay tidy' }, dateAdded: tn, updatedAt: tn });
journalEntries.push({ id: 'ly2', type: 'dream', date: dk(-3), answers: { story: 'unrelated' }, dateAdded: tn, updatedAt: tn });
saveJournalEntries(); renderJournal();
check('an entry from this date last year shows up, trimmed', !$('journal-lookback').hidden && $('journal-lookback-list').children.length === 1 && /quiet day at the lake/.test($('journal-lookback-list').textContent) && /\.\.\.$/.test($('journal-lookback-list').textContent.trim()), $('journal-lookback-list').textContent);
$('journal-prompt-btn').click();
check('"Write about this" starts a journal entry with the prompt filled in', !$('journal-wizard').hidden && journalDraft.type === 'daily' && journalDraft.answers.on_mind.startsWith(todayPrompt));
$('journal-cancel-btn').click();
