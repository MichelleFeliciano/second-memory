// The private journal: the guided entries, the date timeline, search, trends, the therapy
// summary, and backup/restore. It must also stay on this device only.
const entry = (id, type, date, answers, added) => ({ id, type, date, answers, dateAdded: added || date + 'T10:00:00.000Z', updatedAt: date + 'T10:00:00.000Z' });
const next = () => $('journal-wizard').requestSubmit();

// ---- privacy ----
check('the journal is not part of sync', !SYNC_COLLECTIONS.some((c) => /journal/i.test(c.name)));
check('the journal is not in the normal export', !('journal' in buildExportPayload().collections));

// ---- the guided flow for each kind of entry ----
nav('journal');
check('three kinds of entry can be started', [...document.querySelectorAll('.journal-start-btn')].map((b) => b.dataset.journalType).sort().join() === 'daily,dream,therapy');

document.querySelector('[data-journal-type="dream"]').click();
check('dream: starts on the date step', /Date/.test($('journal-progress').textContent));
next();
$('journal-answer').querySelector('textarea').value = 'Flying over a lake'; next();
$('journal-skip-btn').click();
$('journal-answer').querySelector('textarea').value = 'Peaceful'; next();
$('journal-answer').querySelectorAll('.journal-choice')[0].click(); next();
$('journal-answer').querySelectorAll('.journal-choice')[3].click(); next();
next();
$('journal-answer').querySelector('textarea').value = 'Feeling free lately'; next();
const dream = journalEntries[journalEntries.length - 1];
check('dream: saved with the answers given and skipped ones left out', dream.type === 'dream' && dream.answers.story === 'Flying over a lake' && dream.answers.felt_waking === 'Calm' && dream.answers.vividness === '4' && !('stood_out' in dream.answers), JSON.stringify(dream.answers));

document.querySelector('[data-journal-type="daily"]').click();
check('daily: asks which day first', /Which day/.test($('journal-question').textContent));
next();
check('daily: the first question is the free write', /on your mind/i.test($('journal-question').textContent));
$('journal-answer').querySelector('textarea').value = 'Long day but a good one'; next();
$('journal-answer').querySelectorAll('.journal-choice')[3].click(); next();
$('journal-answer').querySelectorAll('.journal-choice')[2].click(); next();
for (let i = 0; i < 5; i++) next();
const daily = journalEntries[journalEntries.length - 1];
check('daily: saved with rating and feeling', daily.type === 'daily' && daily.answers.day_rating === '4' && daily.answers.feeling === 'Grateful', JSON.stringify(daily.answers));

document.querySelector('[data-journal-type="therapy"]').click();
for (let i = 0; i < 8; i++) next();
check('an entry with every question skipped is refused', !$('journal-error').hidden && /at least one/i.test($('journal-error').textContent));
$('journal-cancel-btn').click();

// ---- editing and skipping ----
journalEntries.push(entry('ed1', 'dream', dk(-9), { story: 'keep me', felt_in: 'calm' })); saveJournalEntries(); selectedJournalFilter = 'all'; renderJournal();
const editBtn = [...document.querySelectorAll('#journal-list .journal-card')].find((c) => c.dataset.entryId === 'ed1').querySelector('.edit-btn');
editBtn.click();
check('editing says so and prefills', /editing/.test($('journal-progress').textContent));
next();
check('the saved answer is shown', $('journal-answer').querySelector('textarea').value === 'keep me');
$('journal-skip-btn').click();
for (let i = 0; i < 8; i++) next();
check('skipping while editing keeps the saved answer', journalEntries.find((e) => e.id === 'ed1').answers.story === 'keep me');

// ---- saving never loses entries when storage is full ----
const countBefore = journalEntries.length;
document.querySelector('[data-journal-type="therapy"]').click(); next();
$('journal-answer').querySelector('textarea').value = 'quota test';
__mem.failWrites = true;
for (let i = 0; i < 8; i++) next();
__mem.failWrites = false;
check('a full browser does not duplicate or lose entries', journalEntries.length === countBefore, countBefore + ' -> ' + journalEntries.length);
check('...and tells you', !$('journal-error').hidden && /storage/i.test($('journal-error').textContent));
$('journal-cancel-btn').click();

