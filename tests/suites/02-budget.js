// The money maths: when a bill falls due, what is unpaid, pay periods, paid history,
// editing a bill's schedule, and the Home "Mark paid" buttons.
const mk = (frequency, dueDate, extra) => ({ frequency, dueDate, amount: 10, paidDates: [], ...extra });
const now = new Date().toISOString();
const base = { dateAdded: now, updatedAt: now, deviceId: 'test', deleted: false, version: 0 };

// ---- when a bill falls due ----
check('monthly on the 31st lands on Feb 28 in 2027', occursOnDate(mk('monthly', '2026-01-31'), '2027-02-28') === true);
check('...and not on Feb 27', occursOnDate(mk('monthly', '2026-01-31'), '2027-02-27') === false);
check('...and on Feb 29 in the leap year 2028', occursOnDate(mk('monthly', '2026-01-31'), '2028-02-29') === true);
check('monthly on the 30th lands on Apr 30', occursOnDate(mk('monthly', '2026-01-30'), '2026-04-30') === true);
check('nothing before the first due date', occursOnDate(mk('monthly', '2026-05-15'), '2026-04-15') === false);
check('weekly: +14 days yes, +10 days no', occursOnDate(mk('weekly', '2026-10-01'), '2026-10-15') && !occursOnDate(mk('weekly', '2026-10-01'), '2026-10-11'));
check('biweekly: +14 yes, +7 no', occursOnDate(mk('biweekly', '2026-10-01'), '2026-10-15') && !occursOnDate(mk('biweekly', '2026-10-01'), '2026-10-08'));
check('biweekly across the November clock change', occursOnDate(mk('biweekly', '2026-10-18'), '2026-11-15') === true);
check('weekly across the March clock change', occursOnDate(mk('weekly', '2026-03-01'), '2026-03-15') === true);
check('yearly Feb 29 falls on Feb 28 in a normal year', occursOnDate(mk('yearly', '2024-02-29'), '2025-02-28') === true);
check('yearly Feb 29 falls on Feb 29 in a leap year', occursOnDate(mk('yearly', '2024-02-29'), '2028-02-29') === true);
check('one-time bills fall on one day only', occursOnDate(mk('one_time', '2026-10-10'), '2026-10-10') && !occursOnDate(mk('one_time', '2026-10-10'), '2026-11-10'));

// ---- how much is unpaid ----
const paidTwo = mk('monthly', '2026-01-15', { paidDates: ['2026-01-15', '2026-02-15'] });
check('Jan 15 to Apr 15 with two paid leaves two unpaid', unpaidAmountThrough(paidTwo, '2026-04-15') === 20, unpaidAmountThrough(paidTwo, '2026-04-15'));
check('nothing is owed before the first due date', unpaidAmountThrough(paidTwo, '2026-01-14') === 0);
check('a paid date from before the bill started is ignored', unpaidAmountThrough(mk('monthly', '2026-02-15', { paidDates: ['2026-01-15'] }), '2026-02-15') === 10);
check('weekly count over 28 days is 5', occurrenceCountThrough(mk('weekly', '2026-10-01'), '2026-10-29') === 5);
check('monthly count Jan 31 to Mar 1 is 2', occurrenceCountThrough(mk('monthly', '2026-01-31'), '2026-03-01') === 2);
check('a tiny negative shows as $0.00, not -$0.00', !/^-/.test(formatSignedCurrency(-0.004)) && formatSignedCurrency(-12.5) === '-$12.50');

// ---- pay period ----
const period = computeCurrentPayPeriod(shiftDateKey(todayKey(), -3), 'biweekly');
check('the pay period contains today', period && period.periodStart <= todayKey() && todayKey() <= period.periodEnd, JSON.stringify(period));

// ---- the Budget screen shows only weekly, per pay period and monthly totals ----
nav('budget');
check('no lifetime or forecast totals on the Budget screen', !document.querySelector('#budget-lifetime-balance, #budget-forecast-total, #budget-forecast-income-total, #budget-forecast-net-total')
  && !/lifetime|forecast/i.test($('budget-collection').innerText));
check('monthly total, income and net are present', !!$('budget-month-total') && !!$('budget-month-income-total') && !!$('budget-month-net-total'));
check('each calendar week has its own total, income and net', [...document.querySelectorAll('.budget-week')].every((w) => w.querySelector('.budget-week-total') && w.querySelector('.budget-week-income-total') && w.querySelector('.budget-week-net-total')));

// pay period with real bills and income
localStorage.setItem('secondMemory.paydaySettings.v1', JSON.stringify({ payDateKey: shiftDateKey(todayKey(), -3), frequency: 'biweekly' }));
bills.push({ ...base, id: 'pp1', name: 'InPeriod', amount: 100, frequency: 'one_time', dueDate: dk(2), category: '', paidDates: [] });
bills.push({ ...base, id: 'pp2', name: 'OutOfPeriod', amount: 999, frequency: 'one_time', dueDate: dk(40), category: '', paidDates: [] });
renderBudget();
check('pay period lists only the bills inside it', /\$100\.00 due across 1 bill/.test($('pay-period-summary').textContent), $('pay-period-summary').textContent);
check('pay period starts with zero income and a negative net', /\$0\.00/.test($('pay-period-income-total').textContent) && /-\$100\.00/.test($('pay-period-net-total').textContent));
setIncomeForDate(todayKey(), '1000'); await sleep(60);
check('income entered in the period shows up', /\$1000\.00/.test($('pay-period-income-total').textContent) && /\$900\.00/.test($('pay-period-net-total').textContent), $('pay-period-net-total').textContent);
check('the net is coloured by sign', $('pay-period-net-total').querySelector('strong').className === 'amount-positive');
check('the same income appears in the month total', /\$1000\.00/.test($('budget-month-income-total').textContent));

