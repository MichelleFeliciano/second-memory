# Decisions Log

This file is maintained by the Archivist role. Newest entries at the top. Each entry
records what was decided, why, and any standing constraint future work must respect.

## 2026-09-15 — Foresty light/dark redesign + dark-mode contrast fix

**Decision:** The user said the app "look[ed] dark" and asked for "light and airy,
foresty and feminine... more dramatic decor" with leaves. Investigation found the app
already had a light theme (cream/tan `--bg`) but also a `prefers-color-scheme: dark`
override to a dark brown palette (`--bg: #221913`) that likely triggers automatically
from the user's OS/browser dark-mode setting — probably the actual source of "it looks
dark," not a light-theme problem. When asked whether to remove dark mode entirely or
redesign both, the user chose to keep dark mode but redesign it too, so both themes share
the same forest/feminine identity (dark mode should read as "nighttime forest," not muddy
brown).

**Process:** the Researcher read the current `style.css` palette and the three prior
visual-redesign research docs (`palette-fields-nav.md`, `soft-calm-leaf-background.md`,
`feminine-redesign.md`) before proposing anything, then wrote
`docs/research/foresty-light-redesign.md` — a full revised light+dark palette (forest
green promoted to sole dominant accent, rose/lavender/blush feminine accents kept
unchanged, rust demoted from co-lead), every text/background pairing verified against the
actual WCAG 2.1 relative-luminance contrast formula (not asserted), a computed ~18-20%
opacity ceiling for decorative shapes near text (so "more dramatic" decor could be added
without risking contrast), and concrete SVG/CSS for a bigger ambient leaf tile plus new
corner-accent and divider decor. It explicitly flagged open judgment calls rather than
deciding them: whether the background should carry a green tint or stay neutral, whether
to keep rust (demoted role) or replace it with amber, whether the proposed "dramatic"
level still fit the project's established "calm" character, and a pre-existing bug it
found along the way (`.badge` hardcoded white text on `--accent-2`, which fails WCAG AA
in dark mode at 2.64:1).

