// Password vault: encryption, locking, add/edit/delete, generator, backup, and keeping it out of everything else.
// A small round count keeps the key derivation fast here; the real default is checked separately.
const SECRET = 'hunter2-Correct-Horse';
const MASTER = 'a long master passphrase';
check('the real default is 600,000 rounds', VAULT_ITERATIONS === 600000);
VAULT_ITERATIONS = 1000;
localStorage.removeItem(VAULT_KEY);
nav('passwords');

// ---- first visit: create ----
check('with no vault the create form shows and the rest is hidden', !$('vault-setup').hidden && $('vault-unlock').hidden && $('vault-open').hidden);
check('the vault is not part of the synced lists', !SYNC_COLLECTIONS.some((c) => /vault|password/i.test(c.name)));
set('vault-new-password', 'short'); set('vault-new-confirm', 'short'); $('vault-setup').requestSubmit(); await sleep(50);
check('a short master password is refused', /at least 10/.test($('vault-setup-error').textContent) && !loadVaultBlob());
set('vault-new-password', MASTER); set('vault-new-confirm', 'something else entirely'); $('vault-setup').requestSubmit(); await sleep(50);
check('two different master passwords are refused', /do not match/.test($('vault-setup-error').textContent) && !loadVaultBlob());
set('vault-new-password', MASTER); set('vault-new-confirm', MASTER); $('vault-setup').requestSubmit(); await sleep(300);
check('creating the vault opens it', !!loadVaultBlob() && !$('vault-open').hidden && $('vault-setup').hidden && vaultKey !== null);
check('the stored blob has the expected shape and no master password', (() => { const raw = localStorage.getItem(VAULT_KEY); const b = JSON.parse(raw); return b.v === 1 && b.iter === 1000 && !raw.includes(MASTER) && Object.keys(b).sort().join() === 'data,iter,iv,salt,v'; })());

// ---- add ----
$('vault-add-details').open = true;
set('vault-site', 'Example Bank'); set('vault-username', 'me@example.com'); set('vault-password', SECRET); set('vault-url', 'bank.example.com'); set('vault-notes', 'first card');
$('vault-form').requestSubmit(); await sleep(150);
check('a password can be added', vaultEntries.length === 1 && vaultEntries[0].site === 'Example Bank' && vaultEntries[0].password === SECRET);
check('the form closes and clears after adding', !$('vault-add-details').open && $('vault-site').value === '' && $('vault-password').value === '');
check('nothing readable is stored: no site, username, password or notes in the saved text', (() => { const raw = localStorage.getItem(VAULT_KEY); return !/Example|me@example|hunter2|first card/.test(raw); })());
set('vault-site', ''); set('vault-password', 'x'); $('vault-form').requestSubmit(); await sleep(50);
check('a missing site is refused', /website or app/.test($('vault-form-error').textContent) && vaultEntries.length === 1);
set('vault-site', 'No password'); set('vault-password', ''); $('vault-form').requestSubmit(); await sleep(50);
check('a missing password is refused', /Enter the password/.test($('vault-form-error').textContent) && vaultEntries.length === 1);
resetVaultForm();

// ---- the list ----
const card = () => document.querySelector('#vault-list .vault-entry');
check('the list shows the site and username, and the password only as dots', /Example Bank/.test(card().textContent) && /me@example\.com/.test(card().textContent) && !card().textContent.includes(SECRET) && /•{3,}/.test(card().querySelector('.vault-password').textContent));
card().querySelector('.vault-toggle').click();
check('Show reveals the password and Hide covers it again', card().querySelector('.vault-password').textContent === SECRET && card().querySelector('.vault-toggle').textContent === 'Hide');
card().querySelector('.vault-toggle').click();
check('hidden again', !card().textContent.includes(SECRET));
check('a web address without a scheme becomes a safe https link', card().querySelector('a').href === 'https://bank.example.com/' && card().querySelector('a').rel.includes('noopener'));
check('only web addresses become links', safeVaultUrl('javascript:alert(1)') === null && safeVaultUrl('data:text/html,x') === null && safeVaultUrl('http://a.example') === 'http://a.example/' && safeVaultUrl('') === null);

