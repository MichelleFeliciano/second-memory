// The app's side of syncing, against a small pretend server: syncing only happens when asked,
// only changed records are sent, nothing is lost when something changes mid-sync, and the
// "N changes not synced" note stays honest. (The real server is covered by test_sync_server.py.)
const now = new Date().toISOString();
const rec = (id, item) => ({ id, item, quantity: '', checked: false, category: '', dateAdded: now, updatedAt: now, deviceId: 'other', deleted: false, version: 1 });

const server = { collections: {}, calls: [], mode: 'ok', omit: null, gate: null };
SYNC_COLLECTIONS.forEach((c) => { server.collections[c.name] = []; });
const strip = (r) => JSON.stringify({ ...r, version: 0, updatedAt: 0, deviceId: 0 });
function fakeMerge(incoming) {
  for (const [name, items] of Object.entries(incoming)) {
    const list = server.collections[name];
    if (!list) continue;
    for (const inc of items) {
      const existing = list.find((r) => r.id === inc.id);
      if (!existing) list.push({ ...inc, version: 1 });
      else if ((inc.version || 0) >= existing.version && strip(inc) !== strip(existing)) Object.assign(existing, { ...inc, version: existing.version + 1 });
    }
  }
}
window.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  server.calls.push({ url, headers: opts.headers, body });
  if (server.gate) await server.gate;
  if (server.mode === '426') return new Response('{}', { status: 426 });
  if (server.mode === '401') return new Response('{}', { status: 401 });
  if (server.mode === 'down') throw new Error('offline');
  fakeMerge(body.collections);
  const out = {};
  Object.keys(server.collections).forEach((n) => { out[n] = JSON.parse(JSON.stringify(server.collections[n])); });
  if (server.omit) delete out[server.omit];
  return new Response(JSON.stringify({ collections: out, conflicts: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const sentIds = (call, name) => (call.body.collections[name] || []).map((r) => r.id);
const status = () => $('sync-status-text').textContent;
const pending = () => ($('sync-pending').hidden ? '' : $('sync-pending').textContent);
$('sync-status').hidden = false;

// ---- manual only ----
await runSync();
check('without a passphrase, sync does nothing', server.calls.length === 0);
localStorage.setItem('secondMemory.syncConfig.v1', JSON.stringify({ token: 'tok' }));
document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('online'));
await sleep(1500);
check('nothing syncs by itself (not on a timer, on returning, or on reconnecting)', server.calls.length === 0);
check('the sync button exists and is the only trigger', !!$('sync-now-btn'));

// ---- the first sync only pulls, then sends what is new here ----
server.collections.shoppingList.push(rec('srv1', 'From the server'));
addShoppingItem('Local milk', '', '');
const localMilkId = shoppingItems.find((i) => i.item === 'Local milk').id;
await runSync(); await sleep(100);
check('the first request sends nothing (it only pulls)', server.calls[0] && Object.values(server.calls[0].body.collections).every((a) => a.length === 0), JSON.stringify(Object.keys(server.calls[0] ? server.calls[0].body.collections : {})));
check('the second request sends only the record that is new here', server.calls[1] && sentIds(server.calls[1], 'shoppingList').join() === localMilkId);
check('the server record arrived', shoppingItems.some((i) => i.id === 'srv1'));
check('the server received the local record', server.collections.shoppingList.some((i) => i.id === localMilkId));
check('requests carry the app version and passphrase', server.calls[1].body.clientVersion === 2 && server.calls[1].headers['X-Sync-Token'] === 'tok');
check('status says synced', /Synced just now/.test(status()), status());
check('nothing is left unsynced', pending() === '' && !$('sync-now-btn').classList.contains('sync-needed'), pending());

// ---- only changed records are sent after that ----
const callsBefore = server.calls.length;
await runSync(); await sleep(60);
check('with no changes, nothing is sent', server.calls.length === callsBefore + 1 && Object.values(server.calls[server.calls.length - 1].body.collections).every((a) => a.length === 0));
addShoppingItem('Eggs', '', ''); addShoppingItem('Bread', '', '');
await sleep(500);
check('the indicator counts changes', /2 changes not synced/.test(pending()) && $('sync-now-btn').classList.contains('sync-needed'), pending());
await runSync(); await sleep(60);
const last = server.calls[server.calls.length - 1];
check('only the two new records are sent', sentIds(last, 'shoppingList').length === 2 && Object.entries(last.body.collections).filter(([n, a]) => n !== 'shoppingList' && a.length).length === 0);
check('the indicator clears after syncing', pending() === '' && !$('sync-now-btn').classList.contains('sync-needed'));
deleteShoppingItem(shoppingItems.find((i) => i.item === 'Eggs').id);
await sleep(500);
check('a delete counts as a change', /1 change not synced/.test(pending()));
await runSync(); await sleep(60);

// ---- a stale copy is never resent over someone else's delete ----
const stale = shoppingItems.find((i) => i.item === 'Bread');
const serverBread = server.collections.shoppingList.find((i) => i.id === stale.id);
Object.assign(serverBread, { deleted: true, version: serverBread.version + 1 });
const before = server.calls.length;
await runSync(); await sleep(60);
check('the unchanged local copy is not sent', sentIds(server.calls[before], 'shoppingList').indexOf(stale.id) === -1);
check('the delete made elsewhere arrives', shoppingItems.find((i) => i.id === stale.id).deleted === true);

// ---- changing something while a sync is running ----
let release;
server.gate = new Promise((r) => { release = r; });
addShoppingItem('Sent before', '', '');
const running = runSync();
check('the Sync now button is disabled while syncing', $('sync-now-btn').disabled === true);
await sleep(30);
addShoppingItem('Added mid-sync', '', '');
const sentBeforeId = shoppingItems.find((i) => i.item === 'Sent before').id;
deleteShoppingItem(sentBeforeId);                       // changed after it was already sent
server.gate = null; release();
await running; await sleep(60);
check('a record changed mid-sync is kept', shoppingItems.some((i) => i.item === 'Added mid-sync'));
check('a delete made mid-sync is not lost', shoppingItems.find((i) => i.id === sentBeforeId).deleted === true);
check('it tells you to sync again', /Tap Sync now again/.test(status()), status());
check('the button works again', $('sync-now-btn').disabled === false);
await runSync(); await sleep(60);
check('the next sync sends the mid-sync changes', server.collections.shoppingList.some((i) => i.item === 'Added mid-sync') && server.collections.shoppingList.find((i) => i.id === sentBeforeId).deleted === true);
check('then everything is in step', pending() === '');

// ---- a server that lost its data is refilled, nothing is dropped ----
const localCount = shoppingItems.length;
server.collections.shoppingList = [];
await runSync(); await sleep(60);
check('local data is kept when the server comes back empty', shoppingItems.length === localCount);
await runSync(); await sleep(60);
check('the next sync sends it all back', server.collections.shoppingList.length === localCount, server.collections.shoppingList.length + ' of ' + localCount);

// ---- problems are reported plainly ----
server.mode = '426'; await runSync(); await sleep(30);
check('an out-of-date copy is told to reload', /out of date/.test(status()), status());
server.mode = '401'; await runSync(); await sleep(30);
check('a wrong passphrase is reported', /check passphrase/i.test(status()), status());
server.mode = 'down'; await runSync(); await sleep(30);
check('no connection is reported with a way forward', /tap Sync now to try again/.test(status()), status());
server.mode = 'ok'; server.omit = 'books'; await runSync(); await sleep(30);
check('a reply missing a list is not called "synced"', /incomplete/.test(status()), status());
server.omit = null; await runSync(); await sleep(30);
check('it recovers on the next try', /Synced just now/.test(status()));

// ---- passphrases ----
check('plain passphrases are sent as typed', syncTokenHeader('abc123') === 'abc123');
check('accented passphrases are encoded for the header', syncTokenHeader('pässword') === 'u:p%C3%A4ssword');
localStorage.setItem('secondMemory.syncSnapshot.v1', JSON.stringify({ shoppingList: { x: '{}' } }));
$('sync-token-input').value = 'a-different-passphrase';
$('sync-setup-form').requestSubmit(); await sleep(300);
check('changing the passphrase starts fresh bookkeeping', !(JSON.parse(localStorage.getItem('secondMemory.syncSnapshot.v1') || '{}').shoppingList || {}).x);

// ---- a slow (sleeping) server is explained, not left looking stuck ----
localStorage.setItem('secondMemory.syncConfig.v1', JSON.stringify({ token: 'tok' }));
let wake;
server.gate = new Promise((r) => { wake = r; });
SYNC_WAKE_NOTICE_MS = 80;
const slow = runSync();
await sleep(300);
check('after a few seconds it says the server may be waking up', /waking up/.test(status()), status());
server.gate = null; wake();
await slow; await sleep(60);
check('and finishes normally when the server answers', /Synced just now/.test(status()), status());
const realFetch = window.fetch;
window.fetch = () => { const e = new Error('aborted'); e.name = 'AbortError'; return Promise.reject(e); };
await runSync(); await sleep(30);
check('a request that times out says so', /timed out/i.test(status()), status());
window.fetch = realFetch;
SYNC_WAKE_NOTICE_MS = 5000;
