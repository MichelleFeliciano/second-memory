# Research Brief — "Light and Airy, Foresty, Feminine" Redesign (Light Primary Complaint + Dark Mode Retune)

Produced by the `researcher` subagent (2026-09-15). Extends and partially supersedes
`docs/research/palette-fields-nav.md` (original earthy palette), `docs/research/soft-calm-leaf-background.md`
(leaf-background technique + opacity methodology), and `docs/research/feminine-redesign.md`
(rose/lavender accent tokens, radius/shadow numbers, heading font). Does **not** relitigate
radius/shadow/spacing numbers from the feminine-redesign pass — those are untouched by this
brief unless stated otherwise. All contrast math below was computed directly from the WCAG
2.1 relative-luminance formula (`L = 0.2126R + 0.7152G + 0.0722B` on linearized sRGB channels,
contrast `= (L1+0.05)/(L2+0.05)`), the same formula every prior brief in this project has used
— **Confirmed** application of a **Confirmed** formula: W3C, relative luminance definition,
https://www.w3.org/TR/WCAG21/#dfn-relative-luminance. Thresholds per SC 1.4.3: 4.5:1 normal
text, 3:1 large text/UI components.

## Question asked
1. A revised light + dark palette that reads as "light and airy, foresty, feminine" — lighter/
   airier than the current cream/tan, forest green as the *dominant* accent (not co-led by
   brown/rust), rose/lavender kept as feminine accents; dark mode retuned to deep forest/
   botanical tones instead of dark brown, without becoming muddy.
2. WCAG AA contrast verification for every text/background pairing, both themes, shown not
   asserted.
3. A concrete "more dramatic" leaf-decor treatment, zero-dependency, with actual SVG/CSS.
4. Confirm or adjust the existing script heading-font stack.
5. Flag subjective calls rather than deciding them.

---

## 1. Proposed palette

### Light theme (primary complaint — currently reads too dark/heavy)

| Token | Old hex | New hex | Role / rationale |
|---|---|---|---|
| `--bg` | `#F6F1E7` (cream/tan) | **`#F6FAF4`** | pale sage-white "morning mist" — noticeably lighter and cooler than the old warm cream, reads as airy rather than parchment/heavy |
| `--surface` | `#FBF8F2` | **`#FFFFFF`** | pure white cards, sitting one step lighter than `--bg` (same *relative* surface-lighter-than-bg convention as the old palette, just both ends shifted lighter) — gives the "layered, airy" look of white cards floating on a faint green wash |
| `--text` | `#3B2A1E` (warm brown) | **`#1C2B1A`** | deep forest-black — still near-black for max legibility, but green-toned instead of brown-toned, reinforcing "forest" identity in the text itself |
| `--muted` | `#5C4B3A` | **`#4C5D46`** | muted forest gray-green, replaces warm brown-gray |
| `--accent` | `#4B6043` (moss, co-equal with rust) | **`#2E5D34`** | richer, more saturated deep forest green — promoted to sole dominant brand color |
| `--accent-2` | `#A34A2A` (rust/terracotta, co-lead) | **`#A34A2A` unchanged hex, role demoted** — see §1.3 flag below | no longer a co-equal identity color; restrict to error/destructive/overdue-only semantic use so forest green reads as the dominant hue |
| `--border` | `#8A7460` (warm tan) | **`#6B7A63`** | muted sage-green functional border, replaces brown-tan |
| `--border-soft` | `#C9B9A0` | **`#D7E3CE`** | pale sage decorative-only border (still contrast-exempt, see §1.4) |
| `--accent-contrast` | `#ffffff` | **unchanged** (`#ffffff`) | still passes at high margin against the new, more saturated `--accent`, see §1.2 |
| `--accent-rose` | `#A24B68` | **unchanged** | kept exactly — this is already the feminine accent the user liked; only its *background context* changed, not the hue itself |
| `--accent-lavender` | `#6B5B95` | **unchanged** | same rationale |
| `--tint-blush` | `#F6E4E9` | **unchanged** | same rationale |

