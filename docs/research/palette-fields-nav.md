# Research Brief — Earthy/Leafy Palette, Tracking Field Conventions, Nav Pattern

Produced by the `researcher` subagent for the multi-tab expansion cycle (2026-09-14).
Full detail; the Builder should treat the hex values and contrast notes here as
load-bearing, the field-convention and nav-pattern notes as informative context.

## Color palette (WCAG 2.1 AA-checked)

Contrast formula confirmed against the W3C WCAG 2.1 normative definition
(`(L1+0.05)/(L2+0.05)` on relative luminance). Thresholds: normal text ≥ 4.5:1, large
text ≥ 3:1 (SC 1.4.3), UI component/non-text boundaries ≥ 3:1 (SC 1.4.11).

### Light theme
| Token | Hex | Role |
|---|---|---|
| `--bg` | `#F6F1E7` | page background (parchment) |
| `--surface` | `#FBF8F2` | cards |
| `--text` | `#3B2A1E` | body text — 12.15:1 on `--bg` |
| `--muted` | `#5C4B3A` | secondary text — 7.40:1 on `--bg` |
| `--accent` (moss) | `#4B6043` | primary buttons/links/active nav — 6.11:1 on `--bg`; white text on this fill → 6.87:1 |
| `--accent-2` (terracotta) | `#A34A2A` | secondary accent — 5.23:1 on `--bg` (a brighter `#B5502E` measured 4.495:1 and FAILS 4.5:1 — do not use for normal text; reserve brighter terracottas for large text/icons/badges only) |
| `--border` | `#8A7460` | input borders, focus rings — 3.93:1 on `--bg` |

### Dark theme
| Token | Hex | Role |
|---|---|---|
| `--bg` | `#221913` | page background |
| `--surface` | `#2E241C` | cards |
| `--text` | `#EFE6D8` | body text — 13.96:1 on `--bg` |
| `--muted` | `#C9BBA5` | secondary text — 9.15:1 on `--bg` |
| `--accent` (sage) | `#9CBB8C` | primary buttons/links/active nav — 8.14:1 on `--bg` |
| `--accent-2` (terracotta) | `#E08A5B` | secondary accent — 6.54:1 on `--bg` |
| `--border` | `#8A7460` | same token reused — 3.90:1 on this `--bg` (coincidental, re-check if either bg changes) |

## Tracking field conventions (grounded in USCDI, the current ONC interoperability
standard — CCR was considered but is withdrawn/paywalled, so not used)

- Medications: name, dose+unit, route (optional), instructions/frequency, indication/
  purpose are USCDI Medications-class elements. Prescriber and start/end-date-as-fields
  are common-sense additions, not literal USCDI fields.
- Diagnoses: condition name and date of diagnosis are USCDI Problems-class elements;
  a status field (active/inactive/resolved) was likely added in USCDI v7. Diagnosing
  provider is a common-sense addition, not a USCDI field.
- Not clinical software — this app makes no medical claims; fields are for personal
  reference only.

## Navigation pattern

No direct NN/g source compares sidebar vs. top-tabs for a 4-item single-page tool.
NN/g does confirm persistently visible nav (either pattern) beats hidden/hamburger nav,
and that tabs suit "alternate views of the same object" — arguably a weaker fit for four
unrelated collections than for one object's views. Researcher's design judgment (not a
sourced fact): a **left sidebar** scales better if a 5th collection is added later and
keeps the active section persistently visible without competing with in-page search/
toolbar space. Architect decision: going with the sidebar per this recommendation.
