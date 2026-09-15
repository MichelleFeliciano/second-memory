# Research Brief — Decorative Leaf Background, "Soft/Calm" UI Parameters, Sidebar Nav Scaling

Produced by the `researcher` subagent (2026-09-14). Builds on and does not replace
`docs/research/palette-fields-nav.md` — the hex values and contrast baseline there are
still load-bearing and are **not** being relaxed by anything in this brief.

## Question 1: A decorative leaf background with zero external dependencies

### How to build it with no assets/dependencies
- **Confirmed** — a CSS `background-image: url("data:image/svg+xml,...")` data URI is a
  fully inline resource; the `data:` URI scheme embeds the resource's data directly in
  the URL, so the browser never issues a network request for it. This satisfies the
  project's "no CDN, no external assets" constraint by construction, the same way an
  inline `<svg>` element in the HTML does. (MDN, "Data URLs":
  https://developer.mozilla.org/en-US/docs/Web/URI/Schemes/data)
- **Confirmed** — if you instead place actual `<svg>` markup in the page (rather than a
  CSS background), the correct accessible pattern for a purely ornamental image is
  `aria-hidden="true"` (or, for an `<img>`, `alt=""`), so assistive tech skips it
  entirely — this is the standard decorative-image markup pattern. (WAI Images
  Tutorial, "Decorative Images":
  https://www.w3.org/WAI/tutorials/images/decorative/)
- Either approach is zero-dependency. A CSS data-URI background is simpler to theme
  (swap the URI per `prefers-color-scheme`); inline `<svg>` gives more layout control if
  you want leaves to scroll with content in specific spots. Recommend the CSS
  data-URI-on-a-pseudo-element approach for a full-page ambient background (simplest,
  fewest DOM nodes) and reserve real inline `<svg>` only if you want leaves anchored to
  a specific decorative corner (e.g. sidebar header).

### The WCAG angle — precisely, not conflated
This needs two separate success criteria, and they behave differently here:

- **SC 1.4.11 Non-Text Contrast (AA)** — **Confirmed**: this SC applies to UI-component
  boundaries/states and to "parts of graphics required to understand the content,"
  and explicitly does **not** apply where "a particular presentation of graphics is
  essential to the information being conveyed" is absent — i.e. purely aesthetic
  graphics that convey no information are out of scope entirely, regardless of where
  they sit. A leaf motif that conveys zero information is categorically exempt from
  1.4.11 no matter how it's placed. (W3C, Understanding SC 1.4.11:
  https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html)
- **SC 1.4.3 Contrast (Minimum) (AA)** — **Confirmed, and this is the nuance the
  question is right to flag**: the "pure decoration" exemption in 1.4.3 is about
  *decorative text* (e.g. text you could rearrange/substitute without changing its
  purpose) — it is not a blanket exemption for decorative *background art placed behind
  real text*. WCAG's own documented failure, **F83**, is titled "Failure of Success
  Criterion 1.4.3 ... due to using background images that do not provide sufficient
  contrast with foreground text." That is exactly this scenario: real, meaningful body
  text rendered on top of a background image. If the leaf pattern is visible enough
  behind actual UI text to drag the effective foreground/background contrast below
  4.5:1 (or 3:1 for large text), that is a literal SC 1.4.3 failure, not a "soft"
  usability nice-to-have. (W3C, Understanding SC 1.4.3:
  https://www.w3.org/TR/UNDERSTANDING-WCAG20/visual-audio-contrast-contrast.html;
  W3C Techniques, F83: https://www.w3.org/TR/WCAG20-TECHS/F83.html)
- **So: "decorative" exempts the graphic from 1.4.11 entirely, but does not exempt the
  page from 1.4.3 wherever that decorative graphic happens to sit behind text.** The
  practical takeaway is not "check a box called decorative and move on" — it's "keep
  the leaf art's contribution to the visible pixel color, wherever it overlaps text,
  low enough that text-vs-background contrast still clears the same 4.5:1/3:1
  thresholds already established in the palette doc." Recommend the Tester spot-check
  contrast at the darkest leaf-vein/overlap point behind body text, not just eyeball
  it, per F83's own remediation advice.

### Concrete technique recommendations
1. **Positioning**: `position: fixed; inset: 0; z-index: -1; pointer-events: none;` on
   the decoration layer (a `body::before` pseudo-element or a dedicated empty
   `<div class="bg-leaves" aria-hidden="true">`), placed behind all real content stacks.
   `pointer-events: none` and a negative/below-content `z-index` are the standard way to
   guarantee a decorative layer never intercepts clicks, taps, or keyboard focus and
   never visually sits above interactive UI. This is basic CSS stacking-context
   behavior, not a special API — **Confirmed** as a mechanism (MDN, `z-index`:
   https://developer.mozilla.org/en-US/docs/Web/CSS/z-index; MDN, `pointer-events`:
   https://developer.mozilla.org/en-US/docs/Web/CSS/pointer-events).
2. **Opacity range — Unverified/design judgment, but testably grounded**: there is no
   WCAG-specified numeric opacity for decorative background art (WCAG regulates the
   *outcome* — contrast ratio — not the *input* — opacity). Recommend **4–8% alpha**
   (`opacity: 0.04–0.08` on the leaf layer, or bake that alpha into the SVG fill/stroke
   itself) as a starting range for a pattern that will run under body text in low-text
   areas (page margins, empty states) — low enough that recomputing contrast at the
   overlap point should still clear 4.5:1 against `--text`/`--muted` on `--bg` with
   comfortable margin, given the existing palette's contrast ratios are already well
   above minimum (12.15:1 and 7.40:1 in light mode per the prior brief). If leaves are
   confined to a genuinely text-free decorative zone (e.g. a corner motif, sidebar
   header background, or an area always covered by an opaque `--surface` card), opacity
   can go higher (up to ~12–15%) since 1.4.3 isn't in play there at all. Verify the
   final chosen opacity by recomputing contrast at the leaf/text overlap, don't just
   ship the range.
3. **`prefers-reduced-motion`**: **Confirmed** — if any motion (drift, sway, parasax)
   is added to the leaves, it must respect the user's OS-level reduced-motion
   preference; MDN and the CSS Media Queries spec define `prefers-reduced-motion` for
   exactly this class of "non-essential" decorative motion, and the standard pattern is
   to gate the animation inside `@media (prefers-reduced-motion: no-preference)` (or
   disable it inside `(prefers-reduced-motion: reduce)`). (MDN,
   `prefers-reduced-motion`:
   https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)
   Given the goal is explicitly "calm," the simplest and safest recommendation is to
   **ship the leaves fully static by default** — no animation at all — which sidesteps
   the reduced-motion question entirely and is more consistent with "calm" than any
   ambient motion would be. Only add motion later, gated as above, if there's a
   specific reason to.
4. **Theme adaptation (light vs. dark) — design judgment, not sourced**: don't reuse
   one hue/opacity across both themes. On the light theme, low-alpha moss/sage green
   line art on the parchment `--bg` (`#F6F1E7`) reads as a subtle watermark. On the
   dark theme, the same stroke color at the same alpha will look different because the
   background luminance is much lower (`#221913`) — a light stroke (e.g. the dark
   theme's own `--accent` sage `#9CBB8C`) becomes *more* visually prominent at equal
   alpha against a dark background than a dark stroke does against a light one, simply
   because the luminance delta is larger. Recommend an equal-or-lower opacity on dark
   (e.g. 4–6%) than on light (6–10%) to keep perceived subtlety comparable, and pick the
   stroke color per-theme from tokens already in `style.css` (`--accent`/`--muted`)
   rather than introducing new hex values, so the leaf motif automatically stays
   in-palette and in-hue with whichever theme is active. Implement via two data-URI
   variants swapped inside the existing `@media (prefers-color-scheme: dark)` block (or
   inline the color as a CSS custom property inside the SVG via `fill="currentColor"`
   trick isn't available in a static data URI — practically, generate two encoded SVG
   strings, one per theme, since data URIs can't reference CSS variables).

## Question 2: "Soft and calm" as concrete, checkable parameters

Carrying forward, unchanged: **all WCAG contrast minimums from the prior palette brief
stay exactly as specified** (4.5:1 body text, 3:1 large text/UI boundaries). Nothing
below trades contrast for softness — it only touches radius, shadow, spacing, and where
saturated color is allowed to appear.

| Attribute | Current baseline (style.css) | Recommended "soft/calm" range | Basis |
|---|---|---|---|
| Card/surface border-radius | 8–10px (`.column`, `.add-form`, `.book-card` etc.) | 12–16px | Design judgment, informed by Material Design 3's shape scale, which defines Small=8, Medium=12, Large=16 corner tokens as a real design-system precedent for "larger radius reads softer" (**Likely**, credible design-system source, not a universal law). M3 Shape: https://m3.material.io/styles/shape/shape-scale-tokens |
| Control border-radius (buttons/inputs) | 6px | 8–10px | Same source/rationale, kept smaller than card radius for visual hierarchy — design judgment |
| Box-shadow (currently: none — flat borders only) | none | e.g. `0 2px 8px rgba(0,0,0,0.05)` at rest, `0 4px 14px rgba(0,0,0,0.08)` on hover/raised — low blur-to-opacity ratio, no spread, no hard offset | **Likely**, informed by Material Design's elevation model (paired umbra/penumbra/ambient shadows at 20%/14%/12% opacity: https://m2.material.io/design/environment/elevation.html) but *scaled down* from Material's own values by design judgment — Material's opacities are calibrated for shadows on pure-white surfaces; against this app's warm parchment/dark-brown palette, 12–20% alpha shadows would read as heavy/muddy rather than soft, so recommend roughly a quarter of Material's opacity (4–8%) as the calmer target. This scaling-down step is not sourced — flag as judgment. |
| Line-height (body text) | not set (browser default ≈1.2) | **≥1.5** | **Confirmed** — this isn't just aesthetic judgment: WCAG SC 1.4.12 Text Spacing (AA) requires content to remain usable when a user applies line-height ≥1.5×font-size, paragraph spacing ≥2×font-size, letter-spacing ≥0.12×font-size, and word-spacing ≥0.16×font-size overrides. Setting the *default* line-height at 1.5+ isn't required by 1.4.12 itself (1.4.12 only requires tolerating a user override), but shipping generous line-height by default is a low-risk way to already look and behave like content designed for that spacing floor. (W3C, Understanding SC 1.4.12: https://www.w3.org/WAI/WCAG21/Understanding/text-spacing.html) |
| Spacing (padding/gaps) | 8–16px in most components (e.g. `.column` padding 12px, `.card-list` gap 8px) | 16–24px | Design judgment, loosely anchored to an 8px baseline grid (a common, but not WCAG-mandated, convention referenced in Material Design's spacing tokens: https://m3.material.io/foundations/layout/understanding-layout/spacing) — label **Likely** as "a defensible convention," not a hard rule |
| Saturation on large surfaces | `--bg`/`--surface` are already desaturated parchment/near-black neutrals; `--accent`/`--accent-2` are reserved for buttons/active-state/links, never large fills | Keep as-is; do **not** apply `--accent`/`--accent-2` as a large background wash. If a tinted hover/active background is wanted (e.g. sidebar nav-item hover currently swaps to `--bg`), prefer a low-alpha tint of `--accent` (e.g. `color-mix(in srgb, var(--accent) 10%, var(--surface))` or an rgba equivalent) over a saturated fill, and re-verify the *text* rendered on top still meets 4.5:1 against that tinted background — this is a real, checkable requirement carried over from the existing palette doc, not new judgment | Design judgment for the technique; the contrast requirement itself is **Confirmed** (WCAG SC 1.4.3, same as prior brief) |

**Do not relax, regardless of "soft/calm" styling changes**: text contrast (4.5:1/3:1
per SC 1.4.3), non-text/UI-component contrast for real interactive elements and focus
indicators (3:1 per SC 1.4.11) — these apply to buttons, inputs, focus rings, and nav
active-states exactly as specified in `docs/research/palette-fields-nav.md`. Softness
here is a surface-level treatment (radius, shadow, spacing, saturation of *decorative*
surfaces) layered on top of an unchanged, already-verified contrast baseline.

## Sidebar nav at 9 items — brief note for the Analyst

- **Confirmed**: NN/g's own menu-design guidance (nngroup.com/articles/menu-design/)
  does not state a numeric item-count threshold for when a flat list should be split
  into grouped/categorized sections. Its advice is structural/qualitative (avoid deep
  cascading submenus, use mega-menus/landing pages for genuinely large hierarchies), not
  "group once you pass N items."
- **Confirmed, and worth flagging precisely because it's commonly misused**: Miller's
  1956 "The Magical Number Seven, Plus or Minus Two" is about the capacity of
  *immediate/working memory* for recalling or discriminating sequentially-presented
  stimuli — it says nothing about menus, and nothing about how many persistently
  visible, scannable items a user can handle. A sidebar nav is a **recognition** task
  (the labels stay on screen; the user scans and picks one), not a **recall** task
  (nothing has to be held in memory), which is the specific reason multiple UX
  commentators call the "7±2 items in a menu" rule a misapplication of Miller's actual
  finding. (Primary source: Miller, G.A. (1956), summarized at
  https://en.wikipedia.org/wiki/The_Magical_Number_Seven,_Plus_or_Minus_Two; the
  misapplication-to-navigation critique itself is well-argued but from secondary/blog
  commentary, not a peer-reviewed HCI source, so treat the *critique* as **Likely**
  rather than **Confirmed**, even though the "recall vs. recognition" distinction it
  rests on is a well-established cognitive-psychology concept.)
- **Net recommendation for the Analyst (design judgment, not mine to finalize)**: 9
  flat sidebar items is very likely fine from a pure "can the user find it by scanning"
  standpoint — don't group items just to satisfy a 7±2 rule, since that rule doesn't
  actually govern this kind of visible, static list. If grouping is still desired, base
  it on genuine semantic categories that make the sidebar easier to *scan and predict*
  (e.g. clustering Books/Recipes, Medications/Diagnoses, To-Do/Shopping List/Notes,
  Resume/Coursework under labeled sub-headings), not on an item-count trigger — that's
  a findability/information-architecture call for the Analyst, not something either
  NN/g's guidance or Miller's Law actually mandates at a specific number.

## Sources referenced
- MDN, Data URLs: https://developer.mozilla.org/en-US/docs/Web/URI/Schemes/data
- WAI Tutorials, Decorative Images: https://www.w3.org/WAI/tutorials/images/decorative/
- W3C, Understanding SC 1.4.3 (Contrast Minimum): https://www.w3.org/TR/UNDERSTANDING-WCAG20/visual-audio-contrast-contrast.html
- W3C Techniques for WCAG 2.0, F83: https://www.w3.org/TR/WCAG20-TECHS/F83.html
- W3C, Understanding SC 1.4.11 (Non-Text Contrast): https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html
- W3C, Understanding SC 1.4.12 (Text Spacing): https://www.w3.org/WAI/WCAG21/Understanding/text-spacing.html
- MDN, `prefers-reduced-motion`: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
- MDN, `z-index` / `pointer-events`: https://developer.mozilla.org/en-US/docs/Web/CSS/z-index , https://developer.mozilla.org/en-US/docs/Web/CSS/pointer-events
- Material Design 3, Shape scale tokens: https://m3.material.io/styles/shape/shape-scale-tokens
- Material Design 2, Elevation: https://m2.material.io/design/environment/elevation.html
- Material Design 3, Spacing: https://m3.material.io/foundations/layout/understanding-layout/spacing
- NN/g, Menu-Design Checklist: https://www.nngroup.com/articles/menu-design/
- Wikipedia summary of Miller (1956), "The Magical Number Seven, Plus or Minus Two": https://en.wikipedia.org/wiki/The_Magical_Number_Seven,_Plus_or_Minus_Two
