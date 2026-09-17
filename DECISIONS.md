# Decisions Log

This file is maintained by the Archivist role. Newest entries at the top. Each entry
records what was decided, why, and any standing constraint future work must respect.

## 2026-09-16 — Home dashboard tab + mobile/PWA improvements

**Decision:** The user asked what else could make the app "more functional, but also
more mobile friendly." The Architect proposed, and the user approved, two pieces of
work: (1) a mobile-friendly rework of the Budget calendar plus PWA "Add to Home Screen"
support, and (2) a new Home dashboard tab surfacing what needs attention across
collections.

The Researcher (`docs/research/mobile-pwa.md`) corrected a materially outdated
assumption in a pre-existing draft: as of iOS 26, Safari now defaults every "Add to Home
Screen" site to full-screen/no-chrome launch with zero manifest or meta tags required —
so the real remaining goal wasn't "get standalone launch working" but "give iOS a real
icon and app name instead of its ugly page-screenshot fallback." iOS Safari still
requires a real PNG (180×180) for `apple-touch-icon` — SVG/data-URIs aren't reliably
honored, even after Safari 26's SVG favicon support (a narrower, unrelated feature
covering only browser-tab favicons) — so this cycle added the project's first-ever
binary asset file, which is a local static file, not a runtime/network dependency, and
does not violate the zero-external-dependency rule. No Service Worker is needed per
WebKit's current docs. For the Budget calendar, arithmetic against the app's real CSS
values showed the existing 700px breakpoint was already too narrow for a 7-column grid
(the sidebar's fixed 220px width doesn't collapse until 700px either), so a separate,
wider 900px breakpoint was recommended for the Budget calendar specifically, collapsing
to a stacked single-column view and hiding the weekday-header row (which would otherwise
visually misalign). iOS Safari's input-zoom-on-focus quirk (font-size under 16px
triggers unwanted zoom) was found to affect most of the app's inputs, not just Budget's,
so an app-wide fix was recommended instead of a Budget-only patch.

The Analyst (`docs/specs/home-dashboard.md`) went collection-by-collection and decided,
with justification, that only three of the app's ten collections have anything
genuinely time-sensitive to surface: Budget/Bills (overdue + due-within-7-days, reusing
Budget's existing `unpaidAmountThrough`/`occursOnDate` math — explicitly not
`oldestUnpaidOccurrence`, which the Budget cycle's own Tester had already found too
expensive to run on every render), To-Do (overdue + due-soon, reusing `isTodoOverdue()`
unmodified and deliberately extending its existing UTC-date idiom to the due-soon
boundary check so the two buckets don't develop a seam at the exact midnight boundary —
an intentional consistency choice tied to `isTodoOverdue()`'s already-documented
UTC-vs-local latent quirk), and a lightweight Currently Reading callout from Books (the
one deliberate exception to "only genuinely due-dated items," a judgment call in the
spirit of the app's "second memory" premise). The other seven collections (Medications,
Diagnoses, Recipes, Shopping List, Notes, Resume & Portfolio, Coursework) were explicitly
decided to contribute nothing, each with its own stated reason — this is the correct,
intended outcome for a "what needs attention" dashboard, not a gap. The Analyst also
caught and fixed three issues in a pre-existing spec draft: a contradiction between two
sections describing the Currently Reading widget differently, an unspecified rendering
difference between Bills' two row shapes (cumulative overdue total vs. a single upcoming
occurrence), and an inconsistent sort order between otherwise-parallel overdue/due-soon
lists.

