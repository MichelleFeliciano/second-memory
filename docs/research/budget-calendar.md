# Research: Budget tab — rolling 5-week bill calendar

## Question I was asked

Validate the technical approach for the trickiest parts of a new "Budget" tab: a
rolling 5-week calendar (2 weeks back, current week, 2 weeks forward) driven by a
bills list (name, amount, due date, recurrence frequency), with per-day checkable
bill occurrences, a manually-entered per-day number, and a per-week running total
that includes unpaid bills from earlier weeks. This brief supplies facts and
recommendations for the Analyst's spec — it does not decide the schema.

I read `CLAUDE.md`, `DECISIONS.md`, and the relevant parts of `app.js` (the existing
`isTodoOverdue`, `todayForFilename`, sync-status `setInterval`, and stats-line
patterns) before researching, per the project's stated precedent-checking rule.

---

## 1. Recurring bill occurrence generation

### 1a. Weekly / biweekly — the DST risk is real, and there's a simple fix

**Confirmed:** Naively computing "is this candidate date N days after the anchor
date" by subtracting two local-time `Date` objects and dividing by
`86400000` (ms/day) is unsafe across a DST transition, because not every local day
is exactly 24 hours — a spring-forward day is 23 hours, a fall-back day is 25.
MDN's own docs for `Date.prototype.setMilliseconds()` warn about exactly this: if a
millisecond-based adjustment crosses a DST boundary, "the difference in timestamps
between the new and old date will be, respectively, one hour less or more than the
nominal time difference," and MDN's recommendation for date-only (not time-of-day)
arithmetic is to use UTC-based methods instead of local-millisecond math. (MDN,
[`Date/setMilliseconds`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/setMilliseconds))

**Recommendation:** Never diff local-time millisecond timestamps for calendar-day
math. Instead, anchor both the bill's due date and the candidate date to UTC
midnight via `Date.UTC(year, monthIndex, day)`, then diff those two UTC timestamps
and divide by 86400000 to get a whole-number day count — this is safe because UTC
has no DST, so every UTC day is exactly 86,400,000 ms by definition. Then:
- Weekly: `dayDiff % 7 === 0`
- Biweekly: `dayDiff % 14 === 0`

This only requires parsing the stored `YYYY-MM-DD` anchor/candidate strings into
`{year, month, day}` integers (trivial with `.split('-')`) and never touches the
device's local timezone at all — which is correct, since a calendar day like
"2026-09-16" is a plain date with no time-of-day component and shouldn't be
timezone-sensitive.

### 1b. Monthly — anchor day doesn't exist in the target month

