// Search everything (Home), and records with optional text fields missing.
const now = new Date().toISOString();
const base = { dateAdded: now, updatedAt: now, deviceId: 'test', deleted: false, version: 0 };

// ================= search everything =================
window.__xss = 0;
recipes.length = 0;
const b2 = { ...base };
recipes.push({ ...b2, id: 'r1', title: 'Garlic Chicken', category: 'Dinner', ingredients: ['3 cloves garlic', '2 lbs chicken'], steps: ['Mince the garlic'], notes: '' });
recipes.push({ ...b2, id: 'r2', title: 'Pasta', category: '', ingredients: ['garlic bread'], steps: [], notes: '' });
books.push({ ...b2, id: 'b1', title: 'The Garlic Cookbook', author: 'A. Chef', status: 'owned_read', rating: null });
notes.push({ ...b2, id: 'n1', title: 'Ideas', body: 'Remember to buy garlic and basil at the market for the weekend', dateModified: now });
notes.push({ ...b2, id: 'n2', title: 'Gone', body: 'garlic (deleted)', deleted: true, dateModified: now });
links.push({ ...b2, id: 'l1', label: 'Garlic farm', url: 'https://garlic.example', notes: '' });
journalEntries.push({ id: 'j1', type: 'daily', date: dk(-1), answers: { on_mind: 'A hard talk with dad about garlic' }, dateAdded: now, updatedAt: now }); saveJournalEntries();
renderHome(); nav('home'); await sleep(60);
const find = (term) => { set('global-search-input', term); $('global-search-input').dispatchEvent(new Event('input', { bubbles: true })); return [...document.querySelectorAll('#global-search-results h3')].map((h) => h.textContent); };
let groups = find('garlic');
check('all four lists are searched', groups.length === 4, groups.join(' | '));
check('the lists that moved to other apps are no longer searched', !groups.some((g) => /Medication|Diagnos|To-Do|Shopping/.test(g)));
check('deleted records never show up', groups.includes('Notes (1)'));
check('several matches in one list are counted', groups.includes('Recipes (2)'));
check('the journal is left out by default', !groups.some((g) => /Journal/.test(g)) && !/hard talk/.test($('global-search-results').textContent));
check('the rest of Home steps aside while searching', $('home-collection').classList.contains('is-searching') && getComputedStyle($('home-widgets')).display === 'none');
const noteHit = [...document.querySelectorAll('#global-search-results .search-hit')].find((b) => b.textContent.includes('Ideas'));
check('a result shows the match in context, highlighted', noteHit.querySelector('mark').textContent.toLowerCase() === 'garlic' && /buy|basil/.test(noteHit.textContent));
$('global-search-journal').checked = true; $('global-search-journal').dispatchEvent(new Event('change'));
check('ticking "Include my journal" searches it too', [...document.querySelectorAll('#global-search-results h3')].some((h) => /^Journal \(1\)/.test(h.textContent)));
$('global-search-journal').checked = false; $('global-search-journal').dispatchEvent(new Event('change'));
[...document.querySelectorAll('#global-search-results .search-hit')].find((b) => b.textContent.includes('Garlic Chicken')).click(); await sleep(100);
check('opening a result goes to that tab with its search box filled', !$('recipes-collection').hidden && $('recipes-search-input').value === 'garlic' && document.querySelectorAll('#recipes-list .recipe-card').length === 2);
nav('home'); await sleep(40);
find('a'); check('one letter asks for more', /at least 2/.test($('global-search-results').textContent));
find('zzzzqq'); check('no matches says so', /Nothing found for "zzzzqq"/.test($('global-search-results').textContent));
find('<img src=x onerror="window.__xss=1">'); check('markup typed into the box stays text', window.__xss === 0 && !$('global-search-results').querySelector('img'));
check('search ignores case', find('GARLIC').length === 4);
for (let i = 0; i < 7; i++) notes.push({ ...b2, id: 'nx' + i, title: 'Garlic bulb ' + i, body: '', dateModified: now });
find('garlic');
const more = [...document.querySelectorAll('#global-search-results .search-more')].find((b) => /Notes/.test(b.textContent));
check('a long list shows 5 results and a "See all" button', !!more && /See all 8 in Notes/.test(more.textContent));
more.click(); await sleep(60);
check('"See all" opens that tab, filtered', !$('notes-collection').hidden && $('notes-search-input').value === 'garlic');
nav('home'); await sleep(30); find('garlic');
$('global-search-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
check('Escape clears the search and brings Home back', $('global-search-input').value === '' && !$('home-collection').classList.contains('is-searching') && $('global-search-results').hidden);

// ---- records with optional text fields missing (older backups / other devices) ----
{
  const stamp = { dateAdded: new Date().toISOString(), updatedAt: new Date().toISOString(), deviceId: 'test', deleted: false, version: 1 };
  const sizes = [notes.length, links.length];
  notes.push({ ...stamp, id: 'mf-note', title: 'Title only', dateModified: stamp.updatedAt });
  links.push({ ...stamp, id: 'mf-link', label: 'Bare link', url: 'example.com' });
  ['notes-search-input', 'resume-search-input'].forEach((id) => { $(id).value = ''; }); // earlier checks left filters set
  let threw = false;
  try { renderNotes(); renderLinks(); } catch (e) { threw = true; }
  check('a note with no body, and a link with no notes, still draw', !threw);
  document.querySelector('[data-note-id="mf-note"] .edit-btn').click();
  document.querySelector('[data-link-id="mf-link"] .edit-btn').click();
  const boxes = ['#notes-list [data-note-id="mf-note"] .note-edit-body', '#resume-list [data-link-id="mf-link"] .link-edit-notes'].map((sel) => document.querySelector(sel));
  check('their edit boxes start empty, never the word "undefined"', boxes.every((el) => el && el.value === ''));
  notes.length = sizes[0]; links.length = sizes[1];
  renderNotes(); renderLinks();
}