**Architect decisions on the flagged points:** kept the sage-tinted background (reads
more "foresty" per the user's explicit wording); kept rust's hex but narrowed its role to
error/destructive/overdue-only (`.form-error`, `.delete-btn:hover`, `.todo-due.overdue`),
moving `.badge` to the accent-green/accent-contrast fill pattern (which also fixes the
dark-mode contrast bug as a side effect) and `.link-url` to the lavender accent (plain
link text isn't an error semantic); approved the proposed decor "drama" level as still
calm-but-decorated rather than busy; and made one scope reduction beyond the brief itself
— the corner-accent decor (brief's §3.3) was implemented once per `.column`/collection-
toolbar rather than once per individual card, specifically because Books alone has 218
real records and per-card decoration at that scale would read as visual noise rather than
intentional decor.

**What was built (Bob, commit `5d8cacb`):** full light+dark palette swap in `style.css`
(`--bg`, `--surface`, `--text`, `--muted`, `--accent`, `--border`, `--border-soft`, dark
`--accent-contrast`); `.badge` and `.link-url` remapped off `--accent-2`; a bigger/more-
detailed 220x220 ambient leaf-tile watermark (same verified-safe 4-8% alpha range as
before, just bigger and more legibly leaf-shaped); a new sidebar-header corner accent
(~18% alpha); a new column/toolbar corner accent applied once per status-column and once
per flat-list collection's toolbar (not per card, per the scope reduction above); a new
`.leaf-divider` element between each of the sidebar's four nav groups (3 dividers total).
All fully static, zero new dependencies, matching every existing hard constraint.

**Outcome:** the Architect live-tested in the browser (fresh port, light AND dark
`prefers-color-scheme` emulation) rather than delegating to the Tester for this purely-
visual cycle, confirming: light mode reads noticeably lighter/airier with forest green as
the dominant hue; dark mode is deep forest green, not brown; the `.badge` fix renders
legible green-on-dark text (confirming the dark-mode contrast bug is actually fixed, not
just theoretically); the To-Do overdue-date text still shows the rust warning color
correctly; the Resume & Portfolio link text correctly renders the lavender accent color in
dark mode (computed color matched the exact expected hex `#C9B8E8`); all 3 leaf-dividers
present in the DOM; zero console errors.

**Standing constraints established:**
- Corner-accent decor (leaf accents on `.column`/`.collection-toolbar`) is deliberately
  scoped to once per column/section, never per individual card — if a future cycle is
  tempted to add per-card decoration, revisit the 218-book visual-noise reasoning above
  first rather than assuming more decor is automatically better.
- `--accent-2` (rust) is now a narrow-purpose semantic color (error/destructive/overdue
  only) — any future feature needing a new colored UI element should reach for `--accent`
  (green) or the rose/lavender feminine accents first, not rust, to keep it from creeping
  back into a co-lead role.
- Any new text/background color pairing added in a future visual cycle should get the
  same treatment this one did: compute the actual WCAG contrast ratio, don't assert it
  from vibes — `docs/research/foresty-light-redesign.md`'s Section 2 is the reference
  example of the expected rigor.
- Data URIs (used for all the leaf decor) can't reference CSS custom properties —
  light/dark variants of every decorative SVG must have their hex values hardcoded and
  swapped manually in each `@media (prefers-color-scheme: dark)` block; this is an
  existing, now-four-times-repeated pattern (ambient tile, sidebar corner, column corner,
  divider), not something to rediscover next time.

## 2026-09-15 — Filter/sort across all nine collections

**Decision:** The user asked for filter/sort "on anything that logically needs to be
sorted or filtered, like all of the above but also books in each column and recipes,
etc" — a full pass across all nine collections, not just one tab. The Analyst read every
collection's actual data model (the `addX()` functions in `app.js`) and wrote
`docs/specs/filter-sort-all-collections.md`, proposing sort/filter controls using ONLY
fields that already exist — no schema changes. It explicitly flagged real gaps it
declined to paper over: To-Do has no priority field; Notes and Resume & Portfolio have no
bounded field to filter on at all; Medications' `prescribingDoctor` and Diagnoses'
`provider` are free text with no curation (unlike Recipes' hand-curated `category`), so
no chip filter was proposed for them; Coursework's `term` field ("Fall 2026") is free
text with no structured year/season split, so a Term sort was deliberately omitted
(alphabetical would be chronologically misleading — "Fall 2025"/"Fall 2026" both sort
before any "Spring" term). The Architect approved the spec as scoped, adding one
requirement: since the plan reused the chip-filter pattern two more times, a shared
normalization helper (trim + case-fold for grouping) should be added so near-duplicate
values ("Fall 2026" vs "fall 2026 ") don't produce duplicate chips — fixing a latent gap
in the original Recipes implementation rather than tripling it.

**What was built (Bob, commit `8c16b98`):** Books/Recipes/Medications/Diagnoses/
Coursework each got a sort `<select>` applied uniformly across their status columns/
groups. To-Do got a fixed 3-option chip filter on `completed` (All/Active/Completed) plus
a Due Date/Date Added sort. Shopping List got a dynamic category chip filter AND a fixed
checked/active toggle (both AND-combined with search) plus a sort. Coursework got a
dynamic Term chip filter (no Term sort, per the spec's flagged reasoning). Notes and
Resume & Portfolio got sort only, no filter (per the flagged gaps). Shared helpers added
to `app.js`: `compareByField(getValue, direction, {text})` (null/undefined/''-last
comparator — explicitly not falsy-checked, so a `0` value like Coursework credits sorts
as a real value, not as missing), `normalizeChipKey()` (trim+lowercase),
`deriveChipOptions()` (groups by normalized key, keeps first-seen casing as the display
label), `renderChipFilter()` (one shared chip-row renderer with auto-reset-to-"All" reused
by all five chip/toggle filters, including Recipes' pre-existing category filter, which
was retrofitted onto this shared pattern). All new filter/sort selections are
non-persisted module-level variables (reset to default on reload), matching the existing
`selectedRecipeCategory` precedent — this was a deliberate, explicit requirement, not an
oversight.

**Bug found and fixed this cycle (Tester found it, Bob fixed it):** `renderNotes()`'s
edit-form capture/restore logic (from the 2026-09-14 fix, which preserves an in-progress
inline edit across a re-render) used a singular `querySelector` to find "the" open edit
form, so it only ever preserved one note's edit state. Nothing previously stopped a user
from opening two notes' edit forms simultaneously; before this cycle that was rare, but
the new sort `<select>` makes re-renders far more frequent, making it much easier to hit
in practice. Fixed by enforcing single-open-edit-form exclusivity: clicking Edit on a note
now closes any other note's already-open form first (via the same clean revert-to-view
path Cancel already uses), so there's never more than one open form for the
capture/restore logic to have to worry about.

**Outcome:** the Tester did a full static code trace (8 of 9 checks passed on first pass;
the Notes bug above was the one failure, subsequently fixed). The Architect then did live
browser verification on a fresh port (avoiding the known browser-cache gotcha already
documented above) confirming: chip normalization collapses "Fall 2026"/"fall 2026 " into
one chip and "Produce"/"produce " into one chip, with the collapsed chip correctly
matching both underlying records; Coursework credits-ascending sort correctly orders a
`0`-credit course ahead of a `3`-credit course, with a `null`-credit course sorting last
(0 is not treated as missing); and the Notes fix works end-to-end — opening Edit on a
second note now closes the first note's form, and changing the sort dropdown while a note
is mid-edit preserves its unsaved text and correct open state.

**Standing constraints established:**
- To-Do has no priority field. Notes and Resume & Portfolio have no filterable field.
  Medications' `prescribingDoctor` and Diagnoses' `provider` were deliberately not turned
  into chip filters (uncurated free text, unbounded cardinality) — revisit only if real
  data shows a small clean set. Coursework's `term` can't be sorted chronologically as
  stored; a real fix needs a schema decision (e.g. a structured term/year
  representation), not a UI change.
- Any future chip-filter field should use the new `normalizeChipKey()`/
  `deriveChipOptions()`/`renderChipFilter()` helpers rather than reinventing the pattern a
  fourth time.
- Any future sort field should use the new `compareByField()` helper (remember: check for
  `null`/`undefined`/`''` explicitly, never a falsy check, so a real `0` value sorts
  correctly).
- Filter/sort UI state is intentionally non-persisted across reload — this is a
  deliberate convention (matching `selectedRecipeCategory`), not a bug, and should stay
  that way unless the Architect explicitly decides to persist UI state more broadly.
- Notes' single-open-edit-form invariant is now enforced at the UI level (Edit closes any
  other open form) — any future change to Notes' edit flow must preserve that invariant
  or the capture/restore logic in `renderNotes()` breaks again.

Also note: the Builder role was renamed to "Bob" this session (separate small commit,
`98e9d14`) — `.claude/agents/builder.md` is now `.claude/agents/bob.md`, `subagent_type`
`bob`.

## 2026-09-15 — Sync/import all-tabs re-render fix

**Decision:** The user reported "have the sync work for all tabs at once, not one tab at
a time." Investigation found this wasn't actually a sync-logic bug: `runSync()` (device
sync) and `importData()` (data import) both correctly updated every collection's
in-memory array and `localStorage` on every call. The gap was purely on the render side —
both functions re-rendered the DOM for only the currently-active tab, via a helper called
`renderActiveCollection()` that looked up the active tab and called `.render()` on just
that one entry in `SYNC_COLLECTIONS`. So after a sync or import touching multiple
collections, only the tab the user happened to be looking at updated immediately; the
other eight tabs kept showing stale DOM until something else (like adding/editing an item
in that tab) triggered its own render, or until a full page reload — which looked
indistinguishable from "sync only works one tab at a time."

**Fix (in `app.js`, commit `f0e5b1b`):** both `runSync()` and `importData()` now call
`c.render()` directly inside their per-collection `SYNC_COLLECTIONS.forEach(...)` loops,
immediately after `c.set(incoming)` / `saveCollection(...)`, so every collection's DOM
updates as soon as its data changes, regardless of which tab is active. The
`renderActiveCollection()` helper and the `ACTIVE_TAB_TO_COLLECTION` lookup table it
depended on were dead code afterward and were deleted. This was a small, contained fix (2
insertions, 13 deletions) made directly by the Architect without a separate
Builder/Tester dispatch, since it was trivially verifiable in one step.

**Outcome:** Verified live in-browser (fresh port, per the standing browser-cache
testing constraint below) by keeping the Books tab active/visible and then (1) calling
`importData()` directly with a payload adding a new Notes record, and (2) calling
`runSync()` with a mocked `fetch` returning a payload with a new Notes record — in both
cases the hidden Notes tab's DOM updated immediately (new note appeared in `#notes-list`)
without switching tabs, confirming the fix. No new bugs found.

**Standing constraints established:**
- Any future collection added to `SYNC_COLLECTIONS` automatically gets correct
  all-tabs re-rendering for free from this fix — sync/import re-render every collection
  in the loop directly; no per-collection special-casing or an active-tab lookup should
  be reintroduced.

## 2026-09-15 — Recipe organization + usefulness audit

**Decision — recipe categorization:** the user asked the Architect to organize the 22
imported recipes "how you see fit" (the 2026-09-15 personal-data-import entry above had
deliberately left `category` blank on every recipe as a judgment call for later). All 22
were assigned one of three categories based on their actual ingredients/technique:
**Puerto Rican** (13 — the sofrito/adobo/sazon-based dishes: Chocolate Coquito, Sofrito,
Arroz con Gandules, Tostones, Chicken Fricassee, Chicken in a Wine Glaze, Pollo Guisado,
Sancocho, Pinchos de Pollo, Shrimp and Rice Stew, Jon's Porkchops, Jon's Chicken, Carne
Guisada), **Comfort Food** (7: Chicken Alfredo, Bacon Wrapped Chicken Breasts, Air Fried
Asian Chicken, Beef Stroganoff, Santa Fe Soup, Jon's Potato Soup, Sausage and Cheese
Balls), **Sides & Vegetables** (2: Mom's Green Beans, Baked Veggies). Written directly
into `sync_data.json` using the direct-datastore-edit technique validated in the prior
data-import cycle, version-bumped and re-stamped per record.

**Decision — usefulness audit:** rather than guessing at generic features, the Architect
reviewed the app's actual current data volumes/patterns (218 books in flat unsorted
columns, real transcript credit totals with no summary anywhere, freshly-categorized
recipes with no way to filter by category, and ~290 records living in exactly one JSON
file with zero backup) and proposed six concrete, low-risk, no-schema-change additions.
The user approved all six, including two the Architect had explicitly flagged as bigger
asks needing separate confirmation before building (persistent sync auto-start, and a
data import/restore feature) rather than defaults.

**What was built:**
1. Recipe category filter — chips derived live from whatever categories actually exist
   in the data (never hardcoded), combined with search as AND, not OR.
2. Data export — a sidebar button that downloads the full nine-collection dataset as a
   timestamped JSON file, entirely client-side (Blob + `<a download>`), a safety net
   against the single-JSON-file/single-machine risk.
3. Data import — a client-side port of the sync server's proven version-based merge
   algorithm (`merge_collection`/`_content_matches` in `sync_server.py`), including its
   "keep both on genuine conflict, no-op on identical retry" semantics and deep (not
   reference) equality checking.
4. Books sorted by author — a stable per-status-column sort (empty/missing author sorts
   last, not first); render-only, the underlying `books` array/`dateAdded` order is
   untouched.
5. Quick stats on Books and Coursework — live-computed one-line summaries; Coursework's
   line correctly omits a status group entirely if nothing in it has a recorded credit
   value, rather than showing a misleading "0".
6. Persistent sync server (infrastructure, not app code) — a `.vbs` launcher placed in
   the current user's Windows Startup folder (`%APPDATA%\Microsoft\Windows\Start Menu\
   Programs\Startup\second-memory-sync.vbs`), silently starting `sync_server.py` via
   `pythonw.exe` at every login. Chosen over a Task Scheduler entry because
   `Register-ScheduledTask`/`schtasks /create` were both blocked by this session's
   sandbox (`Access is denied`) even for an unprivileged per-user logon trigger; verified
   working by manually invoking it and confirming the server bound port 8443 with no
   visible window.

**Outcome — two bugs found (Tester, both independently reproduced live by the Architect
before being routed back and re-verified fixed):**
1. Recipe filter stale-render race: `renderRecipes()` computed its filtered `visible`
   list using the current `selectedRecipeCategory` before the later call that detects a
   vanished category and resets the selection to "All" — so on the render where a
   category disappears, the chip correctly showed "All" but the list briefly rendered
   empty. Fixed by reordering: the category-filter render/reset now runs before
   `visible` is computed.
2. Import validation gap: `extractImportCollections()` accepted any `collections` value
   where `typeof === 'object'`, which is also true for a JSON array, so a malformed file
   shaped like `{"collections": [1,2,3]}` passed validation and silently produced a
   misleading "nothing new to merge" success message. Fixed by explicitly excluding
   arrays (`&& !Array.isArray(parsed.collections)`).

All six additions plus both fixes verified live end-to-end by the Architect (fresh-port
test instance, real imported dataset): category filter chips render/filter correctly
(13/7/2 confirmed by direct DOM query); Books stats line and author-sort correct against
the real 218-book dataset; Coursework stats line correct against the real transcript
data; a full export→reimport round-trip produced zero duplicates and expected "updated"
counts across all four populated collections; both previously-buggy scenarios now behave
correctly; zero console errors; the sync server remained live throughout, unaffected,
serving only its three allowlisted files.

**Standing constraints established:**
- The persistence mechanism for sync auto-start is a Startup-folder VBS script, not a
  Scheduled Task — Task Scheduler tooling (`Register-ScheduledTask`/`schtasks`) is
  blocked in this environment even for unprivileged per-user triggers. Future cycles
  touching sync startup should not assume Task Scheduler works, and must not create a
  second, conflicting auto-start mechanism alongside the existing VBS launcher.
- When live-verifying a code change against the plain `python -m http.server` test
  instance (not `sync_server.py`, which already restricts what it serves), use a new
  port per test pass rather than trusting a same-port reload. The browser's ordinary HTTP
  cache serves a stale `app.js`/`index.html` across "fresh" navigations to the same
  `localhost` port (Python's `http.server` sends no no-cache headers, and a cache-busting
  query string on the document URL doesn't reach a separately-cached `<script src>`
  sub-resource) — this can silently mask a real fix or manufacture the illusion of a bug
  that isn't there. A fresh port is a fresh cache namespace.
- Recipes' `category` field is now fully backfilled (no blanks remain) with the
  Puerto Rican / Comfort Food / Sides & Vegetables taxonomy above; a future cycle adding
  new recipes should assign one of these three categories (or deliberately introduce a
  new one) rather than leaving `category` blank as the prior cycle did.
- Client-side import reuses the server's merge semantics exactly (content-diff before
  version-diff, deep equality, keep-both-on-genuine-conflict) — any future change to the
  server's `merge_collection`/`_content_matches` logic must be mirrored in the client
  import path, or the two will silently diverge.

## 2026-09-15 — Personal data import (Books, Recipes, Coursework, Notes)

**Decision:** The user attached four personal documents to the conversation with no
accompanying message — an implicit "put this in the app" request, since each document's
content mapped exactly onto an existing collection. Because no schema or feature change
was needed (every document fit a collection already built), the Architect populated the
canonical dataset directly rather than running the full Researcher/Analyst/Builder/Tester
pipeline: this was a data-entry cycle, not a build cycle.

**What was imported:**
- **Books** (218 records, from `My_Book_Collection.docx`): organized by series, the
  source explicitly distinguished owned vs. wanted books. Books explicitly marked owned
  (including entire series marked "Complete") → `owned_unread`; books explicitly named as
  missing/not-owned/forthcoming → `want_to_buy` (174 / 44 split). No book was imported as
  `owned_read` since the source tracks ownership, not reading progress.
- **Recipes** (22 records, from `Family_Recipe_Collection.docx`): title/ingredients/steps
  parsed directly. `category` deliberately left blank on every record rather than
  inferring cuisine labels (many are Puerto Rican sofrito/adobo/sazon dishes) — flagged as
  a judgment call for the user to fill in themselves, since it wasn't requested and the
  field is optional.
- **Degree & Coursework** (48 records: 45 completed / 3 in_progress / 0 planned, from
  `NT_SSR_TSRPT.pdf`, a UNT undergrad + grad transcript): deduplicated courses that
  appeared twice in the source (a failed/withdrawn attempt followed by a successful
  repeat — BCIS 3630, FINA 3770, BCIS 4740, MATH 1181, PSCI 2306, YSPC 99991A21) by
  importing only the successful, credit-earning attempt for each, to avoid inflating the
  list with attempts that didn't count. Tarrant County College transfer credit is tagged
  in each affected record's `notes` field. The three Fall 2026 graduate courses (CSCE
  5200/5300/5310, Data Engineering M.S. + AI Graduate Certificate) were imported as
  `in_progress` since the transcript shows no posted grade for the current term.