**Confirmed (tested against MDN's own example):** `setMonth()`/the `Date`
constructor does **not** clamp an out-of-range day to the last day of the target
month — it rolls forward into the next month instead. MDN's own documented example:
a `Date` of Jan 31, 2016 with `setMonth(1)` (February) produces **March 2, 2016**,
not Feb 29, "because in 2016 February had 29 days" and the extra 2 days roll over.
(MDN, [`Date/setMonth`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/setMonth))
So naively doing `new Date(year, targetMonth, anchorDay)` for a bill due on the
31st will silently produce a date in the *following* month for any 30-or-fewer-day
month — a real bug, not a hypothetical one.

**Standard convention (recommended, not something I can "confirm" from a spec since
there is no single universal standard — but it's the overwhelmingly common
real-world billing convention, e.g. how credit-card/loan servicers handle a
31st-of-month due date in a 30-day month):** clamp to the last day of the target
month. Concretely: `daysInMonth = new Date(year, targetMonthIndex + 1, 0).getDate()`
(the "day 0" trick, which relies on the same confirmed roll-back-to-previous-month
behavior — day 0 of month M+1 is the last day of month M), then
`occurrenceDay = Math.min(anchorDay, daysInMonth)`. This is the same day-0 trick
already implicitly available via `setDate(0)`'s documented behavior ("a dateValue
of 0 changes the date to the last day of the previous month").

### 1c. Yearly — is it in scope, and same clamping question

**Likely relevant, worth including:** the user's "etc" after naming monthly and
biweekly plausibly covers yearly — real recurring bills (annual insurance premiums,
some subscriptions, property tax) are commonly yearly, and once the monthly clamp
logic (1b) exists, yearly is a nearly-free extension: the only edge case is a Feb 29
anchor recurring in a non-leap target year, which clamps to Feb 28 by the exact same
`Math.min(anchorDay, daysInMonth-of-February-in-target-year)` logic — no new
mechanism needed. **Recommendation:** include `yearly` as a fourth frequency option
alongside weekly/biweekly/monthly; flag to the Analyst as a cheap addition, not a
requirement — the user only explicitly named two examples ("this bill is monthly
and this one is biweekly, etc."), so whether `yearly` ships in v1 is the Architect's
call, not mine.

### 1d. Compute occurrences on-the-fly vs. persist every future row

**Recommendation: compute on-the-fly, at render time, from the bill's stored
definition (anchor due date + frequency + amount) plus a separately-stored
paid/unpaid record keyed by a composite `billId + dateString` key.**

Reasoning, confirmed against the actual tradeoffs rather than asserted:
- **No "generate more rows" maintenance job needed.** A persisted-future-rows
  design needs *something* (a load-time check, a scheduled job — this app has
  neither infrastructure) to keep generating new rows as real time advances past
  whatever horizon was originally pre-generated. On-the-fly generation has no
  horizon at all — the calendar window (5 weeks, always computed fresh from
  "today") only ever asks the generator for occurrences in a bounded, already-known
  range, so there's never a "ran out of pre-generated rows" failure mode.
- **No storage bloat.** A biweekly bill "since forever" would accumulate one
  persisted record per occurrence indefinitely; this app's own precedent
  (`localStorage`, small personal-scale JSON) favors keeping the bills list itself
  small (one record per *bill*, not per *occurrence*).
- **No drift-on-edit bug class.** If a persisted future occurrence's amount/date
  were generated once and stored, then the user later edits the bill's amount or
  frequency, every already-materialized future row is now silently wrong until
  something reconciles them — a real bug class avoided entirely by never
  materializing future rows in the first place. On-the-fly generation always
  reflects the bill's *current* stored definition.
- **This does not break "mark this occurrence as paid."** A specific occurrence is
  uniquely and stably identified by `billId + its computed YYYY-MM-DD date`, since
  the recurrence rule is deterministic (same anchor + frequency always produces the
  same date for a given calendar position) as long as the bill's anchor date/
  frequency aren't retroactively changed. Storing paid state as (for example) a
  `paidDates: string[]` array on the bill record, or a separate small map, keyed by
  that composite date string works cleanly with on-the-fly generation.
- **One real edge case to flag for the Analyst, not resolve here:** if a bill's
  anchor due date or frequency is edited *after* some occurrences are already
  marked paid, previously-paid dates could stop matching any newly-computed
  occurrence (an "orphaned" paid date). This is a genuine design question (ignore
  the orphaned entry silently vs. warn the user vs. block the edit) that the spec
  should explicitly decide, not something I'm resolving in this brief.

---

## 2. Rolling calendar window math

**Week-start convention — recommend Sunday-start.** This is the commonly cited US
calendar convention (contrasted with the ISO-8601 Monday-start convention used in
much of the rest of the world). Flagging explicitly, as instructed: this is a
low-stakes, easily-changed-later UI choice, not a data-model commitment — nothing
about the underlying occurrence/date-key logic depends on which day a "week" starts
on, only the calendar's rendering/grouping does.

**Computing the window (35 days total):**
1. Get "today" as local `{year, month, day}` (see §4 on why *local*, not UTC/
   `toISOString`, is the right choice for this).
2. Find start-of-this-week: `todayDate.getDay()` returns 0–6 with **0 = Sunday**
   (MDN, [`Date/getDay`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/getDay))
   — confirmed, so `startOfThisWeek = new Date(year, month, day - todayDate.getDay())`.
3. Window start = `startOfThisWeek` minus 14 days: `new Date(year, month, startDay - 14)`.
4. Generate all 35 day cells as `new Date(year, month, windowStartDay + i)` for
   `i` from 0 to 34.

**Confirmed this correctly crosses month/year boundaries with no manual leap-year
or month-length logic needed:** the `Date` constructor/`setDate()` family
normalizes an out-of-range day-of-month by rolling into the adjacent month/year
automatically — MDN's own documented example: `new Date(1962, 6, 7)` with
`setDate(32)` (August has no 32nd) correctly produces August 1, 1962; `setDate(0)`
correctly produces the last day of the *previous* month. (MDN,
[`Date/setDate`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/setDate))
This is safe from the DST-arithmetic pitfall in §1a specifically because it
increments the *day-of-month field* (calendar semantics), not a raw millisecond
offset — the two techniques look superficially similar but are not the same
operation, and only the millisecond-offset one is DST-unsafe.

**Does the window need to actively re-shift while the tab stays open overnight?**
**Recommendation: no — recompute on render (tab switch / page load) only, matching
this app's existing pattern of computing derived-from-"today" state fresh on each
render rather than ticking it.** Concretely, `isTodoOverdue()` already recomputes
`today` fresh every time it's called (on each render), with no interval driving it
— the Budget tab's window/overdue calculations should follow that same precedent,
not the sync-status label's `setInterval` precedent. The two cases are genuinely
different: the sync-status label ticks every 30s because its displayed value
("Synced 3m ago") is meaningfully wrong within seconds of going stale, and the
project already accepted that ongoing-tick cost for it. A calendar week boundary
only changes once every 7 days, and this is a personal tool typically reopened
rather than left running for days (established framing in this task and consistent
with how this app is actually used per `DECISIONS.md`'s repeated "fresh port"
testing pattern) — so a periodic re-check would add real complexity (a re-render
firing mid-interaction, e.g. while the user is mid-typing into the per-day manual
number field, which the existing render functions guard against for search/sort
but a surprise background re-render would need the same guard added deliberately)
for a benefit that only matters in the rare case of a tab left open across an exact
midnight/week-boundary moment. If the Architect wants a free, low-risk improvement
later, hooking into the already-existing `visibilitychange` listener (used today
for `runSync()`) to also recompute the Budget window when the tab regains
visibility would cover the "left open overnight, come back to it" case without a
ticking interval — worth a one-line mention to the Analyst as optional, not
required.

---

## 3. Month header across a window that spans multiple months

**Recommendation, confirmed as the reasonable and simplest reading: show the month
and year of *today's actual date* specifically** (e.g. "September 2026"), not a
computed span of the whole 5-week window. The user's literal wording — "the month
we are in" — most naturally refers to the current real-world month, not a derived
range label, and a derived label would frequently be awkward (a 5-week window very
commonly spans two months, occasionally three near a month/quarter boundary — e.g.
a window starting in late August and ending in early October would need a
three-month label like "Aug–Oct 2026," which is more visually cluttered than
useful). Implementation is trivial: format `today`'s month/year only
(`today.toLocaleString(undefined, { month: 'long' })` + `today.getFullYear()`, or
an equivalent manual month-name lookup array, consistent with this app's existing
no-locale-library approach elsewhere) — no window-spanning logic needed at all.

---

## 4. Storage/date-key format

**Confirmed: use plain `YYYY-MM-DD` string keys for calendar-day identity (bill
occurrence dates, paid/unpaid map keys, and the per-day manual number), not full
ISO timestamps and not raw `Date` objects.** A calendar day like "the bill due
September 16" is a pure date with no time-of-day or timezone component — a
timestamp format necessarily carries both, which is the wrong shape for a value
that should mean the same thing regardless of what time of day it was entered or
what timezone the device is in. Storing raw `Date` objects is also wrong for a
different reason: `Date` objects don't serialize to `localStorage`/`JSON` as
dates at all — `JSON.stringify` implicitly calls `toISOString()` on them, and
`JSON.parse` deserializes back to a plain string, not a live object.

**A directly relevant finding, flagged for awareness rather than something I'm
fixing (out of my mandate — this is existing code, not part of this task):** this
app's *existing* `isTodoOverdue()` and `todayForFilename()` functions compute
"today" via `new Date().toISOString().slice(0, 10)`. **Confirmed via MDN:**
`toISOString()` "returns the date/time in UTC" always, denoted by the trailing `Z`
(MDN, [`Date/toISOString`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toISOString))
— it is **not** the device's local calendar date. For a user west of UTC (e.g. any
US timezone), this means "today" per that existing code can flip over to the next
calendar date several hours *before* local midnight (e.g. Central Time, UTC-5/-6,
rolls over at 6–7pm local time). This is a real, pre-existing latent bug/quirk in
the To-Do overdue check and the export filename — not something this Budget cycle
needs to fix, but the **new Budget code should not copy this pattern**. Instead,
build the `YYYY-MM-DD` key from *local* date fields directly:
`` `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` ``
— this reflects the device's actual local calendar day, which is what a personal
bill/calendar feature should track ("is this bill due today, in my day"), not the
UTC calendar day. I'd suggest the Architect note this as a candidate follow-up fix
for the existing To-Do code in a future cycle, since it's the same bug class one
step removed — but that's the Architect's call, not mine to make in this brief.

**Contrast with the existing `dateAdded`/`updatedAt` timestamp fields:** those
fields correctly *are* full ISO timestamps, because their job is different — they
record "at what real moment did this edit happen" for sync/audit purposes (device
clock skew and time-of-day both matter there, per the sync architecture's own
version-based design). A calendar-day due date has no such need; forcing it into
timestamp shape would just reintroduce the UTC-vs-local mismatch above for no
benefit.

---

## 5. Weekly total — confirm the carry-forward formula

**Confirmed the correct formula, directly from the user's own wording:**

```
weekTotal(week N) = sum of amount, over every occurrence that is:
  - still unpaid, AND
  - due on or before the last day of week N
```

This is a cumulative "total currently owed as of the end of this week," not a
"bills newly due this week" total. The user's own words make this unambiguous:
"i want a total due for each week. i want that to include and [any] past weeks
bills that haven't been marked as paid." That is explicitly a request for
carry-forward inclusion, not a bug to avoid.

**Flagging explicitly for the Analyst (not resolving it myself, since it's a
spec-level consequence, not a fact to verify):** this formula means the exact same
unpaid occurrence will appear in — and add to — multiple weeks' displayed totals
simultaneously (e.g. an unpaid bill due in week 1 still contributes to week 1's,
week 2's, week 3's, etc. totals for as long as it stays unpaid and is within/before
that week). This is the correct, intended behavior per the user's literal wording,
not double-counting to eliminate. The Analyst should make sure the spec states this
explicitly so it isn't "fixed" by a future cycle that reads the repeated numbers as
a bug.

---

## 6. Suggested additions ("anything else you think may function well")

Three tightly-scoped suggestions, each justified against "keep scope tight" rather
than offered as a menu:

1. **Visually distinguish an overdue unpaid bill (due date in the past, still
   unpaid) from a not-yet-due upcoming one.** Low-risk, high-value: this is a
   one-condition check (`!paid && dueDate < todayKey`) plus a CSS class, and the
   app already has the exact precedent for this pattern — `.todo-due.overdue` in
   the existing To-Do tab (`isTodoOverdue()` + a CSS modifier class). Reusing that
   established pattern rather than inventing a new one keeps this consistent with
   the app's existing conventions, and it directly serves the calendar's whole
   point (at-a-glance bill status) at essentially zero added complexity.

2. **A small overall summary line — total unpaid across the whole bills list (not
   just per-week), e.g. "$347.00 unpaid across 4 bills."** Low-risk, high-value:
   this is a straightforward reuse of the exact `renderBooksStats()`/
   `renderCoursesStats()` precedent already established in this codebase (a
   one-line, live-computed summary rendered above/below the main view), computed
   from the same unpaid-occurrence data the weekly totals already need — no new
   data, no new field, just one more derived display value.

3. **An optional per-bill category/color tag** (e.g. "Rent," "Utilities,"
   "Subscriptions") for quick visual scanning on a crowded calendar day where
   several bills' names might be shown in a small cell. Low-risk: it's a single
   optional string field on the bill record (or reuse the chip-filter/category
   pattern already built for Recipes' `category` and Coursework's `term`), and
   degrades gracefully — a bill with no category just shows with no color accent,
   nothing breaks. Justified specifically because the calendar's middle-of-day-cell
   bill display is likely to get visually dense on days with 2–3 bills, and a
   quick color cue is a proportionate, minimal answer to that specific problem
   (not a generic "add tags to everything" feature-creep move) — the Analyst
   should treat this as optional/nice-to-have, not required for v1.

**One ambiguity worth flagging to the Analyst rather than guessing at:** the user
asked for "a space in the bottom right corner for a number I can enter manually,"
but didn't say what that number represents (a running bank balance? actual amount
spent that day? something else?). This changes whether it should be validated as
currency, whether it needs its own label, and whether it factors into any total —
worth the Analyst confirming with the user (or the Architect deciding) rather than
assuming a meaning.

