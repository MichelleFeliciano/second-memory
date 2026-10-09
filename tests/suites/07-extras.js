// Menu extras and Home helpers: the theme button, the version label, quick add, and the
// "you haven't synced in a while" reminder.

// ---- theme ----
const html = document.documentElement;
check('theme starts on Auto (no data-theme)', !html.hasAttribute('data-theme') && $('theme-btn').textContent === 'Theme: Auto');
$('theme-btn').click();
check('first tap picks Light', html.getAttribute('data-theme') === 'light' && $('theme-btn').textContent === 'Theme: Light' && localStorage.getItem('secondMemory.theme.v1') === 'light');
$('theme-btn').click();
check('second tap picks Dark', html.getAttribute('data-theme') === 'dark' && localStorage.getItem('secondMemory.theme.v1') === 'dark');
$('theme-btn').click();
check('third tap goes back to Auto and forgets the choice', !html.hasAttribute('data-theme') && localStorage.getItem('secondMemory.theme.v1') === null);
localStorage.setItem('secondMemory.theme.v1', 'purple');
check('a damaged saved theme means Auto', loadTheme() === 'auto');
localStorage.removeItem('secondMemory.theme.v1');

// ---- version label ----
check('the Menu shows the version', $('app-version').textContent === 'Version ' + APP_VERSION && Number.isInteger(APP_VERSION));

// ---- quick add on Home ----
nav('home');
const todosBefore = todos.filter((t) => !t.deleted).length;
const shopBefore = shoppingItems.filter((t) => !t.deleted).length;
const notesBefore = notes.filter((t) => !t.deleted).length;
const quick = (type, text) => { set('quick-add-type', type); set('quick-add-input', text); $('quick-add-form').requestSubmit(); };
quick('todo', 'Quick task');
quick('shopping', 'Quick apples');
quick('note', 'Quick thought');
check('quick add makes a to-do', todos.filter((t) => !t.deleted).length === todosBefore + 1 && todos.some((t) => t.task === 'Quick task'));
check('quick add makes a shopping item', shoppingItems.filter((t) => !t.deleted).length === shopBefore + 1 && shoppingItems.some((t) => t.item === 'Quick apples'));
check('quick add makes a note', notes.filter((t) => !t.deleted).length === notesBefore + 1 && notes.some((t) => t.body === 'Quick thought'));
check('quick add says where it went and clears the box', /your notes/.test($('quick-add-status').textContent) && $('quick-add-input').value === '');
quick('todo', '   ');
check('a blank quick add does nothing', todos.filter((t) => !t.deleted).length === todosBefore + 1);

// ---- stale sync reminder ----
const reminderText = () => $('home-backup-notes').hidden ? '' : $('home-backup-notes').textContent;
localStorage.removeItem('secondMemory.syncConfig.v1');
localStorage.removeItem('secondMemory.lastSyncAt.v1');
renderBackupNotes();
check('no sync reminder when sync is not set up', !/synced in/.test(reminderText()));
localStorage.setItem('secondMemory.syncConfig.v1', JSON.stringify({ token: 'tok' }));
renderBackupNotes();
check('turning sync on starts the clock without nagging', !/synced in/.test(reminderText()) && !!localStorage.getItem('secondMemory.lastSyncAt.v1'));
localStorage.setItem('secondMemory.lastSyncAt.v1', new Date(Date.now() - 10 * 86400000).toISOString());
backupNotesDismissed = false;
renderBackupNotes();
check('after 10 days it says so, with a Sync now button', /synced in 10 days/.test(reminderText()) && [...$('home-backup-notes').querySelectorAll('button')].some((b) => b.textContent === 'Sync now'), reminderText());
localStorage.setItem('secondMemory.lastSyncAt.v1', new Date().toISOString());
backupNotesDismissed = false;
renderBackupNotes();
check('a recent sync clears the reminder', !/synced in/.test(reminderText()));
localStorage.removeItem('secondMemory.syncConfig.v1');