// ---- copy ----
const realClip = navigator.clipboard;
let clip = null;
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (s) => { clip = s; } } });
VAULT_CLIPBOARD_MS = 80;
card().querySelector('.vault-copy-password').click(); await sleep(30);
check('Copy password copies it and says it will be cleared', clip === SECRET && /cleared/.test($('toast-text').textContent));
await sleep(150);
check('the clipboard is wiped after the delay', clip === '');
card().querySelector('.vault-copy-username').click(); await sleep(30);
check('Copy username copies the username and leaves the clipboard alone afterwards', clip === 'me@example.com');
await sleep(150);
check('(a copied username is not wiped)', clip === 'me@example.com');
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: realClip });
VAULT_CLIPBOARD_MS = 30000; hideToast();

// ---- edit and search ----
card().querySelector('.vault-edit').click();
check('Edit loads the entry into the form', $('vault-site').value === 'Example Bank' && $('vault-password').value === SECRET && /Edit password/.test($('vault-form-title').textContent) && /Save changes/.test($('vault-save-btn').textContent));
set('vault-site', 'Example Bank (main)'); $('vault-form').requestSubmit(); await sleep(150);
check('saving an edit changes the entry in place', vaultEntries.length === 1 && vaultEntries[0].site === 'Example Bank (main)' && /Add a password/.test($('vault-form-title').textContent));
set('vault-site', 'Zeta Mail'); set('vault-username', 'zed'); set('vault-password', 'pw-two-2'); $('vault-form').requestSubmit(); await sleep(150);
check('the list is sorted by site', [...document.querySelectorAll('#vault-list .vault-entry strong')].map((e) => e.textContent).join('|') === 'Example Bank (main)|Zeta Mail');
set('vault-search', 'zed'); $('vault-search').dispatchEvent(new Event('input'));
check('the search box filters the list by site, username and address', document.querySelectorAll('#vault-list .vault-entry').length === 1 && /Zeta/.test(card().textContent));
set('vault-search', ''); $('vault-search').dispatchEvent(new Event('input'));

// ---- never searched, summarised or undone ----
check('the global search never finds a saved password', (() => { const groups = runGlobalSearch('Zeta', false); return groups.every((g) => !/zeta/i.test(JSON.stringify(g.hits))) ; })());
undoStack.length = 0; updateUndoRedoButtons();
check('vault changes never enter the Undo history', undoStack.length === 0);
check('the health summary and a plain data export never hold a password', (() => { const text = JSON.stringify(buildExportPayload().collections) + buildHealthSummaryText(buildHealthSummaryData()); return !/pw-two|hunter2/.test(text); })());
check('the full backup carries only the encrypted blob', (() => { const out = JSON.stringify(buildExportPayload()); return !/pw-two|hunter2|Zeta Mail/.test(out) && buildExportPayload().local.vault.data === loadVaultBlob().data; })());

// ---- lock and unlock ----
$('vault-lock-btn').click();
check('Lock now forgets the key and every decrypted entry', vaultKey === null && vaultEntries.length === 0 && !$('vault-unlock').hidden && $('vault-open').hidden && document.querySelectorAll('#vault-list .vault-entry').length === 0);
check('while locked only the unlock form is really visible (not just flagged hidden)', getComputedStyle($('vault-unlock')).display !== 'none' && getComputedStyle($('vault-setup')).display === 'none' && getComputedStyle($('vault-open')).display === 'none');
check('nothing readable is left on the page while locked', !/Example|Zeta|hunter2|pw-two/.test($('passwords-collection').textContent));
set('vault-unlock-password', 'wrong password!'); $('vault-unlock').requestSubmit(); await sleep(150);
check('a wrong master password is refused and nothing opens', /Wrong master password/.test($('vault-unlock-error').textContent) && vaultKey === null);
set('vault-unlock-password', MASTER); $('vault-unlock').requestSubmit(); await sleep(150);
check('the right master password opens it with the entries back', vaultKey !== null && vaultEntries.length === 2 && !$('vault-open').hidden);
check('the master password box is emptied after trying', $('vault-unlock-password').value === '');