// ---- timeline ----
journalEntries.length = 0;
[entry('a', 'daily', dk(-50), { on_mind: 'Exam stress at school', day_rating: '2', feeling: 'Anxious' }),
 entry('b', 'daily', dk(-30), { on_mind: 'Quiet weekend', day_rating: '3', feeling: 'Calm' }),
 entry('c', 'therapy', dk(-21), { topics: 'Boundaries with family', mood_after: '3' }),
 entry('d', 'daily', dk(-14), { on_mind: 'Went hiking', day_rating: '4', feeling: 'Happy' }),
 entry('e', 'dream', dk(-10), { story: 'Flying over a lake', felt_waking: 'Calm' }),
 entry('f', 'therapy', dk(-7), { topics: 'Work stress', mood_after: '4', hard: 'Talking about my dad', next: 'My dad and the holidays' }),
 entry('g', 'daily', dk(-2), { on_mind: '<img src=x onerror="window.__xss=1"> tired', day_rating: '5', feeling: 'Calm', hard: 'Could not sleep' }),
 entry('h', 'daily', dk(0), { on_mind: 'Finished the audit', day_rating: '4', feeling: 'Grateful' }),
].forEach((e) => journalEntries.push(e));
saveJournalEntries(); selectedJournalFilter = 'all'; journalSearchTerm = ''; journalScrollMode = 'end'; renderJournal();
const order = () => [...$('journal-list').children].map((c) => c.dataset.entryId).join('');
check('entries run oldest to newest, left to right', order() === 'abcdefgh', order());
check('one date button per entry, in the same order', [...document.querySelectorAll('.journal-date-chip')].length === 8);
check('a past year shows its year on the button', (() => { journalEntries.push(entry('old', 'daily', '2025-12-03', { on_mind: 'x' })); renderJournal(); const t = document.querySelector('.journal-date-chip').textContent; journalEntries.pop(); renderJournal(); return /'25/.test(t); })());
check('the date strip is built from the dates', [...document.querySelectorAll('.journal-date-chip')][0].textContent.length > 3);
check('filtering to dreams shows only dreams', (() => { [...document.querySelectorAll('#journal-filters .chip')].find((c) => c.textContent === 'Dreams').click(); const r = order(); [...document.querySelectorAll('#journal-filters .chip')].find((c) => c.textContent === 'All').click(); return r === 'e'; })());

// ---- search ----
const search = (t) => { $('journal-search-input').value = t; $('journal-search-input').dispatchEvent(new Event('input', { bubbles: true })); return order(); };
check('search finds words in any answer', search('stress') === 'af', search('stress'));
check('search ignores case', search('HIKING') === 'd');
check('search can match the kind of entry', search('therapy') === 'cf');
check('search with no match shows nothing', search('zzzz') === '' && $('journal-nav').hidden);
check('clearing search brings everything back', search('') === 'abcdefgh');
check('search results say how many matched', (search('stress'), /2 entries match/.test($('journal-search-count').textContent)));
search('');

// ---- trends ----
$('journal-trends').open = true; renderJournalTrends();
check('the trend summary gives averages', /Day rating: average 3\.6 across 5 entries/.test($('journal-trend-summary').textContent), $('journal-trend-summary').textContent);
check('...and the direction', /trending up/.test($('journal-trend-summary').textContent));
check('therapy mood is a second line', /Mood after therapy: average 3\.5 across 2/.test($('journal-trend-summary').textContent));
check('the chart has a dot per rating', document.querySelectorAll('#journal-trend-chart .trend-dot').length === 7, document.querySelectorAll('#journal-trend-chart .trend-dot').length);
check('dots explain themselves for screen readers', /Day rating: 2 on/.test(document.querySelector('#journal-trend-chart .trend-dot title').textContent));
check('most-chosen feelings are listed', /Calm ×3/.test($('journal-trend-feelings').textContent), $('journal-trend-feelings').textContent);
[...document.querySelectorAll('#journal-trend-range .chip')].find((c) => c.textContent === '30 days').click();
check('30 days narrows the chart', document.querySelectorAll('#journal-trend-chart .trend-dot').length === 6);
journalEntries.length = 0; renderJournal();
check('with no ratings it says so instead of drawing', /No ratings/.test($('journal-trend-summary').textContent) && !$('journal-trend-chart').querySelector('svg'));
journalEntries.push(entry('one', 'daily', dk(-1), { on_mind: 'x', day_rating: '3' })); renderJournal();
check('a single rating draws without errors', document.querySelectorAll('#journal-trend-chart .trend-dot').length === 1);
journalEntries.push(entry('bad', 'daily', dk(-1), { on_mind: 'x', day_rating: 'abc' }), entry('bad2', 'daily', dk(-1), { on_mind: 'x', day_rating: '9' })); renderJournal();
check('junk ratings are ignored', document.querySelectorAll('#journal-trend-chart .trend-dot').length === 1);

// ---- therapy summary ----
journalEntries.length = 0;
[entry('t1', 'therapy', dk(-35), { topics: 'Old session', mood_after: '2' }),
 entry('t2', 'therapy', dk(-28), { topics: 'Boundaries', insight: 'I can say no', mood_after: '3', next: 'Old plan' }),
 entry('t5', 'therapy', dk(-7), { topics: 'Family', insight: 'Anger is a signal', hard: 'Talking about my dad', mood_after: '4', homework: 'Breathing', next: 'My dad and the holidays' }),
 entry('d1', 'daily', dk(-5), { on_mind: 'x', day_rating: '2', hard: 'Argument with my sister' }),
 entry('d2', 'daily', dk(-3), { on_mind: 'y', day_rating: '4' }),
 entry('d3', 'daily', dk(-1), { on_mind: 'z', day_rating: '3', hard: 'Could not sleep' }),
 entry('d0', 'daily', dk(-30), { on_mind: 'before', day_rating: '1', hard: 'should NOT appear' }),
 entry('dr', 'dream', dk(-2), { story: 'dream should not appear' }),
].forEach((e) => journalEntries.push(e));
saveJournalEntries(); renderJournal();
$('therapy-summary-btn').click(); await sleep(60);
let text = $('therapy-summary-body').textContent;
check('the summary opens as a dialog and moves focus in', !$('therapy-summary').hidden && $('therapy-summary').contains(document.activeElement));
check('"to bring up next time" comes from the latest session', (() => { const h = $('therapy-summary-body').querySelector('h3'); return /^To bring up next time$/.test(h.textContent) && h.nextElementSibling.textContent === 'My dad and the holidays'; })());
check('it counts only journal entries after the last session', /3 journal entries, average day rating 3\.0 \/ 5/.test(text));
check('it lists what was hard since then, and nothing older', /Argument with my sister/.test(text) && /Could not sleep/.test(text) && !/should NOT appear/.test(text));
check('dreams are left out', !/dream should not appear/.test(text));
check('only the chosen number of sessions is shown', document.querySelectorAll('#therapy-summary-body .summary-session').length === 3);
$('therapy-summary-count').value = '3'; $('therapy-summary-count').dispatchEvent(new Event('change'));
const plain = buildTherapySummaryText(buildTherapySummaryData(5));
check('the copy-able text has the same parts', /TO BRING UP NEXT TIME/.test(plain) && /SINCE THE LAST SESSION/.test(plain) && /Argument with my sister/.test(plain));
let copied = null;
Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { copied = t; } }, configurable: true });
$('therapy-summary-copy').click(); await sleep(60);
check('Copy writes the text and says so', copied && /Copied/.test($('therapy-summary-status').textContent));
Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('blocked'); } }, configurable: true });
$('therapy-summary-copy').click(); await sleep(60);
check('a blocked clipboard falls back to selecting the text', /selected/.test($('therapy-summary-status').textContent));
check('the print style leaves only the summary on the page', [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch { return []; } }).some((r) => r.media && /print/.test(r.conditionText) && /summary-open/.test(r.cssText)));
document.activeElement.blur();
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
check('Tab from the page body goes into the dialog, not behind it', $('therapy-summary').contains(document.activeElement));
document.activeElement.blur();
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
check('Escape closes it from anywhere', $('therapy-summary').hidden && !document.body.classList.contains('summary-open'));
journalEntries.push(entry('t9', 'therapy', dk(-2), { topics: 'Short check-in' })); saveJournalEntries();
$('therapy-summary-btn').click(); await sleep(40);
check('if the newest session has no note, an older note is shown with its date', /To bring up next time \(from /.test($('therapy-summary-body').textContent));
$('therapy-summary-close').click();
journalEntries.length = 0; $('therapy-summary-btn').click(); await sleep(40);
check('with no sessions it says so and disables print and copy', /No therapy sessions/.test($('therapy-summary-body').textContent) && $('therapy-summary-print').disabled && $('therapy-summary-copy').disabled);
$('therapy-summary-close').click();

// ---- backup and restore ----
journalEntries.push(entry('k1', 'daily', dk(-1), { on_mind: 'restore me' }), entry('k2', 'therapy', dk(-2), { topics: 'restore too' })); saveJournalEntries();
const backup = JSON.stringify({ journal: journalEntries });
journalEntries.length = 0; saveJournalEntries();
const input = $('journal-import-file');
const dt = new DataTransfer(); dt.items.add(new File([backup], 'b.json', { type: 'application/json' })); input.files = dt.files;
input.dispatchEvent(new Event('change', { bubbles: true })); await sleep(200);
check('restoring a backup brings the entries back', journalEntries.length === 2 && /Restored 2/.test($('journal-backup-status').textContent), $('journal-backup-status').textContent);
const dt2 = new DataTransfer(); dt2.items.add(new File([backup], 'b.json', { type: 'application/json' })); input.files = dt2.files;
input.dispatchEvent(new Event('change', { bubbles: true })); await sleep(200);
check('restoring the same backup again adds nothing', journalEntries.length === 2);
const dt3 = new DataTransfer(); dt3.items.add(new File(['{"journal":[{"id":"x","type":"nope","date":"d","answers":{}}, 5, null]}'], 'b.json')); input.files = dt3.files;
input.dispatchEvent(new Event('change', { bubbles: true })); await sleep(200);
check('malformed entries in a backup are skipped', journalEntries.length === 2);
