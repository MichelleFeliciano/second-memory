// Version info and What's new, the backup file format, Check-first import, Recently deleted, storage and offline notes.
const stampC = new Date().toISOString();
const baseC = { dateAdded: stampC, updatedAt: stampC, deviceId: 'test', deleted: false, version: 0 };

// ---- versions ----
check('the Menu shows the version and the day it was made', new RegExp('Version ' + APP_VERSION + ' · updated ').test($('app-version').textContent) && $('app-version').textContent.includes(formatDateKeyLong(APP_UPDATED)), $('app-version').textContent);
check('the change list starts with this version, dated the same day, and is newest first', CHANGES[0].version === APP_VERSION && CHANGES[0].date === APP_UPDATED && CHANGES.every((c, i) => i === 0 || c.version < CHANGES[i - 1].version) && CHANGES.every((c) => isRealDateKey(c.date) && c.notes.length > 0));
$('whatsnew-box').open = true;
check('Menu, What\'s new lists every version with its date', document.querySelectorAll('#whatsnew-list h4').length === CHANGES.length && /Version \d+ · /.test($('whatsnew-list').textContent));
localStorage.setItem(LAST_SEEN_VERSION_KEY, String(APP_VERSION - 1)); hideToast(); announceUpdate();
check('after an update a note says so once', !$('toast').hidden && /Updated to version/.test($('toast-text').textContent) && localStorage.getItem(LAST_SEEN_VERSION_KEY) === String(APP_VERSION));
hideToast(); announceUpdate();
check('and not again for the same version', $('toast').hidden);
localStorage.removeItem(LAST_SEEN_VERSION_KEY); announceUpdate();
check('and never on the very first visit', $('toast').hidden && localStorage.getItem(LAST_SEEN_VERSION_KEY) === String(APP_VERSION));

// ---- backup file format ----
const out = buildExportPayload();
check('a backup says what it is, its format version, which app version made it and when', out.format === 'second-memory-export' && out.formatVersion === EXPORT_FORMAT_VERSION && out.appVersion === APP_VERSION && !Number.isNaN(Date.parse(out.exportedAt)) && !!out.collections && !!out.local);
notes.length = 0; links.length = 0; books.length = 0; recipes.length = 0; facts.length = 0; customLists.length = 0;
importData({ ...out, formatVersion: EXPORT_FORMAT_VERSION + 1, collections: { notes: [{ ...baseC, id: 'nf1', title: 'From the future', body: '' }] } });
check('a file from a newer format is refused with a clear message', /newer version/.test($('data-io-status').textContent) && notes.length === 0);
importData({ collections: { notes: [{ ...baseC, id: 'nf2', title: 'Old file without a format', body: '' }] } });
check('an older file with no format number still imports', notes.length === 1);
notes.length = 0;

