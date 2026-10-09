// The health summary sheet and the app lock (PIN screen).

// ================= health summary =================
const base0 = { dateAdded: new Date().toISOString(), updatedAt: new Date().toISOString(), deviceId: 'test', deleted: false, version: 0 };
medications.length = 0; diagnoses.length = 0; weights.length = 0;
medications.push({ ...base0, id: 'hm1', name: 'Zyrtec', dosage: '10mg', frequency: 'daily', prescribingDoctor: 'Dr. Lee', startDate: dk(-90), endDate: null, refillDate: dk(10), notes: 'with food', takenDates: [dk(0), dk(-1)] });
medications.push({ ...base0, id: 'hm2', name: 'Old pill', dosage: '', frequency: '', prescribingDoctor: '', startDate: null, endDate: dk(-5), refillDate: null, notes: '' });
medications.push({ ...base0, id: 'hm3', name: 'Deleted pill', dosage: '', frequency: '', prescribingDoctor: '', startDate: null, endDate: null, refillDate: null, notes: '', deleted: true });
diagnoses.push({ ...base0, id: 'hd1', condition: 'Asthma', dateDiagnosed: dk(-400), provider: 'Dr. Kim', status: 'resolved', notes: '' });
diagnoses.push({ ...base0, id: 'hd2', condition: 'Migraine', dateDiagnosed: null, provider: '', status: 'active', notes: 'weekly' });
weights.push({ ...base0, id: 'hw1', date: dk(-40), weight: 190, note: '' }, { ...base0, id: 'hw2', date: dk(0), weight: 184, note: '' });
nav('home');
$('health-summary-btn').click(); await sleep(30);
const sheet = $('health-summary-body').textContent;
check('the sheet opens', !$('health-summary').hidden && document.body.classList.contains('summary-open'));
check('it lists the medication you take, with doctor, refill and the last-7-days count', /Zyrtec/.test(sheet) && /Prescribed by Dr\. Lee/.test(sheet) && /Next refill/.test(sheet) && /Taken on 2 of the last 7 days/.test(sheet), sheet);
check('it leaves out stopped and deleted medications', !/Old pill/.test(sheet) && !/Deleted pill/.test(sheet));
check('active diagnoses come before resolved ones', sheet.indexOf('Migraine') > -1 && sheet.indexOf('Migraine') < sheet.indexOf('Asthma'));
check('it shows the weight figures and the 30-day change', /Most recent: 184\.0 lb/.test(sheet) && /Oldest: 190\.0 lb/.test(sheet) && /Change over the last 30 days/.test(sheet), sheet);
check('the journal is never in it', !/journal/i.test(sheet));
const text = buildHealthSummaryText(buildHealthSummaryData());
check('the copy-text version has the same sections', /^Health summary/.test(text) && /MEDICATIONS/.test(text) && /DIAGNOSES/.test(text) && /WEIGHT/.test(text));
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
check('Esc closes the sheet', $('health-summary').hidden && !document.body.classList.contains('summary-open'));
medications.length = 0; diagnoses.length = 0; weights.length = 0;
$('health-summary-btn').click(); await sleep(30);
check('an empty app says so for each section', /No current medications/.test($('health-summary-body').textContent) && /No diagnoses/.test($('health-summary-body').textContent) && /No weights/.test($('health-summary-body').textContent));
$('health-summary-close').click();
check('Close closes the sheet', $('health-summary').hidden);