// ---- tampering ----
lockVault();
const original = localStorage.getItem(VAULT_KEY);
const tampered = JSON.parse(original);
const bytes = b64ToBytes(tampered.data); bytes[bytes.length - 1] ^= 1; tampered.data = bytesToB64(bytes);
localStorage.setItem(VAULT_KEY, JSON.stringify(tampered));
check('a changed vault file is refused even with the right password', (await unlockVault(MASTER)).ok === false && vaultKey === null);
localStorage.setItem(VAULT_KEY, original);
check('a damaged blob counts as no vault', (() => { localStorage.setItem(VAULT_KEY, '{"v":1}'); const none = loadVaultBlob() === null; localStorage.setItem(VAULT_KEY, original); return none; })());
check('the blob checker rejects wrong sizes and versions', parseVaultBlob({ ...JSON.parse(original), v: 2 }) === null && parseVaultBlob({ ...JSON.parse(original), iter: 5 }) === null && parseVaultBlob({ ...JSON.parse(original), salt: 'AAAA' }) === null && parseVaultBlob(null) === null);

// ---- five wrong tries pause ----
vaultFails = 0; vaultPausedUntil = 0;
for (let i = 0; i < 5; i++) await unlockVault('nope nope nope');
const paused = await unlockVault(MASTER);
check('five wrong tries in a row pause unlocking, even for the right password', paused.ok === false && /wait/i.test(paused.error), paused.error);
vaultPausedUntil = 0; vaultFails = 0;
check('after the pause the right password works', (await unlockVault(MASTER)).ok === true);

// ---- change master password ----
check('changing needs the right current password', (await changeMasterPassword('not it at all', 'brand new master pass')).ok === false);
check('and a long enough new one', (await changeMasterPassword(MASTER, 'short')).ok === false);
check('a good change works', (await changeMasterPassword(MASTER, 'brand new master pass')).ok === true);
const saltAfter = JSON.parse(localStorage.getItem(VAULT_KEY)).salt;
lockVault();
check('the old master password no longer opens it', (await unlockVault(MASTER)).ok === false);
check('the new one does, with the entries intact', (await unlockVault('brand new master pass')).ok === true && vaultEntries.length === 2);
const ivBefore = JSON.parse(localStorage.getItem(VAULT_KEY)).iv; await saveVault();
check('each save uses a fresh IV', JSON.parse(localStorage.getItem(VAULT_KEY)).iv !== ivBefore && JSON.parse(localStorage.getItem(VAULT_KEY)).salt === saltAfter);

// ---- delete ----
renderVault();
card().querySelector('.vault-delete').click(); await sleep(150);
check('Delete (after confirming) removes the password for good', vaultEntries.length === 1 && vaultEntries[0].site === 'Zeta Mail');

// ---- idle and app-lock locking ----
VAULT_IDLE_MS = 60; armVaultIdle(); await sleep(150);
check('the vault locks itself after being idle', vaultKey === null);
VAULT_IDLE_MS = 3 * 60000;
await unlockVault('brand new master pass'); renderVault();
$('passwords-collection').dispatchEvent(new Event('pointerdown', { bubbles: true }));
check('touching the vault restarts the idle timer instead of locking', vaultKey !== null);
localStorage.setItem(LOCK_KEY, JSON.stringify({ salt: '0'.repeat(32), hash: '0'.repeat(64) }));
lockNow();
check('the app lock also locks the vault', vaultKey === null && vaultEntries.length === 0);
localStorage.removeItem(LOCK_KEY); document.documentElement.removeAttribute('data-locked');
await unlockVault('brand new master pass');
vaultHiddenAt = Date.now() - 2 * 60000;
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
document.dispatchEvent(new Event('visibilitychange'));
delete document.visibilityState;
check('coming back after the app was out of sight a while locks the vault', vaultKey === null);

