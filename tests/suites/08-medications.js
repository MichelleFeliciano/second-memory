// Medication "Taken today" check-off: ticking, streaks, undo, and bad data.
const tNow = new Date().toISOString();
medications.length = 0;
addMedication({ name: 'Zinc', dosage: '10mg', frequency: 'daily', prescribingDoctor: '', startDate: '', refillDate: '', notes: '' });
const zinc = () => medications.find((m) => m.name === 'Zinc');
check('a new medication starts with nothing taken', Array.isArray(zinc().takenDates) && zinc().takenDates.length === 0);

nav('medications');
const takenBtn = () => document.querySelector('#medications-list .med-taken-btn');
const takenNote = () => document.querySelector('#medications-list .med-taken-note').textContent;
check('the card has a Taken today button that is not pressed', takenBtn().getAttribute('aria-pressed') === 'false');
takenBtn().click(); await sleep(30);
check('tapping marks today as taken', zinc().takenDates.includes(todayKey()) && takenBtn().getAttribute('aria-pressed') === 'true');
check('the button shows a tick', /✓/.test(takenBtn().textContent));
takenBtn().click(); await sleep(30);
check('tapping again takes it back', zinc().takenDates.length === 0 && takenBtn().getAttribute('aria-pressed') === 'false');
$('undo-btn').click(); await sleep(30);
check('undo restores the tick', zinc().takenDates.includes(todayKey()));

// streaks
zinc().takenDates = [dk(-3), dk(-2), dk(-1), dk(0)]; saveCollection(MEDICATIONS_KEY, medications); renderMedications();
check('four days in a row', medicationTakenSummary(zinc()).streak === 4 && /4 days in a row/.test(takenNote()), takenNote());
zinc().takenDates = [dk(-2), dk(-1)]; renderMedications();
check('a streak still counts if today is not ticked yet', medicationTakenSummary(zinc()).streak === 2 && !medicationTakenSummary(zinc()).takenToday);
zinc().takenDates = [dk(-5)]; renderMedications();
check('a gap ends the streak and says when it was last taken', medicationTakenSummary(zinc()).streak === 0 && /Last taken 5 days ago/.test(takenNote()), takenNote());
zinc().takenDates = [dk(-1), dk(-3), dk(0), dk(-4)];
check('the last-7-days count', medicationTakenSummary(zinc()).last7 === 4);
zinc().takenDates = ['nonsense', dk(0), dk(0), null, '2026-02-31'];
check('damaged taken dates are ignored and de-duplicated', takenDatesOf(zinc()).length === 1 && medicationTakenSummary(zinc()).takenToday);
zinc().takenDates = 'oops';
check('a damaged taken list never breaks the card', takenDatesOf(zinc()).length === 0 && (() => { renderMedications(); return true; })());

// editing keeps the ticks
zinc().takenDates = [dk(0)];
updateMedication(zinc().id, { name: 'Zinc', dosage: '20mg', frequency: 'daily', prescribingDoctor: '', notes: '' });
check('editing a medication keeps its taken days', zinc().takenDates.length === 1 && zinc().dosage === '20mg');
check('import accepts a list of taken days and refuses a non-list', isValidImportRecord('medications', { id: 'x', name: 'm', takenDates: [] }) && !isValidImportRecord('medications', { id: 'x', name: 'm', takenDates: 'no' }));
