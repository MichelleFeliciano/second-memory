// Medications (no daily "Taken today" button any more) and the refill / weigh-in reminders.
const tNow = new Date().toISOString();
medications.length = 0;
addMedication({ name: 'Zinc', dosage: '10mg', frequency: 'daily', prescribingDoctor: '', startDate: '', refillDate: '', notes: '' });
const zinc = () => medications.find((m) => m.name === 'Zinc');

nav('medications');
check('a medication card has no Taken today button', !document.querySelector('#medications-list .med-taken-btn') && !/Taken today/.test($('medications-list').textContent));
check('a new medication no longer carries a taken list', zinc().takenDates === undefined);

// editing and old data
updateMedication(zinc().id, { name: 'Zinc', dosage: '20mg', frequency: 'daily', prescribingDoctor: '', notes: '' });
check('editing a medication still works', zinc().dosage === '20mg');
zinc().takenDates = [dk(0)]; renderMedications();
check('an older medication that still has taken days draws fine', !!document.querySelector('#medications-list .med-card'));
check('import still accepts a list of old taken days and refuses a non-list', isValidImportRecord('medications', { id: 'x', name: 'm', takenDates: [] }) && !isValidImportRecord('medications', { id: 'x', name: 'm', takenDates: 'no' }));

// ---- reminders: which medications count ----
medications.length = 0;
const mrec = (id, refillDate, extra = {}) => ({ id, name: id, dosage: '', frequency: '', prescribingDoctor: '', startDate: null, endDate: null, refillDate, notes: '', dateAdded: tNow, updatedAt: tNow, deviceId: 'test', deleted: false, version: 0, ...extra });
medications.push(mrec('far', dk(10)), mrec('soon', dk(2)), mrec('today', dk(0)), mrec('late', dk(-3)), mrec('ancient', dk(-30)), mrec('gone', dk(1), { deleted: true }), mrec('none', null), mrec('junk', 'not a date'));
check('refill notices cover due soon, today and up to a week overdue', medicationsNeedingRefillNotice().map((m) => m.id).join(',') === 'late,today,soon', medicationsNeedingRefillNotice().map((m) => m.id).join(','));

// ---- reminders: weigh-in ----
weights.length = 0;
check('weigh-in is not due before 9:00', weighInDue(new Date(2026, 0, 5, 8, 59)) === false);
check('weigh-in is due after 9:00 when today has no weight', weighInDue(new Date(2026, 0, 5, 9, 0)) === true);
weights.push({ id: 'w1', date: todayKey(), weight: 150, note: '', dateAdded: tNow, updatedAt: tNow, deviceId: 'test', deleted: false, version: 0 });
check('weigh-in is not due once today has a weight', weighInDue(new Date(2026, 0, 5, 12, 0)) === false);
weights[0].deleted = true;
check('a deleted weight does not count', weighInDue(new Date(2026, 0, 5, 12, 0)) === true);
weights.length = 0;

// ---- reminders: saved state ----
localStorage.setItem(REMINDERS_KEY, '{oops');
check('a damaged reminder setting becomes the defaults', loadReminderState().enabled === false && Object.keys(loadReminderState().refills).length === 0);
localStorage.setItem(REMINDERS_KEY, JSON.stringify({ enabled: 'yes', refills: [], weighIn: 5 }));
check('wrong types in the reminder setting are ignored', loadReminderState().enabled === false && loadReminderState().weighIn === '' && !Array.isArray(loadReminderState().refills));

// ---- reminders: sending (a fake Notification records what would be shown) ----
const RealNotification = window.Notification;
const shown = [];
window.Notification = function (title, options) { shown.push({ title, options }); };
window.Notification.permission = 'granted';
saveReminderState({ enabled: true, refills: {}, weighIn: '' });
await checkReminders();
const refillNote = shown.find((n) => /refill/i.test(n.title));
check('an overdue refill sends one notice that names no medication', shown.filter((n) => /refill/i.test(n.title)).length === 1 && /overdue/i.test(refillNote.title) && !/late|today|soon/.test(refillNote.options.body), JSON.stringify(shown));
check('the notice says how many refills need attention', /3 refills/.test(refillNote.options.body), refillNote.options.body);
const weighHour = new Date().getHours() >= WEIGH_IN_HOUR;
check('the weigh-in nudge is sent only after 9:00', shown.filter((n) => /weigh/i.test(n.title)).length === (weighHour ? 1 : 0));
const before = shown.length;
await checkReminders();
check('checking again the same day sends nothing new', shown.length === before);
saveReminderState({ enabled: false, refills: {}, weighIn: '' });
await checkReminders();
check('nothing is sent while reminders are off', shown.length === before);
window.Notification.permission = 'denied';
saveReminderState({ enabled: true, refills: {}, weighIn: '' });
await checkReminders();
check('nothing is sent without permission', shown.length === before);
window.Notification = RealNotification;
localStorage.removeItem(REMINDERS_KEY);
medications.length = 0; renderMedications();
