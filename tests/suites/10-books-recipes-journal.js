// The yearly reading goal, plain recipes (the cooking extras moved out), and the journal prompt.
// (The file keeps its old "bills" name on purpose, from before Budget moved to its own app; it has no bills checks now.)
const tn = new Date().toISOString();
const b0 = { dateAdded: tn, updatedAt: tn, deviceId: 'test', deleted: false, version: 0 };
const year = new Date().getFullYear();

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

// ================= recipes are plain: the cooking extras moved out =================
recipes.length = 0;
recipes.push({ ...b0, id: 'rs1', title: 'Pancakes', category: 'Breakfast', ingredients: ['1 cup flour', '2 eggs', 'pinch of salt'], steps: ['Mix the dry things', 'Add the eggs'], notes: 'Family favourite', pinned: true, sortOrder: 5000 });
nav('recipes'); renderRecipes();
const rcard = document.querySelector('#recipes-list .recipe-card');
check('a recipe card shows its title, category, ingredients as written, steps and notes', rcard.querySelector('.recipe-title').textContent === 'Pancakes' && rcard.querySelector('.recipe-category').textContent === 'Breakfast' && [...rcard.querySelectorAll('.recipe-ingredients li')].map((l) => l.textContent).join('|') === '1 cup flour|2 eggs|pinch of salt' && rcard.querySelectorAll('.recipe-steps li').length === 2 && /Family favourite/.test(rcard.textContent));
check('the only buttons on a recipe are Edit and Delete', [...rcard.querySelectorAll('.recipe-view button')].map((x) => x.textContent).join(',') === 'Edit,Delete');
check('no scaling, cook mode, pinning, sharing, printing, carousel or My order', !document.querySelector('.recipe-scale, .cook-mode-btn, .pin-btn, .share-recipe-btn, .print-recipe-btn, .carousel, .carousel-arrow, #cook-mode, #print-recipe, .add-to-shopping-btn') && ![...$('recipes-sort-input').options].some((o) => o.value === 'manual') && typeof openCookMode === 'undefined' && typeof scaleIngredientLine === 'undefined' && typeof shareRecipe === 'undefined');
check('the sort choices are the three plain ones', [...$('recipes-sort-input').options].map((o) => o.value).join() === 'date_added_asc,date_added_desc,title_asc');
rcard.querySelector('.edit-btn').click();
rcard.querySelector('.recipe-edit-title').value = 'Fluffy pancakes';
rcard.querySelector('.recipe-edit-form').requestSubmit(); await sleep(30);
check('editing a recipe keeps fields the old extras had stored (pinned, sortOrder) so no data is lost', recipes[0].title === 'Fluffy pancakes' && recipes[0].pinned === true && recipes[0].sortOrder === 5000);
check('those stored fields still travel in an export', buildExportPayload().collections.recipes[0].pinned === true && buildExportPayload().collections.recipes[0].sortOrder === 5000);
recipes.length = 0; renderRecipes();

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
