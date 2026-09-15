# Decisions Log

This file is maintained by the Archivist role. Newest entries at the top. Each entry
records what was decided, why, and any standing constraint future work must respect.

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