- **Notes**: one record holding the full `Diabetes_Nutrition_Reference_Guide.docx` text
  verbatim (carb-counting charts, heart-healthy fat/sodium guidance, sample meal plans) as
  a single cohesive reference note rather than split into smaller notes. A second note,
  "Degree Summary — UNT," was authored (not a direct file import) to capture the degree
  conferral itself (B.S. Business Computer Information Systems, conferred 05/10/2025, GPA
  2.792) plus the current graduate program — added because Coursework has no field for
  degree-level information, and the 2026-09-14 personal-collections-expansion cycle
  already explicitly decided against adding a parent "Degree" record. This note is a
  bridge for that gap, not a reopening of that schema decision.

**Method (recorded for future bulk-population cycles):** the Architect wrote the new
records directly into `sync_data.json` (the sync server's canonical datastore) via a
Python script, matching the exact shape the app's own `addX()` functions produce (`id`,
`dateAdded`, `updatedAt`, `deviceId`, `deleted: false`, `version: 1`), instead of using the
UI ~290 times by hand. This works only because of how sync already behaves: any device's
next successful sync fully replaces its local collections with the server's current
state, so server-only records the client never sent still flow down correctly.

**Outcome:** No code changed; no bugs found. Verified via three independent checks: (1)
a real authenticated `/api/sync` POST returned all four collections with the expected
counts; (2) the data was loaded into a real browser instance and every affected tab
(Books, Recipes, Coursework, Notes) was visually confirmed rendering correctly — correct
status columns, correct Completed/In Progress/Planned counts (45/3/0), ingredients/steps
displaying properly, note content intact; (3) counts cross-checked against the source
documents by hand. All four original source files were left untouched on the user's
Desktop (read-only access). The temporary test-injection file used for the browser
verification pass was removed after use.

