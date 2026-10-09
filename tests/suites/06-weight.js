// Weight tracker: the four headline figures, validation, editing, deleting and undo.
const now = new Date().toISOString();
const w = (id, date, weight, added) => ({ id, date, weight, note: '', dateAdded: added || now, updatedAt: now, deviceId: 'test', deleted: false, version: 0 });
const stat = (name) => document.querySelector('#weight-stats [data-stat="' + name + '"] .weight-stat-value').textContent;
const liveW = () => weights.filter((x) => !x.deleted);

// ---- pure stats ----
check('no entries gives no stats', computeWeightStats([]) === null);
const s1 = computeWeightStats([w('a', '2026-03-01', 160), w('b', '2026-01-01', 180), w('c', '2026-02-01', 150), w('d', '2026-04-01', 155), w('e', '2026-05-01', 150)]);
check('oldest is the earliest date', s1.oldest.id === 'b');
check('most recent is the latest date', s1.recent.id === 'e');
check('highest is the biggest weight', s1.highest.id === 'b');
check('lowest tie goes to the earliest date', s1.lowest.id === 'c');
check('deleted entries are ignored', computeWeightStats([{ ...w('x', '2026-01-01', 99), deleted: true }, w('y', '2026-02-01', 120)]).oldest.id === 'y');
check('one entry fills all four', (() => { const s = computeWeightStats([w('z', '2026-01-01', 130)]); return s.oldest.id === 'z' && s.highest.id === 'z' && s.lowest.id === 'z' && s.recent.id === 'z'; })());
check('same-day entries: the later-added is most recent', computeWeightStats([w('p', '2026-01-01', 130, '2026-01-01T08:00:00Z'), w('q', '2026-01-01', 131, '2026-01-01T20:00:00Z')]).recent.id === 'q');

// ---- the screen ----
weights.length = 0;
nav('weight');
check('empty state shows when there are no entries', !$('weight-empty-state').hidden);
check('stats show dashes when empty', stat('oldest') === '—' && stat('recent') === '—');
const add = async (date, value, note) => { set('weight-date-input', date); set('weight-value-input', value); set('weight-note-input', note || ''); $('weight-add-form').requestSubmit(); await sleep(30); };
await add(dk(-30), '180.04'); await add(dk(-20), '165'); await add(dk(-10), '190.5'); await add(dk(-1), '172', 'after trip');
check('four entries saved', liveW().length === 4, String(liveW().length));
check('weight is rounded to one decimal', liveW().some((x) => x.weight === 180));
check('oldest card', stat('oldest') === '180.0 lb', stat('oldest'));
check('highest card', stat('highest') === '190.5 lb', stat('highest'));
check('lowest card', stat('lowest') === '165.0 lb', stat('lowest'));
check('most recent card', stat('recent') === '172.0 lb', stat('recent'));
check('history lists them newest first', (() => { const v = [...document.querySelectorAll('#weight-list .weight-entry-value')].map((e) => e.textContent); return v.length === 4 && v[0].startsWith('172'); })());
check('empty state hides', $('weight-empty-state').hidden);
check('the date field resets to today', $('weight-date-input').value === todayKey());

// ---- validation ----
const n = liveW().length;
await add(dk(1), '150');
check('a future date is refused', liveW().length === n && !$('weight-form-error').hidden);
check('zero is refused', !validateWeightFields({ date: dk(0), value: '0' }).ok);
check('negative is refused', !validateWeightFields({ date: dk(0), value: '-5' }).ok);
check('absurdly large is refused', !validateWeightFields({ date: dk(0), value: '9999' }).ok);
check('validator rejects fake dates', !validateWeightFields({ date: '2026-02-31', value: '150' }).ok);

// ---- edit ----
const cards = [...document.querySelectorAll('#weight-list .weight-card')];
const oldestCard = cards[cards.length - 1];
oldestCard.querySelector('.edit-btn').click();
const form = oldestCard.querySelector('.weight-edit-form');
check('edit form opens prefilled', !form.hidden && form.querySelector('.weight-edit-value').value === '180');
form.querySelector('.weight-edit-value').value = '200';
form.requestSubmit(); await sleep(30);
check('edit saves and the highest updates', stat('highest') === '200.0 lb', stat('highest'));
check('edit form closes', ![...document.querySelectorAll('#weight-list .weight-edit-form')].some((f) => !f.hidden));
document.querySelector('#weight-list .edit-btn').click();
const f2 = document.querySelector('#weight-list .weight-edit-form:not([hidden])');
f2.querySelector('.weight-edit-value').required = false;
f2.querySelector('.weight-edit-value').value = '';
f2.requestSubmit(); await sleep(30);
check('a bad edit stays open with an error', !f2.hidden && !f2.querySelector('.weight-edit-error').hidden);
f2.querySelector('.cancel-btn').click();

// ---- delete + undo ----
const count = liveW().length;
document.querySelector('#weight-list .delete-btn').click(); await sleep(30);
check('delete removes it', liveW().length === count - 1);
$('undo-btn').click(); await sleep(30);
check('undo brings it back', liveW().length === count);
liveW().forEach((x) => deleteWeight(x.id));
check('deleting everything restores the empty state', !$('weight-empty-state').hidden && stat('lowest') === '—');

// ---- import ----
check('import validator rejects bad weights', !isValidImportRecord('weights', { id: 'b1', date: '2026-01-01', weight: -3 }) && !isValidImportRecord('weights', { id: 'b2', date: 'nope', weight: 150 }));
check('import validator accepts a good one', isValidImportRecord('weights', w('ok', '2026-01-01', 150)));