// ---- generator ----
const samples = Array.from({ length: 200 }, () => generatePassword(16));
check('generated passwords have the right length and are all different', samples.every((s) => s.length === 16) && new Set(samples).size === 200);
check('each has a lowercase, an uppercase, a digit and a symbol, and no look-alike letters', samples.every((s) => /[a-z]/.test(s) && /[A-Z]/.test(s) && /[0-9]/.test(s) && /[^A-Za-z0-9]/.test(s) && !/[lIO01]/.test(s)));
check('without symbols there are none', Array.from({ length: 50 }, () => generatePassword(12, { symbols: false })).every((s) => /^[A-Za-z0-9]+$/.test(s)));
check('a too-short length is raised to fit one of each kind', generatePassword(2).length === 4);
check('the random index is within range and covers it', (() => { const seen = new Set(); for (let i = 0; i < 400; i++) { const n = secureRandomIndex(7); if (n < 0 || n > 6) return false; seen.add(n); } return seen.size === 7; })());
check('the strength guess rises with length and variety', passwordStrength('abc').label === 'Weak' && passwordStrength('Abcdef12!xyz').bits > passwordStrength('abcdefghijkl').bits && passwordStrength(generatePassword(20)).label === 'Strong' && passwordStrength('').label === '');
await unlockVault('brand new master pass'); renderVault();
$('vault-generate').click();
check('Generate fills the password box, shows it and rates it', $('vault-password').value.length === 16 && $('vault-password').type === 'text' && /Strong|Good/.test($('vault-strength').textContent), $('vault-strength').textContent);
resetVaultForm();

// ---- backup file and restore ----
let downloaded = null;
const realCreate = URL.createObjectURL; URL.createObjectURL = (blob) => { downloaded = blob; return 'blob:test'; };
const realClick = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (!this.download) realClick.call(this); };
exportVaultFile();
check('Export vault file downloads exactly the stored encrypted blob', downloaded && (await downloaded.text()).includes(JSON.parse(localStorage.getItem(VAULT_KEY)).data) && !(await downloaded.text()).includes('pw-two') && daysSinceBackup(VAULT_BACKUP_AT_KEY) === 0);
URL.createObjectURL = realCreate; HTMLAnchorElement.prototype.click = realClick;
const keep = localStorage.getItem(VAULT_KEY);
check('a file that is not a vault is refused', restoreVaultFile('{"hello":1}') === false && localStorage.getItem(VAULT_KEY) === keep);
check('restoring a good file replaces the vault and locks it', restoreVaultFile(keep) === true && vaultKey === null && localStorage.getItem(VAULT_KEY) === keep);
check('and it still opens with its own master password', (await unlockVault('brand new master pass')).ok === true);

// ---- full backup restore onto a device with no vault ----
const exported = buildExportPayload();
lockVault(); localStorage.removeItem(VAULT_KEY);
importData(JSON.parse(JSON.stringify(exported)));
check('importing a full backup restores the encrypted vault when the device has none', localStorage.getItem(VAULT_KEY) === keep && /password vault/.test($('data-io-status').textContent), $('data-io-status').textContent);
const other = JSON.parse(keep); other.iv = bytesToB64(crypto.getRandomValues(new Uint8Array(12)));
localStorage.setItem(VAULT_KEY, JSON.stringify(other));
importData(JSON.parse(JSON.stringify(exported)));
check('but never replaces a vault that is already there', JSON.parse(localStorage.getItem(VAULT_KEY)).iv === other.iv);

// ---- Settings check ----
await renderSettingsCheck();
check('the Settings check reports the vault and its backup', /Password vault: locked/.test($('settings-check-list').textContent) && /Vault backup/.test($('settings-check-list').textContent));

// ---- forgot the master password ----
renderVault();
$('vault-forgot').click();
check('Erase the vault (after confirming) removes it and offers to create a new one', !loadVaultBlob() && !$('vault-setup').hidden && vaultKey === null);
await renderSettingsCheck();
check('the Settings check then says there is no vault', /Password vault: not created/.test($('settings-check-list').textContent));
VAULT_ITERATIONS = 600000;