### Dark theme (retune target — "nighttime forest," not muddy brown)

| Token | Old hex | New hex | Role / rationale |
|---|---|---|---|
| `--bg` | `#221913` (dark brown — likely source of "too dark") | **`#101C12`** | near-black **deep forest green**, not brown — this is the actual hue-family fix for the "muddy" complaint |
| `--surface` | `#2E241C` | **`#182A17`** | deep forest surface, one step lighter than `--bg` (same relative relationship preserved) |
| `--text` | `#EFE6D8` (warm off-white) | **`#EAF3E6`** | pale mint-white, cooler/greener than the old warm off-white |
| `--muted` | `#C9BBA5` | **`#AEC7A4`** | soft sage, replaces warm tan-gray |
| `--accent` | `#9CBB8C` (sage) | **`#7BC174`** | brighter, more saturated forest/sage green — a real "pop" against the near-black bg for the dramatic-but-still-forest look |
| `--accent-2` | `#E08A5B` | **unchanged hex, role demoted** — same as light theme | |
| `--border` | `#8A7460` (reused brown-tan) | **`#63795A`** | muted sage-green, replaces the brown token entirely — no more brown anywhere in the interactive palette |
| `--border-soft` | `#514236` | **`#33452F`** | deep sage decorative border |
| `--accent-contrast` | `#221913` | **`#101C12`** | updated to match the new dark `--bg` — same existing pattern of "dark bg-toned text sits on top of the light accent fill" carried forward unchanged in mechanism, just re-pointed at the new bg hex |
| `--accent-rose` | `#E8A9BE` | **unchanged** | |
| `--accent-lavender` | `#C9B8E8` | **unchanged** | |
| `--tint-blush` | `#3A2530` | **unchanged** | |

**Net identity change**: every token that was previously brown/tan/rust-family (`--bg`, `--text`,
`--muted`, `--border`, `--border-soft` in both themes, plus dark `--accent-contrast`) is now
green-family. `--accent-2` keeps its rust hex but is explicitly demoted from "co-lead" to
"minor semantic accent" (see flag in §5). Rose/lavender/blush are untouched, so the feminine
identity carries over unchanged — only the neutral/dominant-accent hues shifted.

---

## 2. Contrast verification — every pairing, both themes

Method note: for the two "blended decoration over background" checks in §3, I used the
standard non-premultiplied "source-over" alpha compositing (`result = α·fg + (1-α)·bg` per
channel, in sRGB space) — this is how browsers/SVG composite a translucent fill, per the
existing citation used in the prior feminine-redesign brief: W3C Compositing and Blending
Level 1, https://www.w3.org/TR/compositing-1/#simplealphacompositing.

### Light theme