// ---- Check first ----
notes.push({ ...baseC, id: 'cf1', title: 'Already here', body: '' });
const file = { format: 'second-memory-export', formatVersion: 2, appVersion: 70, collections: { notes: [{ ...baseC, id: 'cf1', title: 'Already here', body: '' }, { ...baseC, id: 'cf2', title: 'Brand new', body: '' }, { ...baseC, id: 'cf3', title: 5, body: 5 }], books: [{ ...baseC, id: 'cb1', title: 'A book', status: 'owned_read' }, { ...baseC, id: 'cb2', title: 'Bad status', status: 'nope' }] }, local: { journal: [{ id: 'j1', type: 'daily', date: dk(0), answers: {} }] } };
const described = describeImport(file);
check('the preview counts new, already-here and unreadable records per list', !!described && described.lines.some((l) => /^Notes: 1 new, 1 already here, 1 unreadable/.test(l)) && described.lines.some((l) => /^Books: 1 new, 0 already here, 1 unreadable/.test(l)) && described.lines.some((l) => /^Journal: 1 new/.test(l)) && described.anyNew, JSON.stringify(described));
check('something that is not a backup has no preview', describeImport({ hello: 1 }) === null);
showImportPreview(file);
check('Check first shows the counts and saves nothing yet', !$('import-preview').hidden && /would add/.test($('import-preview-text').textContent) && /made by version 70/.test($('import-preview-text').textContent) && notes.length === 1 && books.length === 0);
$('import-preview-cancel').click();
check('Cancel leaves everything as it was', $('import-preview').hidden && notes.length === 1 && books.length === 0 && /cancelled/i.test($('data-io-status').textContent));
showImportPreview(file); $('import-preview-go').click();
check('Import then merges, skipping what is already here', notes.length === 2 && books.length === 1 && notes.filter((n) => n.id === 'cf1').length === 1 && /Import complete/.test($('data-io-status').textContent));
showImportPreview({ hello: 1 });
check('a file that is not a backup is reported at once', $('import-preview').hidden && /doesn't look like a Second Memory export/.test($('data-io-status').textContent));
showImportPreview(out);
check('a file with nothing new says so', /nothing to add|would add/.test($('import-preview-text').textContent));
$('import-preview-cancel').click();
notes.length = 0; books.length = 0; renderNotes(); renderBooks();

// ---- Recently deleted ----
notes.push({ ...baseC, id: 'rd1', title: 'Gone note', body: '', deleted: true, updatedAt: new Date(Date.now() - 1000).toISOString() });
books.push({ ...baseC, id: 'rd2', title: 'Gone book', author: '', status: 'owned_read', deleted: true });
notes.push({ ...baseC, id: 'rd3', title: 'Kept note', body: '' });
$('deleted-box').open = true; renderRecentlyDeleted();
const rdRows = () => [...document.querySelectorAll('#deleted-list li')];
check('Recently deleted lists deleted records from every list, newest first, and not live ones', rdRows().length === 2 && /Books: Gone book/.test(rdRows()[0].textContent) && /Notes: Gone note/.test(rdRows()[1].textContent) && !/Kept note/.test($('deleted-list').textContent), rdRows().map((r) => r.textContent).join(' | '));
rdRows()[1].querySelector('button').click();
check('Restore brings the record back and updates the list', notes.find((n) => n.id === 'rd1').deleted === false && rdRows().length === 1);
rdRows()[0].querySelector('button').click();
check('and an empty list says so', books.find((b) => b.id === 'rd2').deleted === false && /Nothing deleted lately/.test($('deleted-list').textContent));
notes.length = 0; books.length = 0; renderNotes(); renderBooks(); $('deleted-box').open = false;

// ---- storage space ----
const realStorage = Object.getOwnPropertyDescriptor(navigator, 'storage');
const fakeStorage = (usage, quota) => Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate: async () => ({ usage, quota }) } });
fakeStorage(50, 100); document.getElementById('storage-warning')?.remove();
await checkStorageSpace();
check('half full gives no warning', !document.getElementById('storage-warning') && (await storageFullness()) === 0.5);
fakeStorage(85, 100); await checkStorageSpace();
check('80% or more warns once, with a dismiss button', !!document.getElementById('storage-warning') && /85% full/.test(document.getElementById('storage-warning').textContent));
await checkStorageSpace();
check('(and only one warning)', document.querySelectorAll('#storage-warning').length === 1);
document.getElementById('storage-warning').remove();
await renderSettingsCheck();
check('the Settings check shows how full storage is', /Storage: 85%/.test($('settings-check-list').textContent));
Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined });
check('a browser that cannot say gives no answer and no warning', (await storageFullness()) === null);
if (realStorage) Object.defineProperty(navigator, 'storage', realStorage); else delete navigator.storage;

// ---- offline note ----
const realOnline = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');
Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
window.dispatchEvent(new Event('offline'));
check('going offline shows the note', !$('offline-note').hidden && /offline/i.test($('offline-note').textContent));
Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
window.dispatchEvent(new Event('online'));
check('coming back hides it', $('offline-note').hidden);
delete navigator.onLine;
