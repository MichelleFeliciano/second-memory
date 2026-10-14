// Medications (no daily "Taken today" button any more) and the refill / weigh-in reminders (device notifications).
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
check('weigh-in is not due before 9:00', weighInDue(new Date(2026, 0, 5, 8, 59), '09:00') === false);
check('weigh-in is due after 9:00 when today has no weight', weighInDue(new Date(2026, 0, 5, 9, 0), '09:00') === true);
check('a later chosen time holds the weigh-in back', weighInDue(new Date(2026, 0, 5, 9, 0), '18:30') === false && weighInDue(new Date(2026, 0, 5, 18, 30), '18:30') === true);
check('a damaged time counts as 9:00', minutesOf('nope') === 540 && minutesOf('07:15') === 435);
weights.push({ id: 'w1', date: todayKey(), weight: 150, note: '', dateAdded: tNow, updatedAt: tNow, deviceId: 'test', deleted: false, version: 0 });
check('weigh-in is not due once today has a weight', weighInDue(new Date(2026, 0, 5, 12, 0), '09:00') === false);
weights[0].deleted = true;
check('a deleted weight does not count', weighInDue(new Date(2026, 0, 5, 12, 0), '09:00') === true);
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
saveReminderState({ enabled: true, refills: {}, weighIn: '', weighInTime: '00:00', refillTime: '00:00' });
await checkReminders();
const refillNote = shown.find((n) => /refill/i.test(n.title));
check('an overdue refill sends one notice that names no medication', shown.filter((n) => /refill/i.test(n.title)).length === 1 && /overdue/i.test(refillNote.title) && !/late|today|soon/.test(refillNote.options.body), JSON.stringify(shown));
check('the notice says how many refills need attention', /3 refills/.test(refillNote.options.body), refillNote.options.body);
check('the weigh-in nudge is sent once the chosen time has passed', shown.filter((n) => /weigh/i.test(n.title)).length === 1);
const before = shown.length;
await checkReminders();
check('checking again the same day sends nothing new', shown.length === before);
saveReminderState({ enabled: false, refills: {}, weighIn: '', weighInTime: '00:00', refillTime: '00:00' });
await checkReminders();
check('nothing is sent while reminders are off', shown.length === before);
window.Notification.permission = 'denied';
saveReminderState({ enabled: true, refills: {}, weighIn: '', weighInTime: '00:00', refillTime: '00:00' });
await checkReminders();
check('nothing is sent without permission', shown.length === before);
window.Notification = RealNotification;
localStorage.removeItem(REMINDERS_KEY);
medications.length = 0; renderMedications();

// ---- reminder times ----
check('reminder times default to 9:00 and wrong values are ignored', (() => { localStorage.setItem(REMINDERS_KEY, JSON.stringify({ enabled: true, weighInTime: '25:99', refillTime: 5 })); const s = loadReminderState(); return s.weighInTime === '09:00' && s.refillTime === '09:00'; })());
window.Notification = function (title, options) { shown.push({ title, options }); };
window.Notification.permission = 'granted';
medications.push(mrec('late2', dk(-1)));
const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
if (nowMin < 22 * 60) {
  const laterTime = String(Math.floor(nowMin / 60) + 1).padStart(2, '0') + ':59';
  const countBefore = shown.length;
  saveReminderState({ enabled: true, refills: {}, weighIn: '', weighInTime: laterTime, refillTime: laterTime });
  await checkReminders();
  check('nothing is sent before the chosen times', shown.length === countBefore, JSON.stringify(shown.slice(countBefore)));
}
window.Notification = RealNotification;
localStorage.removeItem(REMINDERS_KEY);
medications.length = 0; renderMedications();

// third review: a delete right after typing a date records the date step as it was, not as already deleted
{
  medications.length = 0; undoStack.length = 0;
  addMedication({ name: 'Pending', dosage: '', frequency: '', prescribingDoctor: '', startDate: '', refillDate: '', notes: '' });
  const pid = medications[0].id;
  updateMedicationDate(pid, 'refillDate', dk(5));
  deleteMedication(pid);
  const dateStep = undoStack[undoStack.length - 2];
  check('typing a date then deleting gives two undo steps in order', undoStack.length === 3 && dateStep && dateStep.after.refillDate === dk(5) && dateStep.after.deleted === false, JSON.stringify(dateStep));
  medications.length = 0; undoStack.length = 0; redoStack.length = 0; renderMedications();
}