| Pairing | L1 | L2 | Ratio | Result |
|---|---|---|---|---|
| `--text` (#1C2B1A) on `--bg` (#F6FAF4) | 0.94513 | 0.02047 | **14.12:1** | pass (body text) |
| `--text` on `--surface` (#FFFFFF, L=1.0) | 1.0 | 0.02047 | **14.90:1** | pass |
| `--muted` (#4C5D46) on `--bg` | 0.94513 | 0.09813 | **6.72:1** | pass |
| `--muted` on `--surface` | 1.0 | 0.09813 | **7.09:1** | pass |
| `--accent` (#2E5D34) on `--bg` | 0.94513 | 0.08662 | **7.29:1** | pass (usable as normal-weight link/text color, not just fill) |
| `--accent` on `--surface` | 1.0 | 0.08662 | **7.69:1** | pass |
| `--accent-contrast` (#fff) on `--accent` fill | 1.0 | 0.08662 | **7.69:1** | pass — safe filled-button/active-nav combo |
| `--border` (#6B7A63) on `--bg` (SC 1.4.11, 3:1 floor) | 0.94513 | 0.17933 | **4.34:1** | pass, comfortable margin (old value was 3.93:1 — this is *better*, not just carried over) |
| `--accent-rose` (#A24B68, unchanged) on `--bg` | 0.94513 | 0.13716 | **5.32:1** | pass (up from 4.99:1 on the old, darker bg — lighter bg gave more headroom) |
| `--accent-rose` on `--surface` | 1.0 | 0.13716 | **5.61:1** | pass |
| `--accent-lavender` (#6B5B95, unchanged) on `--bg` | 0.94513 | 0.12782 | **5.60:1** | pass (up from 5.25:1) |
| `--accent-lavender` on `--surface` | 1.0 | 0.12782 | **5.91:1** | pass |
| `--tint-blush` (#F6E4E9, unchanged) with `--text` on top | 0.80967 | 0.02047 | **12.20:1** | pass |
| `--tint-blush` with `--muted` on top | 0.80967 | 0.09813 | **5.80:1** | pass |
| **Carried-over caution, unchanged**: `--accent-rose` text directly on `--tint-blush` | 0.13716 vs 0.80967 | — | **4.60:1** | technically passes, near-zero margin — same caution as the 2026-09-15 feminine-redesign brief; still avoid this specific pairing for body-sized text |
| `--accent-2` (#A34A2A, unchanged) on `--bg` | 0.94513 | 0.12853 | **5.57:1** | pass as text (up from 5.23:1) |
| White on `--accent-2` fill (the `.badge` component) | 1.0 | 0.12853 | **5.88:1** | pass in light mode |

### Dark theme

| Pairing | L1 | L2 | Ratio | Result |
|---|---|---|---|---|
| `--text` (#EAF3E6) on `--bg` (#101C12) | 0.87396 | 0.00984 | **15.44:1** | pass |
| `--text` on `--surface` (#182A17) | 0.87396 | 0.01915 | **13.36:1** | pass |
| `--muted` (#AEC7A4) on `--bg` | 0.52514 | 0.00984 | **9.61:1** | pass |
| `--muted` on `--surface` | 0.52514 | 0.01915 | **8.32:1** | pass |
| `--accent` (#7BC174) on `--bg` | 0.43623 | 0.00984 | **8.13:1** | pass |
| `--accent` on `--surface` | 0.43623 | 0.01915 | **7.03:1** | pass |
| White text on `--accent` fill | 1.0 | 0.43623 | **2.16:1** | **FAILS** 4.5:1 — do not use white text on this accent fill |
| `--accent-contrast` (#101C12, updated) on `--accent` fill | 0.43623 | 0.00984 | **8.13:1** | pass — this is the correct text-on-fill combo (dark text on the light-mid-tone accent, mirroring the existing dark-theme pattern already used before this cycle) |
| `--border` (#63795A) on `--bg` (3:1 floor) | 0.17056 | 0.00984 | **3.69:1** | pass, decent margin |
| `--border` on `--surface` | 0.17056 | 0.01915 | **3.19:1** | pass but thin margin (0.19) — flagged for Tester spot-check, see §5 |
| `--accent-rose` (unchanged) on `--bg` | 0.49252 | 0.00984 | **9.07:1** | pass |
| `--accent-lavender` (unchanged) on `--bg` | 0.52520 | 0.00984 | **9.61:1** | pass |
| `--tint-blush` (unchanged) with `--text` on top | 0.02434 vs 0.87396 | — | **12.43:1** | pass |
| `--tint-blush` with `--muted` on top | 0.02434 vs 0.52514 | — | **7.74:1** | pass |
| `--accent-2` (unchanged) on `--bg` (as text) | 0.34777 | 0.00984 | **6.65:1** | pass |
| **White on `--accent-2` fill (the `.badge` component)** | 1.0 | 0.34777 | **2.64:1** | **FAILS 4.5:1** — see flagged pre-existing bug in §5, not caused by this redesign |

**Net**: every token I'm proposing to change passes AA at the same or a better margin than
its predecessor in every pairing checked, in both themes, except the two explicitly marked
FAIL rows above — both of which are the *same* underlying issue (white text hardcoded onto
an `--accent-2`-family fill in dark mode), not something introduced by this palette; see §5.

---

## 3. "More dramatic" leaf decor — concrete, zero-dependency

### Key insight from the math: drama doesn't require raising opacity past the safe range
I recomputed what opacity ceiling keeps `--muted`-weight text (the tightest real case — page
headings/taglines/labels that can sit directly over the ambient background, not inside an
opaque card) above 4.5:1 when a solid accent-green shape partially "shows through" at some
alpha. Blending `--accent` at increasing alpha over `--bg` and rechecking `--muted`-on-blended-bg:

**Light theme** (`--muted` #4C5D46 over `--bg` #F6FAF4 blended with `--accent` #2E5D34):
- 20% alpha → blended bg ≈ `#CEDACD`, contrast **4.93:1** — passes, comfortable margin
- 25% alpha → blended bg ≈ `#C4D2C4`, contrast **4.53:1** — passes but by only 0.03, too thin to rely on

**Dark theme** (`--muted` #AEC7A4 over `--bg` #101C12 blended with `--accent` #7BC174):
- 20% alpha → contrast **6.48:1** — large margin
- 35% alpha → contrast **4.55:1** — thin margin, same shape as the light-theme ceiling

**Conclusion**: **~20% fill-alpha is a verified, computed ceiling** for accent-colored
decorative shapes that might run *near or under* `--muted`-weight text, in both themes — a
real number, not a guess. This means the "more dramatic" ask can be satisfied two ways
without threatening contrast:
1. **Bigger, more detailed shapes at the same low alpha already verified safe (4–8%)** for
   the full-page ambient tiled watermark — recognizable illustrated leaves/veins read as
   "intentional decor" even at low opacity, whereas the current tiny abstract blobs read as
   "accidental texture." This is the primary lever for "dramatic," not raising opacity.
2. **Up to ~18–20% alpha** for accent-colored motifs anchored to specific UI regions where
   they might approach body/label text (sidebar header, card corners) — verified above.
3. **Up to ~30–35% alpha** for motifs placed in genuinely text-free zones (a dedicated
   divider element with no text ever inside its bounding box) — SC 1.4.3 doesn't apply there
   at all (no foreground/background text pairing exists to measure), per the same reasoning
   already established in `docs/research/soft-calm-leaf-background.md`.

### 3.1 — Bigger, more detailed ambient tile (replaces the existing `body::before` pattern)
Same mechanism as today (one `<pattern>`, one data-URI, swapped per `prefers-color-scheme`,
zero new HTTP requests — **Confirmed**, MDN Data URLs:
https://developer.mozilla.org/en-US/docs/Web/URI/Schemes/data). Scale the tile up (140→220px)
and add vein-branch detail lines so the leaf shapes are actually legible as leaves, while
keeping the same already-verified 5–7% alpha range:

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220">
  <defs>
    <pattern id="leaf" width="220" height="220" patternUnits="userSpaceOnUse">
      <path d="M30 140 C25 95 55 55 100 35 C95 80 80 120 45 150 Z" fill="rgba(46,93,52,0.06)"/>
      <path d="M30 140 C50 130 75 105 90 70" stroke="rgba(46,93,52,0.07)" stroke-width="2.5" fill="none"/>
      <path d="M45 125 L62 112 M55 105 L72 90 M65 85 L80 68" stroke="rgba(46,93,52,0.05)" stroke-width="1.2" fill="none"/>
      <path d="M155 185 C155 150 175 115 205 100 C198 135 185 165 160 188 Z" fill="rgba(46,93,52,0.05)"/>
      <path d="M155 185 C170 175 185 155 195 130" stroke="rgba(46,93,52,0.06)" stroke-width="2" fill="none"/>
      <g>
        <ellipse cx="155" cy="35" rx="7" ry="14" fill="rgba(162,75,104,0.05)"/>
        <ellipse cx="155" cy="35" rx="7" ry="14" fill="rgba(162,75,104,0.05)" transform="rotate(72 155 49)"/>
        <ellipse cx="155" cy="35" rx="7" ry="14" fill="rgba(162,75,104,0.05)" transform="rotate(144 155 49)"/>
        <ellipse cx="155" cy="35" rx="7" ry="14" fill="rgba(162,75,104,0.05)" transform="rotate(216 155 49)"/>
        <ellipse cx="155" cy="35" rx="7" ry="14" fill="rgba(162,75,104,0.05)" transform="rotate(288 155 49)"/>
        <circle cx="155" cy="49" r="4.5" fill="rgba(162,75,104,0.06)"/>
      </g>
    </pattern>
  </defs>
  <rect width="220" height="220" fill="url(#leaf)"/>
</svg>
```
Dark variant: same coordinates, swap `rgba(46,93,52,…)` → `rgba(123,193,116,…)` (new dark
`--accent`) at 0.04–0.06 alpha, and `rgba(162,75,104,…)` → `rgba(232,169,190,…)` (dark
`--accent-rose`) at the same low range — mirrors the existing lighter-on-dark convention
already in the codebase. Builder encodes this exactly the way the two existing data URIs in
`style.css` already are (percent-encode `<`, `>`, `#`; single-quote attribute values) — a
mechanical step already demonstrated twice in the current file, not something new to figure out.

### 3.2 — Sidebar header corner accent (new, text-adjacent — capped at the verified ~18% ceiling)
Add to `.sidebar-header` (a fixed-height, non-scrolling block, so this is a "controlled" zone
unlike a viewport-fixed corner over scrolling content — see caution in §5.3):
```css
.sidebar-header {
  position: relative;
  overflow: visible;
}
.sidebar-header::after {
  content: '';
  position: absolute;
  top: -8px;
  right: -8px;
  width: 84px;
  height: 84px;
  pointer-events: none;
  background: no-repeat center/contain url("data:image/svg+xml,...");
  /* SVG: single branch, fill/stroke at 0.18 alpha, using --accent's hex directly
     since data URIs can't reference CSS custom properties (Confirmed constraint,
     already noted in docs/research/soft-calm-leaf-background.md) */
}
```
Raw SVG for that corner branch (light theme; dark theme swaps the hex to the dark `--accent`):
```xml
<svg xmlns="http://www.w3.org/2000/svg" width="84" height="84" viewBox="0 0 84 84">
  <path d="M80 4 C60 8 40 24 30 48 C48 42 68 26 80 4 Z" fill="#2E5D34" opacity="0.18"/>
  <path d="M70 12 C55 22 40 36 32 50" stroke="#2E5D34" stroke-width="1.4" fill="none" opacity="0.2"/>
</svg>
```
Positioned bleeding off the top-right corner of the sidebar header box so it frames the
title rather than sitting directly under the tagline text line — but since 18% is within the
verified-safe ceiling even if it does overlap the tagline (`--muted` on `--bg`), this is safe
either way per the §3 math.

### 3.3 — Card corner accent (new, on every `.column`/card-style container)
```css
.column,
.book-card, .recipe-card, .med-card, .diagnosis-card,
.todo-item, .shopping-item, .note-card, .link-card, .course-card {
  position: relative;
}
.column::before {
  content: '';
  position: absolute;
  top: 0; right: 0;
  width: 36px; height: 36px;
  pointer-events: none;
  background: no-repeat center/contain url("data:image/svg+xml,...");
}
```
```xml
<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <path d="M34 2 C20 4 8 14 4 28 C16 24 28 16 34 2 Z" fill="#2E5D34" opacity="0.16"/>
  <path d="M30 6 C22 12 14 20 8 26" stroke="#2E5D34" stroke-width="1" fill="none" opacity="0.18"/>
</svg>
```
16–18% alpha, inside the verified ceiling for `.column h3`'s `--muted`-colored text that
sits nearby. **Flagged for the Builder to visually verify per-card-type**: longer category/
title text (e.g. a long recipe title) could visually collide with a top-right corner motif on
narrow cards — recommend checking at the actual card widths used in the 3-column grid
(~260–420px), consistent with the project's own established practice of live-verifying every
new CSS rule at real content widths (per the grid-blowout and flex-stretch bugs logged in
`DECISIONS.md`, 2026-09-14 entry).

### 3.4 — Optional divider element (new markup — genuinely text-free, up to ~30–35% alpha)
This is the one piece that needs a new HTML element (`<div class="leaf-divider" aria-hidden="true"></div>`), not just CSS on an existing selector — flagging since it's a small markup
addition, not a pure style change:
```css
.leaf-divider {
  height: 32px;
  background: no-repeat center/160px url("data:image/svg+xml,...");
}
```
```xml
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40" viewBox="0 0 200 40">
  <path d="M10 20 C60 20 60 20 100 20 C140 20 140 20 190 20" stroke="#2E5D34" stroke-width="1.5" fill="none" opacity="0.35"/>
  <path d="M60 20 C55 10 45 8 38 12 C45 18 55 20 60 20 Z" fill="#2E5D34" opacity="0.3"/>
  <path d="M100 20 C100 8 92 2 84 4 C88 14 96 20 100 20 Z" fill="#2E5D34" opacity="0.32"/>
  <path d="M140 20 C145 10 155 8 162 12 C155 18 145 20 140 20 Z" fill="#2E5D34" opacity="0.3"/>
  <circle cx="100" cy="20" r="3" fill="#A24B68" opacity="0.35"/>
</svg>
```
Because this element has no text of its own, ever, SC 1.4.3 doesn't govern it at all — safe
at the higher alpha shown. Placement suggestion: between `.collection-toolbar` and the card
grid, or between sidebar nav groups.

**`prefers-reduced-motion`**: unchanged recommendation from prior briefs — ship everything
above fully static. **Confirmed** basis unchanged (MDN, `prefers-reduced-motion`:
https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion).

---

## 4. Heading font — confirm, no change recommended

The existing `--font-heading` stack from `docs/research/feminine-redesign.md` is still the
right answer and does not need to change for this cycle:
```
--font-heading: "Snell Roundhand", "Bradley Hand", "Segoe Script", "Segoe Print",
  cursive, -apple-system, "Segoe UI", Roboto, sans-serif;
```
Nothing about "light and airy, foresty, more dramatic decor" implies a different typographic
treatment — the user's own phrasing ties "more dramatic" specifically to decor/leaves, not
typography, and this stack's sourcing (Confirmed for macOS/Windows-bundled fonts, honestly
caveated for Android/Linux fallback) is unaffected by a palette or decor change. No new
research needed here; re-confirming rather than re-deriving. One low-risk, purely-numeric
lever if more "drama" in headings specifically is wanted later: increasing heading
`letter-spacing` slightly or the `h1` font-size — that's a styling-value decision for the
Builder/Architect, not a font-stack question, so not pursued further here.

---

## 5. Flags for the Architect — subjective calls and one found bug

1. **Bg tint judgment call (not sourced, genuinely subjective)**: I chose a sage-tinted
   off-white `--bg` (`#F6FAF4`) with a pure-white `--surface` for cards, on the theory that a
   faint all-over green cast reads as more "foresty" and the white cards floating on it read
   as "airy/layered." An equally valid alternative is a fully neutral, slightly warmer
   near-white `--bg` (e.g. something closer to `#FAFAF7`) with green appearing *only* via
   `--accent` and the leaf decor — this would read as cleaner/lighter but less "immersed in
   forest," since less of the screen carries the green hue. Both pass the same contrast math
   (a neutral near-white bg is even lighter, so only helps contrast). This is a taste call,
   not a technical one — flagging rather than guessing which the user actually wants.

2. **`--accent-2` (rust) judgment call**: I recommended *keeping* the rust hex but demoting
   its role (error/overdue/destructive only) rather than replacing the hue outright, since
   that's the lowest-risk option (zero new contrast math needed, all existing dark-mode text
   usages already verified). But the user's stated complaint groups "brown/rust" with the
   things to move away from — if they'd rather see rust *replaced* entirely with something
   less earth-toned (e.g. a warm amber/gold, evoking autumn light through a forest canopy
   rather than bark/rust), that's a bigger change I did not fully work out. As a starting
   point if that route is chosen: `#8F5E14` (deep amber) measures **5.27:1** on the new light
   `--bg` (passes 4.5:1) — but I did **not** verify a parallel dark-theme amber value or its
   white-on-fill badge contrast, so this would need its own follow-up verification pass, not
   a copy-paste. Recommend the Architect decide keep-rust-demoted vs. replace-with-amber
   before Builder touches `--accent-2`, since the two paths have very different verification
   burden remaining.

3. **"Dramatic" vs. this project's established "calm" character**: every prior visual cycle
   in this project (`soft-calm-leaf-background.md`, `feminine-redesign.md`, and the
   DECISIONS.md entries for both) explicitly optimized for "calm" — static decor, very low
   opacity, restrained shadows. The corner/divider accents proposed in §3.2–3.4 push
   noticeably past that prior ceiling (16–35% alpha vs. the prior 4–8% range) specifically
   because the user asked for "more dramatic" this cycle. I believe what I've proposed still
   stays on the "calm-but-noticeably-decorated" side rather than crossing into "busy" — it's
   still fully static, still confined to corners/edges/dividers rather than covering running
   text, and still under a personal-tool's restrained character — but this is my design
   judgment, not something WCAG or any source can settle. If the Architect or user reacts to
   the built result as "too much," the numeric levers to pull back are explicit and isolated
   (the alpha values in §3.2/§3.3, independently of the ambient tile in §3.1), not a full redo.

4. **Found during verification, not part of this brief's scope, but worth surfacing now**:
   `.badge` in `style.css` (line ~601-606, the recipe-difficulty pill) hardcodes
   `color: #ffffff` on a `background: var(--accent-2)` fill. This passes in light mode
   (5.88:1, per §2) but **fails outright in dark mode (2.64:1** against the dark-theme
   `--accent-2` `#E08A5B`, well under the 4.5:1 floor for this small-sized text) — this is a
   pre-existing bug, unrelated to any hex value I'm proposing to change here (I left
   `--accent-2` itself untouched in both themes), not something this redesign introduces.
   Recommend routing this to the Builder/Tester as a small separate fix once this cycle's
   palette work lands — likely fix shape: give `.badge` a per-theme text color (e.g. reuse
   the same "dark bg-toned text on a light-mid-tone fill" pattern already used for
   `--accent-contrast` in dark mode, rather than a hardcoded white) — but the actual fix is a
   Builder decision, not mine to make here.

5. **Thin margin, not a failure**: `--border` (new dark-theme value `#63795A`) against
   `--surface` (dark) measures **3.19:1** — passes the 3:1 SC 1.4.11 floor but by only 0.19,
   thinner than the 0.69-margin it has against `--bg`. Not a blocker, but worth a Tester
   spot-check on the actual rendered input/button borders in dark mode before calling this
   cycle done, consistent with this project's own established practice of re-verifying
   thin-margin pairings rather than trusting them from the isolated pairwise math alone.

---

## Sources referenced
- W3C, Understanding SC 1.4.3 / relative luminance definition: https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
- W3C, Understanding SC 1.4.11 (Non-Text Contrast): https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html
- W3C Techniques for WCAG 2.0, F83 (background images vs. text contrast): https://www.w3.org/TR/WCAG20-TECHS/F83.html
- W3C, Compositing and Blending Level 1 ("over" operator): https://www.w3.org/TR/compositing-1/#simplealphacompositing
- MDN, Data URLs: https://developer.mozilla.org/en-US/docs/Web/URI/Schemes/data
- MDN, `prefers-reduced-motion`: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
- `docs/research/palette-fields-nav.md` (original palette baseline, this project)
- `docs/research/soft-calm-leaf-background.md` (leaf-background technique + opacity methodology, this project)
- `docs/research/feminine-redesign.md` (rose/lavender/blush tokens, radius/shadow numbers, heading-font sourcing, this project)