**What was built (Bob, commit `587bdd3`):** three pure computation functions
(`computeHomeBills`, `computeHomeTodos`, `computeCurrentlyReading`) and `renderHome()`,
wired via exactly one added line — `renderHome();` — at the end of each of
`renderBooks()`, `renderTodos()`, and `renderBudget()` (the three functions that already
run after every mutation touching those collections), rather than hunting down every
individual mutation call site. `TABS` now starts with `'home'`, the new default landing
tab for fresh installs only (an existing user's saved tab preference is never
overridden), with a new ungrouped nav entry above the existing four nav groups and
click-through navigation on every dashboard row via `setActiveTab()`. Separately:
`manifest.json` and Apple/theme meta tags in `index.html`, a new
`icons/apple-touch-icon.png` (generated locally via .NET's System.Drawing, not fetched
from anywhere), the Budget calendar's new 900px breakpoint, and an app-wide 16px
minimum font-size on mobile-width text inputs.

**Outcome:** The Tester found 6 of 7 focus areas clean and found one real issue:
`books-collection` was the only collection section missing the `hidden` attribute in its
markup (a leftover from when Books, not Home, was the default tab) — fixed. During live
verification the Architect separately found and fixed a second bug: the new 900px Budget
media query was placed earlier in `style.css` than the base `.budget-week-cells`/
`.budget-weekday-row` rules it was meant to override, so the equal-specificity base rule
always won regardless of viewport width, making the breakpoint a silent no-op. Fixed by
moving the media query after the base rules (matching the existing 700px/`.columns`
convention) and re-verified live via `getComputedStyle`/`matchMedia` at multiple widths.
The Architect then live-tested end-to-end with real seeded data: Home's stats and both
Bills bucket-math scenarios matched hand-computed expectations exactly (including a bill
unpaid for 2 months correctly appearing as both a cumulative overdue total AND a
separate due-soon occurrence — intentional, matching Budget's existing "same bill
contributes to multiple weeks" precedent, not deduplicated); click-through navigation,
the calm empty state (with Currently Reading correctly independent of it), both new CSS
breakpoints, the 16px input-zoom fix, and the manifest all confirmed working live with
zero console errors.

**Standing constraints established:**
- Any future new global/wide-reaching CSS media query in `style.css` must be placed
  AFTER the base rule(s) it's meant to override, not before — same-specificity CSS
  rules resolve ties by source order, and this cycle shipped that exact bug once before
  catching it live. The 700px/`.columns` block is the correct reference pattern.
- `renderHome()`'s three-hook wiring (piggybacking on `renderBooks()`/`renderTodos()`/
  `renderBudget()` rather than every individual mutation function) is the established
  pattern for any future cross-collection aggregation view — don't add direct
  `renderHome()` calls inside individual `addX`/`updateX`/`toggleX` functions, and don't
  invent a new wiring mechanism for a hypothetical second dashboard-like feature without
  first considering reuse of this pattern.
- If a future cycle fixes `isTodoOverdue()`'s known UTC-vs-local latent bug (flagged
  twice now — the Budget cycle and this one — deliberately not fixed either time),
  `computeHomeTodos()`'s due-soon boundary check must be updated in the same cycle or
  the two will silently develop a seam again at the exact local-midnight edge.
- The project now has one binary asset file (`icons/apple-touch-icon.png`) — an accepted
  exception to "everything is inline SVG/text," not a precedent to avoid; future
  icon-like needs can follow the same "generate locally via a built-in OS tool, commit
  the resulting static file" approach.

## 2026-09-16 — Bills sync bug fix + real bill data import (24 records)

**Decision:** The user shared a screenshot of their real "Fixed Monthly Expenses" bills
spreadsheet (20 rows) and asked to import it. While preparing the import, the Architect
discovered a real, previously-unnoticed bug from the immediately-prior Budget tab cycle:
`sync_server.py`'s `COLLECTION_NAMES` list was never updated to include `"bills"` when
Bills was added as the 10th `SYNC_COLLECTIONS` entry on the client side — meaning Bills
had silently never been syncing across devices at all, despite the Budget spec's explicit
design goal of Bills being a full sync citizen from day one. This was fixed first (commit
`74c4ea1`, a one-line addition to `COLLECTION_NAMES`) before the import proceeded, since
importing bill data would have been pointless if it couldn't sync. `load_dataset()`
already gracefully backfills any missing collection key to an empty array, so no
migration script was needed — a server restart was sufficient. The fix was verified by
round-tripping through the actual `/api/sync` endpoint (not just inspecting the JSON
file) and confirming bills came back correctly — the Architect first inspected
`merge_collection()`'s semantics to confirm sending an empty client payload for
verification purposes was safe (it is — the tombstone-based design means an empty client
array is correctly treated as "no changes from this device," never as "delete
everything," confirmed by checking the real dataset's record counts were unchanged after
the verification call).

