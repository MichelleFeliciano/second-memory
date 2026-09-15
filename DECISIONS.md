# Decisions Log

This file is maintained by the Archivist role. Newest entries at the top. Each entry
records what was decided, why, and any standing constraint future work must respect.

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