**Standing constraints established:**
- Direct-to-`sync_data.json` bulk import (bypassing the UI) is a validated technique for
  future large personal-data-import cycles, provided records are written in the exact
  `addX()` output shape (`id`/`dateAdded`/`updatedAt`/`deviceId`/`deleted: false`/
  `version: 1`) — this relies on sync's existing full-state-replace-on-pull behavior and
  should not be treated as a precedent for skipping the normal pipeline on cycles that
  *do* involve schema or code changes.
- Books imported from an ownership-tracking source (rather than a reading-progress
  source) must never be defaulted to `owned_read` — only `owned_unread`/`want_to_buy` can
  be inferred from ownership language; `owned_read` requires actual reading-progress
  confirmation.
- When deduplicating a transcript or similar append-only source with repeated/corrected
  entries, only the successful/credit-earning attempt is imported — failed, withdrawn, or
  superseded attempts are excluded rather than kept as separate records.
- Recipes' `category` field remains blank wherever cuisine wasn't explicitly stated in the
  source — inferring it is left as a standing open task for the user, not something a
  future cycle should silently backfill via guesswork.
- The "no parent Degree record" schema decision from 2026-09-14 still stands; the "Degree
  Summary — UNT" note is a manually-authored workaround for degree-level information, not
  a schema change, and should not be read as reopening that decision.