**Data import:** 24 bill records were written directly into `sync_data.json` (the
canonical sync datastore), matching the exact shape `addBill()` produces, following the
same direct-datastore-edit technique validated in prior personal-data-import cycles
(books/recipes/coursework/notes). From the user's 20-row spreadsheet:
- 18 rows were imported as ordinary `monthly` bills, anchored to their day-of-month in
  September 2026 (the anchor month doesn't affect correctness of the ongoing monthly
  recurrence, per the Budget tab's `occursOnDate` logic — only the day-of-month and
  forward offset matter).
- 2 rows were **not** imported as recurring bills: the user's spreadsheet described them
  as "for 3 payments" with three explicit dates each (a Klarna $45 installment on Sept
  23/Oct 7/Oct 21, and a Klarna $20 installment on Oct 3/Oct 17/Oct 31) — genuinely finite
  installment plans, not open-ended recurrence. The Bill data model only supports
  open-ended recurring frequencies or a single `one_time` occurrence, with no "recurring
  but capped at N occurrences" concept. Rather than force these into `biweekly` (which
  would incorrectly imply they continue forever), each of the 6 known payment dates was
  imported as its own separate `one_time` bill — an accurate fit for the current model
  with no schema change needed.
- The Architect also assigned categories to all 24 bills (Utilities, Installments,
  Insurance, Vehicle, Phone, Subscriptions, Fitness) using the category chip-filter field
  the Budget tab already supports, to make that existing feature immediately useful on
  real data — matching the same "the app should be more useful, not just literally what
  was asked" spirit as the earlier Recipes-categorization cycle, though not explicitly
  requested this time.
- **A known, accepted limitation, not fixed:** three of the imported monthly bills have a
  real end date the spreadsheet noted ("last payment") that the current Bill model has no
  field to record — an Affirm $10/month bill ending January 2027, an Affirm $23/month
  bill ending March 2027, and a parking $83/month bill ending November 2026. These were
  imported as ordinary open-ended `monthly` bills; they will keep recurring (and keep
  counting toward unpaid totals if not paid/deleted) past their real end dates unless the
  user manually deletes or edits them when those dates arrive. This should be surfaced to
  the user, not silently absorbed — it's a real, if minor and distant, future correctness
  gap in the imported data, not a bug in the app itself.

**Outcome:** confirmed via the live `/api/sync` round-trip that all 24 bills came back
with correct amounts, due dates, frequencies, and categories, cross-checked against the
source spreadsheet.

**Standing constraints established:**
- `sync_server.py`'s `COLLECTION_NAMES` now includes `"bills"` — any future new
  collection added to `SYNC_COLLECTIONS` on the client must also be added to
  `COLLECTION_NAMES` on the server, or it will silently fail to sync with no error
  surfaced anywhere (exactly what happened here for one full cycle).
- If the user ever asks for bills with a genuine end-after-N-occurrences or end-by-date
  concept (rather than always-open-ended recurrence), that requires an actual schema
  change to the Bill record (an optional `endDate` or `occurrenceLimit` field plus
  corresponding changes to `occursOnDate`/`occurrenceCountThrough`) — don't assume the
  current model already supports it, and don't silently bolt it on without an Analyst
  pass, since it changes the core recurrence math multiple other cycles have already
  carefully verified.
- Three imported bills (Affirm $10, Affirm $23, parking $83) have real-world end dates
  the app has no field for and will keep recurring past those dates until the user
  manually intervenes — not a defect to silently fix, but should be mentioned to the user
  if a future cycle touches Bills.