// ================= app lock =================
const waitFor = async (condition, ms = 8000) => { const start = Date.now(); while (!condition() && Date.now() - start < ms) await sleep(30); }; // wait for something slow (the PIN hash) instead of guessing a delay
const idle = async () => { for (let i = 0; i < 80 && lockChecking; i++) await sleep(50); await sleep(40); }; // wait for a PIN check to finish (it takes longer on a slow phone)
check('no lock to begin with', loadLock() === null && $('lock-btn').textContent === 'App lock: Off' && $('lock-now-btn').hidden);
check('a PIN must be 4 to 12 digits', !(await setAppLock('12')) && !(await setAppLock('abcd')) && !(await setAppLock('1234567890123')) && loadLock() === null);
check('a good PIN is saved', await setAppLock('4821') && loadLock() !== null);
check('only a salted hash is stored, never the PIN', !localStorage.getItem('secondMemory.lock.v1').includes('4821'));
check('the right PIN checks out and a wrong one does not', (await checkPin('4821')) && !(await checkPin('4822')));
check('the Menu shows the lock is on', $('lock-btn').textContent === 'App lock: On' && !$('lock-now-btn').hidden);
const lockedAttr = () => document.documentElement.hasAttribute('data-locked');
check('not locked until asked', !lockedAttr());
$('lock-now-btn').click();
check('Lock now shows the lock screen', lockedAttr() && getComputedStyle($('lock-screen')).display === 'flex');
set('lock-pin-input', '0000'); $('lock-form').requestSubmit(); await idle();
check('a wrong PIN stays locked and says so', lockedAttr() && !$('lock-error').hidden && /not right/.test($('lock-error').textContent));
set('lock-pin-input', '4821'); $('lock-form').requestSubmit(); await idle();
check('the right PIN unlocks', !lockedAttr() && $('lock-pin-input').value === '');

// too many tries
lockNow();
for (let i = 0; i < 5; i++) { set('lock-pin-input', '1111'); $('lock-form').requestSubmit(); await idle(); }
check('five wrong tries pause further tries', /Wait 30 seconds/.test($('lock-error').textContent), $('lock-error').textContent);
set('lock-pin-input', '4821'); $('lock-form').requestSubmit(); await idle();
check('even the right PIN waits during the pause', lockedAttr());
lockBlockedUntil = 0; lockFailures = 0;
set('lock-pin-input', '4821'); $('lock-form').requestSubmit(); await idle();
check('and works once the pause is over', !lockedAttr());

// turning it off from the Menu
$('lock-btn').click();
check('the Menu button opens the turn-off dialog asking for the PIN', !$('lock-setup').hidden && !$('lock-setup-current').hidden && $('lock-setup-new').hidden);
set('lock-setup-current', '9999'); $('lock-setup-form').requestSubmit(); await waitFor(() => !$('lock-setup-error').hidden);
check('a wrong PIN does not turn it off', loadLock() !== null && !$('lock-setup-error').hidden);
set('lock-setup-current', '4821'); $('lock-setup-form').requestSubmit(); await waitFor(() => loadLock() === null);
check('the right PIN turns it off', loadLock() === null && $('lock-setup').hidden && $('lock-btn').textContent === 'App lock: Off');

// turning it on from the Menu
$('lock-btn').click();
check('with no lock, the button opens the new-PIN dialog', !$('lock-setup').hidden && $('lock-setup-current').hidden && !$('lock-setup-new').hidden);
set('lock-setup-new', '5566'); set('lock-setup-confirm', '5567'); $('lock-setup-form').requestSubmit(); await sleep(300);
check('PINs that do not match are refused', loadLock() === null && /do not match/.test($('lock-setup-error').textContent));
set('lock-setup-new', '55'); set('lock-setup-confirm', '55'); $('lock-setup-form').requestSubmit(); await sleep(300);
check('a short PIN is refused', loadLock() === null && /4 to 12 digits/.test($('lock-setup-error').textContent));
set('lock-setup-new', '5566'); set('lock-setup-confirm', '5566'); $('lock-setup-form').requestSubmit(); await waitFor(() => loadLock() !== null && $('lock-setup').hidden);
check('matching PINs turn it on', loadLock() !== null && $('lock-setup').hidden);
check('a damaged saved lock counts as no lock', (() => { localStorage.setItem('secondMemory.lock.v1', '{"salt":"x"}'); const none = loadLock() === null; localStorage.removeItem('secondMemory.lock.v1'); return none; })());
clearAppLock();

// forgot-PIN erases this device's data, but nothing else
localStorage.setItem('secondMemory.testKey.v1', 'x'); localStorage.setItem('unrelated', 'keep');
const erased = wipeDeviceData();
check('forgot-PIN wipes only the app data, nothing else', erased >= 1 && localStorage.getItem('secondMemory.testKey.v1') === null && localStorage.getItem('unrelated') === 'keep');
localStorage.removeItem('unrelated');