## 2026-09-15 — Device sync architecture

**Decision:** Built the app's first real network functionality — cross-device sync
between the user's phone and computer over home WiFi — with a hard requirement that the
phone stay fully usable offline whenever the computer (which hosts sync) is off, and
reconcile automatically once it's back online. This is the largest, highest-stakes cycle
in the project's history: the first network call, the first authentication, and the
first data stored outside the browser's own `localStorage`. Researcher and Analyst ran
in parallel. Researcher (`docs/research/device-sync-architecture.md`) recommended a
server-owned per-record `version` integer with optimistic concurrency (ETag/If-Match
style) over last-write-wins-by-timestamp, specifically because LWW is vulnerable to
clock skew between devices — a real risk given this app's own two devices; recommended
full-dataset push+pull per sync over a delta/changelog approach, given the small data
scale; recommended against a service worker/Background Sync API (confirmed unsupported
on Safari/iOS, and requires a secure context a plain-HTTP LAN address doesn't have) in
favor of simple interval-based polling (30–120s) while a tab is open; and recommended a
shared-secret token (HMAC-compared) over OAuth/accounts machinery, since home WiFi
(WPA2-PSK) doesn't protect traffic from other devices already on the network — confirmed
via Wireshark's own documentation. Analyst (`docs/specs/device-sync-data-model.md`)
specified per-record sync metadata (`updatedAt`, `deviceId`, `deleted` tombstone, and —
reconciled below — `version`) added uniformly across all nine collections, tombstone-not-
hard-delete semantics (a hard delete on one device leaves no signal for the other device
to also remove the record, so a naive full-state diff would resurrect it), and traced
every existing status-conditional field rule (Books rating, Medications derived status,
Coursework grade, Diagnoses transitions) to confirm none needed behavior changes beyond
adding sync-stamp calls.

Two decisions were explicitly escalated to the user rather than defaulted, given this
cycle touches personal health data over a network for the first time:
1. **Security:** HTTPS with a self-signed cert and a shared passphrase, chosen over
   plain HTTP — accepting a one-time per-device browser security-warning click-through in
   exchange for encrypting sync traffic.
2. **Conflict resolution:** on a genuine conflict, keep BOTH versions as separate records
   rather than silently letting the most recent edit win — chosen so nothing is ever
   silently discarded, even at the cost of an occasional duplicate the user needs to
   notice and clean up.

**Architecture built:** `sync_server.py`, a new stdlib-only Python HTTPS server (no pip
installs — reuses the `openssl.exe` already bundled with the project's existing Git for
Windows install purely as a one-time cert-generation tool, not a runtime dependency)
serving both the static app files and one API endpoint, `POST /api/sync`, on port 8443.
Self-signed cert auto-generated (and auto-regenerated if the LAN IP changes) with proper
SAN coverage. Passphrase auto-generated on first run, printed once, saved to a gitignored
`.sync_secret`. All nine collections in `app.js` gained `updatedAt`/`deviceId`/`deleted`/
`version` fields via an idempotent migration that backfills existing records (verified
live: the very first "Dune" book from the project's initial cycle survived the migration
with no data loss). Every `deleteX` function converted from array removal to
tombstone-in-place; every `renderX`/`matchesXSearch`/empty-state check updated to filter
`deleted: true` records. A sync status/settings panel was added to the sidebar (server
URL + passphrase, a status line, a "Change" button).

**Reconciliation between the two independent design docs (recorded here so the docs and
shipped code don't silently disagree):** `docs/specs/device-sync-data-model.md` Section
2.6 had specified whole-record last-write-wins by `updatedAt`, left as an open question
in that doc's Section 8.h. The Researcher's parallel brief recommended the server-owned
`version`/optimistic-concurrency model instead, specifically to avoid LWW's clock-skew
failure mode. The Architect went with the Researcher's version-based approach as the one
actually built — it's the technically stronger mechanism and is the basis of the
"keep both on conflict" decision above. **The data-model spec's Section 2.6 is
superseded by the version-based mechanism actually implemented; `updatedAt` remains as a
per-record field for display/audit purposes but is not what conflict detection is based
on.**

**Security vulnerability found and fixed:** the Architect (via live `curl` testing
against the running server) and the Tester (via static code review) independently found
the same root cause, confirming each other: `sync_server.py`'s static file handler had a
path-traversal guard (rejecting requests resolving outside the app root) but no filename
allowlist, so it served ANY file in the app root to any unauthenticated request —
including `.sync_secret` (the auth passphrase), `key.pem` (the TLS private key),
`sync_data.json` (the full synced dataset, including medications and diagnoses), and the
server's own source. This single gap defeated the token auth, the TLS confidentiality
guarantee, and the health-data confidentiality all at once. Fixed by adding an explicit
`ALLOWED_STATIC_FILES = {"index.html", "style.css", "app.js"}` allowlist checked before
any file access — confirmed fixed via direct `curl` testing (all four previously-leaking
paths now 404; the three legitimate app files still serve normally).

**Two follow-up gaps found by the Tester's static review, fixed and re-verified live:**
1. Retry-without-idempotency spurious duplicates: a sync response lost after the server
   had already applied it (a real scenario for a phone losing WiFi mid-response) would
   make an identical retry look like a genuine conflict, creating a spurious duplicate of
   an edit that never actually conflicted. Fixed by comparing incoming content against
   the existing server record (ignoring only `version`) before treating a version
   mismatch as a real conflict — an identical retry is now a safe no-op. Verified live:
   an exact-payload retry after a successful create produced zero duplicates.
2. Conflicts were resolved silently with no signal to the user, undercutting the reason
   "keep both" was chosen over silent LWW. Fixed by having the server return a
   `conflicts` array (collection, original id, new duplicate id) alongside the merged
   dataset, surfaced in the client's sync status line ("Synced — N conflict(s) merged as
   duplicates in Books, Medications. Review and remove any you don't need.") reusing the
   existing failed-state styling rather than a new UI element. Verified live: a genuine
   conflict correctly produced exactly one flagged duplicate; the idempotent-retry case
   above correctly produced zero.

**Standing constraints established:**
- All nine collections carry `updatedAt`, `deviceId`, `deleted`, and `version` fields;
  deletes are tombstones (`deleted: true` in place), never array removal. Every render/
  search/empty-state path must filter `deleted: true` records.
- Conflict detection is based on the server-owned `version` integer (optimistic
  concurrency), not `updatedAt`/LWW — `docs/specs/device-sync-data-model.md` Section 2.6
  is superseded by this entry.
- On a genuine conflict, both versions are kept as separate records (never silently
  overwritten); an identical retry of an already-applied change is a no-op, not a
  conflict — this distinction (content-diff, not just version-diff) must be preserved in
  any future change to the merge algorithm.
- `sync_server.py` (or any future server-side static file serving) must use an explicit
  filename allowlist, not just a path-traversal check — a resolved-path-stays-under-root
  guard alone is insufficient whenever the served directory also contains secrets or
  generated state (`.sync_secret`, `key.pem`, `sync_data.json`). This is the **fourth**
  distinct standing bug class this project has now hit and fixed, after the three
  CSS-specificity/display-override landmines logged in the 2026-09-14 entries.
- Sync uses interval-based polling (30–120s) while a tab is open, never a service worker
  or Background Sync API (unsupported on Safari/iOS; requires a secure context the LAN
  setup doesn't reliably have).
- Auth is a shared-secret passphrase (HMAC-compared) over HTTPS with a self-signed cert —
  not OAuth/accounts — a deliberate user-approved tradeoff for a single-user home-LAN
  tool, not a default to reuse unquestioned if the threat model ever changes (e.g. a
  non-LAN or multi-user deployment).

**Outcome:** Server-side merge algorithm (all four scenarios: new record, clean update,
conflict, tombstone), concurrency locking, and TLS/cert logic all verified correct.
Client-side tombstone completeness, sync-stamp completeness, zero-config safety, and all
four pre-existing status-conditional rules (Books/Medications/Coursework/Diagnoses)
re-verified unbroken across all nine collections individually. The critical security
vulnerability and the two follow-up correctness/UX gaps were all found, fixed, and
re-verified before this entry was written. One verification gap remains and is left for
the user's first real-world run: the Architect's browser automation tooling deliberately
refuses to navigate past an untrusted self-signed TLS certificate (the same protection a
real browser gives a real user, with no programmatic "proceed anyway"), so the actual
"open the HTTPS URL, accept the one-time cert warning, use the sync settings form, watch
a real sync round-trip complete" flow could not be end-to-end tested by the Architect.
Everything else was verified without that manual step: the full server-side API via
direct authenticated HTTPS calls (bypassing only certificate *trust*, not the protocol),
and the full client-side data layer via direct in-browser JavaScript execution against a
plain-HTTP test server. This cycle is considered done from an implementation-correctness
standpoint, with that one manual-verification gap flagged for the user.

## 2026-09-15 — Feminine redesign pass

**Decision:** Pushed the visual design "more feminine" per four concrete directions the
user specified: rounder/more delicate shapes, floral accents alongside the existing leaf
background, keeping green/brown as the main palette while layering in additional accent
colors (blush/rose/lavender), and a softer decorative typography treatment for headings
only. Researcher ran alone this cycle — purely visual/CSS work with no data model or
schema involved, so no Analyst was needed. Researcher (`docs/research/feminine-redesign.md`)
produced two new WCAG-checked accent tokens (`--accent-rose`, `--accent-lavender`) plus a
tint (`--tint-blush`) as additive-only extensions to the palette (existing
`--accent`/`--text`/`--bg`/`--border` tokens untouched), concrete larger radius numbers
(18–20px cards, 12–14px controls, up from the prior cycle's 12–14px/6–9px), a technique
to extend the *same* single-SVG leaf background pattern with floral shapes rather than
adding a second background layer, and a zero-dependency heading font recommendation (a
system cursive-font stack — "Snell Roundhand"/"Bradley Hand"/"Segoe Script" etc. — over
self-hosting an actual font file, since a binary font asset would be a new kind of
project dependency this all-inline-SVG/CSS/JS app has avoided everywhere else). Builder
implemented all of it in `style.css` only — no `index.html`/`app.js` changes were needed
this cycle.

**Standing constraints established:**
- New tokens `--accent-rose`, `--accent-lavender`, `--tint-blush`, `--border-soft` are
  additive accent colors layered onto the existing palette, not a replacement — future
  cycles should keep treating `--accent`/`--text`/`--bg`/`--border` as the stable "main"
  identity of the app and these four as secondary accents.
- A two-tier border convention was introduced: functional/interactive element borders
  stay on `--border` (which carries the original WCAG 3:1 non-text-contrast
  verification), while purely decorative, non-interactive container borders (card/panel
  edges) may use the new `--border-soft` token, which is exempt from that contrast floor
  since it conveys no information (SC 1.4.11's own decorative-element exemption). Don't
  use `--border-soft` on anything interactive.
- `--font-heading` (the cursive system-font stack) applies ONLY to `h1`/`h2`/`h3` — never
  to body text, form inputs, labels, or buttons. Any element that inherits into a heading
  (the one existing case: `.count` badges nested inside `h3` column headers) must get an
  explicit reset back to the plain body font stack, since `font-family` is an inherited
  CSS property and a heading-context badge showing a plain number in cursive would look
  wrong.
- The known "avoid rose-text on blush-tint background" pairing (4.60:1 in light mode —
  technically passes WCAG but with almost no margin) should stay avoided in future cycles
  unless re-verified.

**Outcome:** Tester's static review passed all 6 requested checks plus the
offline-guarantee spot-check — no hard failures. Two non-blocking notes logged for the
record: (1) `--accent-contrast` (a token predating this cycle) still isn't documented in
the original `docs/research/palette-fields-nav.md` table — a pre-existing doc gap, not
something this cycle introduced or is responsible for fixing; (2) `--border-soft`'s
dark-theme hex value was extrapolated by the Builder rather than pulled from the research
doc, which only specified a light-theme value — harmless since decorative borders are
contrast-exempt, but worth flagging so a future cycle doesn't mistake that specific number
for a sourced one. Architect verified live in-browser (via the LAN-hosted server) that
the add-book flow and visual rendering both work correctly post-redesign.

## 2026-09-14 — Personal-collections expansion: To-Do, Shopping List, Notes, Resume & Portfolio, Degree & Coursework + soft/calm leaf redesign

**Decision:** Added five new collections — To-Do list, Shopping list, Notes, Resume &
Portfolio, and Degree & Coursework — plus a softer, calmer visual redesign with a
decorative leaf background. Researcher and Analyst ran in parallel again. Researcher
(`docs/research/soft-calm-leaf-background.md`) worked out a zero-dependency inline-SVG
leaf background technique and drew a precise WCAG line: SC 1.4.11 exempts purely
decorative art, but SC 1.4.3/Failure F83 still requires real text over it to clear
normal contrast minimums wherever the two overlap, plus concrete soft/calm parameters
(radius, shadow, spacing, line-height ≥1.5 per SC 1.4.12). Analyst
(`docs/specs/personal-collections-expansion.md`) produced the five schemas plus a
sidebar regrouping into four labeled sections — Library, Personal, Health, Career &
Academics — extending the existing Books/Recipes/Medications/Diagnoses grouping
pattern, with twelve flagged default decisions the Architect confirmed before build.
Builder implemented all five collections, the regrouped sidebar, and the redesign
against that approved spec.

**Standing constraints established (from the spec):**
- New storage keys: `secondMemory.todos.v1`, `secondMemory.shoppingList.v1`,
  `secondMemory.notes.v1`, `secondMemory.links.v1` (Resume & Portfolio — named for the
  data shape, a generic link list, not the UI label), `secondMemory.courses.v1` (Degree
  & Coursework — no separate "Degree" parent record; deliberately kept flat, matching
  the app's no-relational-fields precedent).
- To-Do/Shopping List: completed/checked items stay in place with a struck-through
  visual state rather than moving to a separate section — consistent with the "flat
  list, minimal reorganization" precedent from Recipes.
- Notes is the only collection with a `dateModified` field (distinct from `dateAdded`)
  and the only one with a stateful inline view/edit toggle holding unsaved input in
  the DOM.
- Coursework's `grade` field is status-conditional exactly like Books' `rating`: clears
  to `null` on any transition away from `completed`, never auto-populated when moving
  into it.
- Resume & Portfolio accepts `url` exactly as entered with zero rewriting of stored
  data; a `https://` prepend happens only in the rendered `href`, via scheme-detection
  regex, never touching the stored value or displayed link text.

**Outcome:** Tester's static review passed all 8 requested checks, plus found one real
functional bug: Notes' `renderNotes()` unconditionally rebuilt the entire list from the
`notes` array on every search keystroke, add, or delete, silently destroying any
in-progress (unsaved) edit open in another note's inline edit form. Builder fixed it by
having `renderNotes()` capture an open edit form's live (unsaved) DOM values before
clearing the list, then restoring them to the matching note's rebuilt card afterward if
it's still in the filtered/rendered set. The Architect's first live-browser check
appeared to still show the bug, but that was a false alarm traced to stray leftover DOM
nodes from the Architect's own manual debugging script, not a real regression; a clean
reload plus a clean repro confirmed the fix works correctly.

Separately, the Architect's live browser verification pass (outside the Tester's static
scope) found and fixed three CSS bugs:
1. **Grid blowout:** `.column` (a CSS grid item) had no `min-width: 0`, so it couldn't
   shrink below its content's intrinsic width, causing horizontal overflow at viewport
   widths roughly 700–920px. Fixed by adding `min-width: 0` to `.column`.
2. **Flex stretch across mixed-height siblings:** the base `.add-form` rule never set
   `align-items`, defaulting to `stretch`, so a plain single-line `<input>` next to a
   taller `.date-field` (label-above-input) stretched to match its height. Fixed by
   adding `align-items: flex-start` to the base `.add-form` rule (the existing
   `.add-form-stacked` override already redeclares its own `align-items: stretch` and
   was unaffected).
3. **Descendant-selector overreach** (a new variant of the specificity-bug class logged
   in the prior cycle): `.add-form input[type="date"]` also matched the date `<input>`
   nested inside `.date-field`, so its row-context `flex: 1 1 160px` became a height
   basis inside `.date-field`'s column-direction flex layout, stretching the input.
   Fixed with a same-specificity override: `.date-field input[type="date"] { flex:
   none; }`. This is the **third** distinct incident of a row-context flex rule leaking
   into a column context via CSS selector scope — future cycles should specifically
   test every new form layout at the actual DOM nesting depth the rule matches, not
   just at the top level.

All nine collections (four prior + five new) verified working end-to-end in-browser:
add/edit/move/delete/search on every collection, status-conditional field clearing
(Coursework grade), URL handling (Resume & Portfolio), sidebar regrouping and tab
persistence, zero network requests confirmed via the browser's network log throughout.

## 2026-09-14 — Multi-tab expansion: Recipes, Medications, Diagnoses + earthy/leafy redesign

**Decision:** Expanded the single-tab Books app into four tabs — Books (unchanged),
Recipes, Medications, and Diagnoses — plus a full visual redesign. Researcher and
Analyst ran in parallel: Researcher produced a WCAG-2.1-checked earthy/leafy color
palette (light + dark, exact hex values, contrast pairings computed against the real
formula, not eyeballed) and USCDI-grounded field conventions for medications/diagnoses
(chosen over SEO-sourced conventions for clinical-field accuracy), written to
`docs/research/palette-fields-nav.md`. Analyst produced the data-model spec at
`docs/specs/multi-tab-tracker.md`, including nine explicitly flagged default decisions
(Section 6) that the Architect confirmed as-is before build, so Builder had zero
ambiguity going into implementation. Builder then implemented all four tabs, the
sidebar shell, and the palette against that approved spec.

**Standing constraints established (from spec Sections 1–4):**
- Each collection has its own independent `localStorage` key
  (`secondMemory.recipes.v1`, `secondMemory.medications.v1`,
  `secondMemory.diagnoses.v1`) — no shared state or cross-collection references.
- Medications' "currently taking" status is *derived* from `endDate === null` rather
  than stored as an explicit status field — mirrors the Books rating-clearing pattern
  of keeping a single source of truth instead of a redundant flag.
- Medications reject save/edit when `endDate < startDate` and both are present.
- Diagnoses status (`active`/`monitoring`/`resolved`) transitions freely in both
  directions with no dependent fields to clear on transition.
- Active tab persists across reloads via `secondMemory.ui.v1`.
- Resuming a stopped medication is a known, accepted gap: it's modeled as editing the
  existing record's `endDate` back to `null`, which discards the prior stop date rather
  than keeping episode history. Flagged in the spec as unresolved if it becomes a
  problem later — not something to "fix" unilaterally in a future cycle without
  re-opening the spec.
- Whenever a new form or layout-variant class is introduced, its override selector must
  match or exceed the *specificity* of the base rule it's overriding, not just come
  later in the cascade — source order only breaks ties between equal-specificity
  selectors. This is the second cycle in a row where a layout-override bug slipped
  through (see the `.rating-label` entry below); future Builder/Tester passes should
  specifically check for both (a) `display` rules fighting `[hidden]`, and (b)
  specificity mismatches between a base-layout rule and a variant-layout override, any
  time a new UI variant class is added.

**Outcome:** Tester ran a static (non-browser) review covering all 7 requested checks
plus several bonus checks — all passed clean, no defects found in the reviewed code
paths. However, during the Architect's own live browser verification pass (outside the
Tester's static scope), a real CSS specificity bug was found and fixed: `.add-form
input[type="text"]` in `style.css` (specificity: class + attribute + element) set `flex:
1 1 160px` for the original single-row Books form. Its specificity beat the new
`.add-form-stacked input` override (class + element), so when Builder added
`.add-form-stacked { flex-direction: column }` for the new multi-field Recipes/
Medications/Diagnoses forms, the un-overridden `flex-basis`/`flex-grow` applied to the
now-vertical main axis, stretching every text input into a huge box instead of a normal
single-line field. Fixed by raising the override selector's specificity to match:
`.add-form-stacked input[type="text"], .add-form-stacked input[type="date"],
.add-form-stacked input[type="search"], .add-form-stacked textarea,
.add-form-stacked select, .add-form-stacked .date-field { width: 100%; flex: none; }`.
Verified fixed via before/after live screenshots.

## 2026-09-14 — Initial scaffold: Books collection + agent team

**Decision:** Built the first version of Second Memory as a single-page, dependency-free
HTML/CSS/JS app with a Books collection (statuses: `want_to_buy`, `owned_unread`,
`owned_read`). Chose `localStorage` for persistence over IndexedDB or a backend — the
data volume for a personal list is small, `localStorage`'s synchronous JSON API is
simpler for this scale, and it fully satisfies the "no external dependency, works
offline or online" requirement.

**Standing constraints established:**
- Only a book with status `owned_read` carries a `rating` (1–5). Moving a book away
  from `owned_read` clears its rating rather than preserving a stale value.
- No npm packages, no CDN scripts, no build step — enforced for every future cycle,
  not just this one.
- The Architect role is the main assistant session itself, not a subagent file — only
  the top-level session can dispatch to the other five roles via the Agent tool.

**Outcome:** Verified in-browser (Architect ran this pass directly rather than
dispatching the Tester subagent, since it was the first cycle). Found and fixed one real
bug: `.rating-label { display: flex; }` in `style.css` overrode the element's `hidden`
attribute, so the rating selector showed on `want_to_buy`/`owned_unread` cards too.
Fixed by adding `.rating-label[hidden] { display: none; }`. After the fix: add/move/
delete/search all work, the rating control appears only on `owned_read` cards, no
network requests are made (confirmed via the browser's network log — only the local
`index.html`/`style.css`/`app.js` load), and data persists across a page reload. The
Tester subagent should be dispatched for verification from the next feature cycle
onward.
</content>