// ---- paid history (monthly, by category) ----
const nowKey = todayKey();
const rent = { name: 'Rent', amount: 1000, frequency: 'monthly', dueDate: nowKey, paidDates: [nowKey], category: 'Housing' };
const history = computePaidByCategory([rent, { ...rent, deleted: true }], new Date().getFullYear(), new Date().getMonth());
check('a payment copied onto a duplicate bill counts once', history.length === 1 && history[0].total === 1000, JSON.stringify(history));

// ---- editing a bill's schedule keeps its payments ----
check('nth occurrence: monthly day-31 clamps', nthOccurrenceDate({ dueDate: '2026-01-31', frequency: 'monthly' }, 1) === '2026-02-28');
check('nth occurrence: weekly', nthOccurrenceDate({ dueDate: '2026-10-01', frequency: 'weekly' }, 2) === '2026-10-15');
check('nth occurrence: one-time has only the first', nthOccurrenceDate({ dueDate: '2026-10-01', frequency: 'one_time' }, 1) === null);
const sched = { ...base, id: 'sch1', name: 'Sched', amount: 100, frequency: 'monthly', dueDate: '2026-07-15', category: '', paidDates: ['2026-07-15', '2026-08-15', '2026-09-15'] };
bills.push(sched);
const fieldsOf = (b, over) => ({ name: b.name, amount: String(b.amount), dueDate: b.dueDate, frequency: b.frequency, category: b.category, ...over });
const unpaidBefore = unpaidAmountThrough(sched, '2026-10-31');
updateBill('sch1', fieldsOf(sched, { dueDate: '2026-07-20' }));
check('moving the due day moves the paid dates with it', JSON.stringify(sched.paidDates) === JSON.stringify(['2026-07-20', '2026-08-20', '2026-09-20']), JSON.stringify(sched.paidDates));
check('...so what is unpaid does not jump', unpaidAmountThrough(sched, '2026-10-31') === unpaidBefore);
$('undo-btn').click(); await sleep(30);
check('undoing the edit restores the old date and payments', sched.dueDate === '2026-07-15' && sched.paidDates.length === 3 && sched.paidDates[0] === '2026-07-15');
updateBill('sch1', fieldsOf(sched, { name: 'Renamed' }));
check('renaming alone leaves paid dates untouched', JSON.stringify(sched.paidDates) === JSON.stringify(['2026-07-15', '2026-08-15', '2026-09-15']));
updateBill('sch1', fieldsOf(sched, { amount: '150' }));
check('changing the amount does not rewrite what was already paid', paidAmountFor(sched, '2026-07-15') === 100 && sched.amount === 150, JSON.stringify(sched.paidAmounts));

// ---- Home: "Mark paid" ----
bills.length = 0;
bills.push({ ...base, id: 'h1', name: 'Rent', amount: 900, frequency: 'monthly', dueDate: dk(-40), category: '', paidDates: [] });
bills.push({ ...base, id: 'h2', name: 'Phone', amount: 50, frequency: 'one_time', dueDate: dk(2), category: '', paidDates: [] });
bills.push({ ...base, id: 'h3', name: 'Streaming', amount: 12, frequency: 'one_time', dueDate: dk(3), category: '', paidDates: [] });
renderBudget(); nav('home'); await sleep(80);
const rows = () => [...document.querySelectorAll('#home-bills-list li')];
check('every Home bill row has a Mark paid button with a clear name', rows().length === 3 && rows().every((r) => /Mark .* paid/.test(r.querySelector('.home-item-action').getAttribute('aria-label'))));
rows().find((r) => r.textContent.includes('Phone')).querySelector('.home-item-action').click(); await sleep(80);
check('Mark paid pays that due date', bills.find((b) => b.id === 'h2').paidDates.includes(dk(2)));
check('...and the bill leaves the Home list', !rows().some((r) => r.textContent.includes('Phone')));
$('undo-btn').click(); await sleep(60);
check('undo puts it back', !bills.find((b) => b.id === 'h2').paidDates.length && rows().some((r) => r.textContent.includes('Phone')));
const rentBill = bills.find((b) => b.id === 'h1');
const oldest = oldestUnpaidOccurrence(rentBill, shiftDateKey(todayKey(), -1));
rows().find((r) => r.textContent.includes('Rent') && r.textContent.includes('overdue')).querySelector('.home-item-action').click(); await sleep(80);
check('on an overdue bill it pays the OLDEST unpaid occurrence', rentBill.paidDates.length === 1 && rentBill.paidDates[0] === oldest, oldest);
const btn = document.querySelector('#home-bills-list .home-item-action');
const paidBefore = bills.reduce((n, b) => n + b.paidDates.length, 0);
btn.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })); await sleep(60);
document.querySelector('#home-bills-list .home-item-action').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 })); await sleep(60);
check('the second click of a double-click does not pay another bill', bills.reduce((n, b) => n + b.paidDates.length, 0) === paidBefore + 1);

// ---- the phone calendar ----
check('closing the day sheet is safe when none is open', (() => { closeCalendarDay(); return true; })());