---

## Summary of concrete recommendations for the Analyst

- Recurrence math: UTC-anchored day-count diff for weekly/biweekly modulo checks;
  day-0-trick clamp-to-end-of-month for monthly (and yearly, if included);
  on-the-fly occurrence generation from the bill's stored definition, with
  paid/unpaid state persisted separately keyed by `billId + YYYY-MM-DD`.
- Frequencies: weekly, biweekly, monthly at minimum; yearly recommended as a cheap
  4th option, final call is the Architect's.
- Week start: Sunday (low-stakes, easily changed).
- Window: recompute fresh on render (tab switch/reload), not on a ticking
  interval; optional free upgrade is hooking into the existing `visibilitychange`
  listener.
- Month header: today's actual month/year only, not the window's span.
- All calendar-day keys: local-date-derived `YYYY-MM-DD` strings, never
  `toISOString()`-derived (that's UTC, confirmed via MDN, and is a latent bug in
  this app's existing To-Do/export code that the new Budget code should not
  copy) and never raw `Date` objects.
- Weekly total formula: cumulative sum of all unpaid occurrences due on or before
  that week's end — intentional multi-week double-appearance, not a bug.
- Suggested additions: overdue visual state (reuse `.todo-due.overdue` pattern),
  an overall unpaid-total summary line (reuse `renderBooksStats()` pattern), and
  an optional per-bill category/color tag — all additive, all low-risk.
- Flagged open question for the Analyst/Architect: what the manual per-day number
  represents.

## Sources

- [MDN — `Date.prototype.setMilliseconds()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/setMilliseconds) — DST-crossing millisecond-arithmetic risk and UTC-method recommendation.
- [MDN — `Date.prototype.setMonth()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/setMonth) — confirms month overflow rolls forward rather than clamping (Jan 31 → Feb → Mar 2 example).
- [MDN — `Date.prototype.setDate()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/setDate) — confirms day-of-month overflow/underflow correctly rolls into adjacent months/years, including the "day 0 = last day of previous month" trick.
- [MDN — `Date.prototype.getDay()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/getDay) — confirms 0 = Sunday.
- [MDN — `Date.prototype.toISOString()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toISOString) — confirms UTC-only output (the `Z` suffix), the basis for flagging the existing `isTodoOverdue()`/`todayForFilename()` local-vs-UTC mismatch.
