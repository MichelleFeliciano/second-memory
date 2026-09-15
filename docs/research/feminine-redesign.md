# Research Brief — Pushing the Visual Design "More Feminine"

Produced by the `researcher` subagent (2026-09-15). Extends, and does not replace,
`docs/research/palette-fields-nav.md` (original palette + contrast baseline) and
`docs/research/soft-calm-leaf-background.md` (leaf background technique, prior
radius/shadow/spacing pass). Baseline checked against the actual implemented
`style.css` at repo root, not just the prior docs' recommendations. All hex math
below was computed directly from the WCAG 2.1 relative-luminance formula
(`(L1+0.05)/(L2+0.05)`, sRGB→linear per-channel), the same formula both prior briefs
used — treat the arithmetic as **Confirmed application of a Confirmed formula**, cited
once here rather than re-tagging every number: W3C, Understanding SC 1.4.3 /
relative luminance definition, https://www.w3.org/TR/WCAG21/#dfn-relative-luminance .

## Question asked
Four combined directions for a "more feminine" pass: (1) rounder/more delicate shapes
beyond the prior soft-calm pass, (2) floral accents added alongside the existing leaf
background, (3) an additive blush/rose/lavender accent layer on top of the existing
green/brown palette, (4) a decorative headings-only typography treatment with zero
runtime dependencies. Each below.

---

## 1. Extended palette — additive blush/rose/lavender tokens

**Existing tokens (`--bg`, `--surface`, `--text`, `--muted`, `--accent`, `--accent-2`,
`--border`) are unchanged.** Everything below is new, additional tokens layered
alongside them — greens/browns stay dominant; these are secondary accents only.

### Proposed new tokens

| Token | Light hex | Dark hex | Suggested role |
|---|---|---|---|
| `--accent-rose` | `#A24B68` (dusty rose/mauve) | `#E8A9BE` (light pink) | secondary accent for icons/links/small text, alternative badge fill |
| `--accent-lavender` | `#6B5B95` (soft plum-lavender) | `#C9B8E8` (light lavender) | focus-ring alternative, secondary buttons, tag/label accent |
| `--tint-blush` | `#F6E4E9` (pale blush wash) | `#3A2530` (deep rose-brown wash) | background wash for a badge/card surface — **not** for badge text color on top of itself, see caution below |

### Contrast — shown, not eyeballed (thresholds: 4.5:1 normal text, 3:1 large
text/UI components, per SC 1.4.3 / SC 1.4.11, same as the original palette doc)

**Light theme**
- `--accent-rose` `#A24B68` on `--bg` `#F6F1E7`: L=0.1371 vs L=0.8827 → **4.99:1** (passes 4.5:1, usable as normal text/links, comparable weight to `--accent-2` terracotta's 5.23:1)
- `--accent-rose` on `--surface` `#FBF8F2`: **5.29:1** (passes)
- White (`#fff`) text on `--accent-rose` fill: **5.61:1** (passes — safe as a solid badge/button fill with white text, same pattern as `--accent`/`--accent-2`)
- `--accent-lavender` `#6B5B95` on `--bg`: **5.25:1** (passes normal text)
- `--accent-lavender` on `--surface`: **5.57:1** (passes)
- White text on `--accent-lavender` fill: **5.91:1** (passes)
- `--tint-blush` `#F6E4E9` as a background wash, `--text` `#3B2A1E` on top: **11.20:1** (passes with huge margin — barely different from `--text` on plain `--bg`'s 12.15:1)
- `--tint-blush` with `--muted` `#5C4B3A` on top: **6.82:1** (passes)
- **Caution — marginal pairing, flag explicitly**: `--accent-rose` text directly on `--tint-blush` background: **4.60:1** — technically clears 4.5:1 but by only 0.10, with no safety margin for anti-aliasing/font-rendering variance. **Do not use this specific pairing for body-sized text**; it is fine for large text/icons (≥3:1 floor, cleared comfortably) but should not be the default "rose text on blush chip" combo. Prefer white-on-`--accent-rose`-fill or rose-on-plain-`--bg`/`--surface` instead. (`--accent-lavender` on `--tint-blush` is slightly safer at **4.84:1**, still recommend the same caution rather than relying on the small margin.)

**Dark theme**
- `--accent-rose` `#E8A9BE` on `--bg` `#221913`: **8.92:1**
- `--accent-rose` on `--surface` `#2E241C`: **7.84:1**
- `--accent-lavender` `#C9B8E8` on `--bg`: **9.46:1**
- `--accent-lavender` on `--surface`: **8.31:1**
- `--tint-blush` `#3A2530`, `--text` `#EFE6D8` on top: **11.43:1**
- `--tint-blush`, `--muted` `#C9BBA5` on top: **7.49:1**
- Dark-theme rose-on-blush pairing (`#E8A9BE` on `#3A2530`) is **not** marginal like the light-theme case: **7.30:1** (comfortable, no caution needed here)

**Net**: all six new tokens individually clear 4.5:1 against both existing background
tokens in both themes, so they're safe to use as text/icon/link/fill colors, not just
decoration. The one thing to avoid is stacking a new accent's *text* directly on the
new blush *background* in light mode for small text — that combination is the one
pairing that's genuinely tight.

---

## 2. Rounder, more delicate shapes — concrete numbers beyond the prior pass

The prior soft-calm brief recommended 12–16px cards / 8–10px controls as a range;
`style.css` as actually implemented landed at the low end (12–14px cards, 6–9px
controls). This pass pushes further:

| Element | Current (`style.css`) | Prior brief's ceiling | New recommendation |
|---|---|---|---|
| Large cards/panels (`.column`, `.add-form`, `.book-card` and siblings) | 12–14px | 16px | **18–20px** |
| Buttons & inputs | 6–9px | 8–10px | **12–14px** |
| Small pills (`.badge`, `.count`) | already `999px` (pill) | — | unchanged — already at the maximum "delicate" endpoint |
| Small secondary buttons (`.delete-btn`, `.edit-btn`, `.cancel-btn`) | 8px | — | **12–14px**, matching the main button treatment |

**Where "delicate" turns into "children's app" — design judgment, Likely, not a
sourced rule**: the tipping point is not radius in isolation, it's radius *relative to
component size*, combined with saturation and shadow weight. Material Design 3's own
shape scale (a real precedent, not this brief's invention) defines Small=8, Medium=12,
Large=16, Extra-large=28, Full=stadium/pill as its named corner tokens
(https://m3.material.io/styles/shape/shape-scale-tokens). The recommendation above
(18–20px on cards) sits deliberately between M3's own Large (16) and Extra-large (28)
tiers — a real push past the prior pass without reaching M3's Extra-large tier, which
M3 itself reserves for large sheets/dialogs, not small repeating list cards. **Do not
exceed ~20–22px on the repeating list cards used in this layout** (`.book-card`,
`.med-card`, etc., which run roughly 260–420px wide in the 3-column grid): past that,
the corner curvature becomes visually dominant relative to the card's straight edges
and reads as a rounded "bubble/app-icon" shape rather than a refined soft edge. This
is a judgment call (**Likely**, informed by M3's own scale, not a hard limit M3 itself
states) — the "childish" read tends to come from *radius + saturated fill + heavy
shadow together*, not radius alone, so keeping saturation and shadow restrained (see
below) matters as much as the radius number itself.

**Border weight/lightness**: do not lighten borders across the board — two tiers:
- **Functional borders (inputs, buttons-as-outline, focus rings) stay at the existing
  `--border` token, unchanged.** Light theme `--border` is already at **3.93:1**
  against `--bg` — right at the SC 1.4.11 3:1 floor with very little margin (0.93).
  Dark theme's reused `--border` sits at **3.90:1** against the dark `--bg` — also
  thin margin. Neither has room to lighten further without risking a real 1.4.11
  failure on interactive elements. **Confirmed** exemption logic doesn't rescue this
  either: W3C's own Understanding SC 1.4.11 says a control's hit-area boundary is
  exempt from the 3:1 requirement *only* if the control is otherwise identifiable
  (visible text/icon, or a differing fill) — quote: "If a control has visible content
  ... a border or other indication of the overall boundary ... is not required ...
  Having a visual boundary ... is only required when there is no other visual way to
  identify the presence of the control." This app's inputs do have a differing fill
  (`--bg` inside a `--surface` container) so the exemption plausibly *could* apply —
  but recommend not relying on that nuance for interactive controls; keep them at the
  already-verified 3.93:1/3.90:1 `--border` value as the safe, already-settled choice.
  (W3C, Understanding SC 1.4.11: https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html)
- **Decorative-only container borders** (`.column`, `.book-card`/`.recipe-card`/etc.
  as *static, non-interactive* containers — not controls, so 1.4.11 doesn't govern
  them at all in the first place) can safely go lighter for a "more delicate" read.
  Introduce a second token, `--border-soft`, for this use only: light theme
  `#C9B9A0` (measures **1.71:1** against `--bg` — well under 3:1, which is fine
  precisely *because* it's not a UI-component boundary subject to that SC).
  Do not reuse `--border-soft` on anything interactive.

**Shadow softness — push further than the prior pass's `0 2px 8px rgba(0,0,0,0.05)`
rest / `0 4px 14px rgba(0,0,0,0.08)` hover**: increase blur radius and lower opacity
together (softer = more diffuse, not just fainter). Recommend:
- Rest: `0 3px 10px rgba(0,0,0,0.035)`
- Hover/raised: `0 6px 20px rgba(0,0,0,0.055)`

This is **Likely**, same basis as the prior brief (Material Design's elevation model,
scaled down for this app's warm-toned surfaces rather than Material's own
white-surface-calibrated 12–20% opacities:
https://m2.material.io/design/environment/elevation.html) — not a new source, just a
further downward scaling. **Practical floor, worth stating explicitly**: below
roughly 0.03 alpha, a soft box-shadow becomes close to imperceptible on typical
displays/ambient lighting, especially at these blur radii — 0.035 is close to that
floor already, so this is close to "as soft as still functions as a visible shadow,"
not an arbitrary stop. Dark theme note: shadows are inherently less useful as a depth
cue on an already-near-black background; recommend leaving dark-theme shadow values
as-is (don't chase further softening there — the starting point is already close to
invisible, so there's nothing meaningful left to soften).

---

## 3. Floral accents in the existing leaf background pattern

**Technique — add to the same `<pattern>`, don't create a second layer.** The
current `body::before` background is one SVG `<pattern id="leaf">` (140×140 tile)
containing leaf `<path>` shapes, referenced via one CSS data-URI per theme
(`style.css` lines 44–58). Add flower shapes as additional elements *inside that same
`<pattern>`* (or a renamed pattern id, purely cosmetic) — still one data URI, one
`background-image`, no new HTTP request, no new library, satisfying the same
zero-dependency mechanism already **Confirmed** in the prior brief (MDN, Data URLs:
https://developer.mozilla.org/en-US/docs/Web/URI/Schemes/data).

**Concrete shape technique**: a simple 5-petal blossom can be built from five small
`<ellipse>` elements, each rotated 72° from the last around a shared center point
(`transform="rotate(72 cx cy)"` repeated, or wrapped in nested `<g>` elements), plus
one small `<circle>` at the center for the blossom's core. This needs no gradients,
filters, or paths more complex than what's already in the pattern — same shape
complexity budget as the existing leaf curves. Position the blossom motif in empty
space on the existing 140×140 tile (the current leaf shapes cluster near
(20,90)–(70,20) and (100,60)–(135,122); a blossom centered around roughly (100,30) or
(40,30) avoids overlapping the existing leaf strokes) so leaves and flowers read as
one coherent scattered pattern rather than colliding.

**Color and opacity — reuse the same verified range, don't invent a new one.** The
prior brief established 4–8% alpha for zones that may run under body text, up to
12–15% in genuinely text-free decorative zones, baked into the SVG fill itself (not a
CSS `opacity`). Apply that identical range to the new `--accent-rose` hex for petals
(e.g. `fill="rgba(162,75,104,0.05)"` light theme) and a small warm center dot. **Do
not introduce a new opacity range for the flowers** — same principle, same numbers.

**Worked contrast check at the overlap point (the specific ask: recheck, don't
assume)**: alpha-compositing 6% `--accent-rose` (`#A24B68`) over the light-theme `--bg`
(`#F6F1E7`) using the standard "source-over" per-channel blend (this is how CSS/SVG
composite non-premultiplied sRGB colors — **Confirmed**, W3C Compositing and Blending
spec, "over" operator: https://www.w3.org/TR/compositing-1/#simplealphacompositing)
gives a blended background of approximately `#F1E7DF` (R 246→241, G 241→231, B
231→223, each channel shifted 6% toward the rose value). Recomputing `--text`
(`#3B2A1E`) contrast against that blended background: **11.23:1** — down only
marginally from the unblended 12.15:1, still nearly triple the 4.5:1 floor. This
confirms the prior brief's 4–8% range holds up numerically for the new rose/floral
color too, with a wide margin — but per the prior brief's own remediation note (WCAG
F83), this should be spot-verified by the Tester at the actual darkest overlap pixel
once implemented, not just trusted from this approximation.

**`prefers-reduced-motion`**: unchanged from the prior brief — ship the flowers fully
static, same as the leaves, for the same "calm" rationale already established.

---

## 4. Zero-dependency decorative heading font — recommendation, not an open question

**Recommend option (a), a system font stack — with a specific, concrete stack, not a
vague "use a cursive font" instruction:**

```
--font-heading: "Snell Roundhand", "Bradley Hand", "Segoe Script", "Segoe Print",
  cursive, -apple-system, "Segoe UI", Roboto, sans-serif;
```

Apply only to `h1`–`h3` (or a dedicated heading class); body text keeps its existing
unchanged stack (`-apple-system, "Segoe UI", Roboto, sans-serif`, `style.css` line 33).

### Why this ordering, with sourcing per font
- **`Snell Roundhand`** — **Confirmed** included with macOS (Sonoma and other recent
  releases list "Snell Roundhand", "Snell Roundhand Black", "Snell Roundhand Bold" in
  Apple's own fonts-included documentation). Apple Support, Fonts included with macOS
  Sonoma: https://support.apple.com/en-am/108939 . An elegant formal script — the
  best-fit "delicate," non-childish option available, placed first.
- **`Bradley Hand`** — **Confirmed** included with macOS (same Apple Support page
  lists "Bradley Hand Bold"); **Likely** (not confirmed via an official Apple iOS
  font-list page — none was found) also present on iOS, based on independent
  discussion of Apple's iPad font set. Included as a same-ecosystem fallback in case a
  future macOS/iOS release drops Snell Roundhand.
- **`Segoe Script`** / **`Segoe Print`** — **Confirmed** bundled with Windows: Microsoft's
  own Typography documentation lists Segoe Script/Segoe Print as included starting
  Windows Vista through Windows 11 (product table on the font's own page). Microsoft
  Learn, Segoe Script font family: https://learn.microsoft.com/en-us/typography/font-list/segoe-script
  . Segoe Script is a connected cursive (closer visual match to Snell Roundhand);
  Segoe Print is listed after it as a more legible, less-fancy fallback in case a
  given Windows build only ships one.
- **`cursive`** (CSS generic keyword) — **Confirmed** as a real CSS generic font
  family that a conformant browser must map to *some* decorative/handwriting-style
  font (CSS Fonts spec generic-family list includes `cursive`; MDN, `font-family`:
  https://developer.mozilla.org/en-US/docs/Web/CSS/font-family). Its actual glyph
  quality is OS/browser-dependent by design — this is a real safety net, not a
  guaranteed elegant result.
- **Plain sans-serif tail** (`-apple-system, "Segoe UI", Roboto, sans-serif`, matching
  the existing body stack) — deliberately appended as the true final fallback.
  **Likely** (search-summarized rather than pinned to one authoritative AOSP page, so
  not marked Confirmed): Android's default system fonts are Roboto/Noto — sans-serif
  and monospace families, with no bundled decorative/cursive family found. This means
  on stock Android (and similarly, on most Linux desktop configurations), neither the
  named script fonts nor a good `cursive` generic match will be present, and the
  browser falls through to this final plain-sans tail — headings on those platforms
  render as a plain, legible sans-serif heading with no decorative treatment at all,
  rather than a broken/missing-glyph ("tofu") font or an unpredictable low-quality
  cursive substitute. This is the honest trade-off, stated plainly rather than glossed
  over: **the decorative heading treatment will only actually render as intended on
  Windows and Apple platforms; Android/Linux users will see a plain sans heading,
  indistinguishable in style from the body text.**
- **Deliberately excluded**: `Comic Sans MS`, despite being a broadly available
  Windows cursive-adjacent font. Its strong informal/childish connotation directly
  works against the "not a children's-app" ceiling established in section 2 of this
  brief — excluded on purpose, not an oversight.

### Why not option (b), self-hosting a font file
Real trade-off stated as asked: option (b) would render identically on every platform
(the actual advantage), but it introduces a genuinely new *kind* of project asset — a
binary font file — into a project where every existing visual asset (leaf background,
future flowers) is inline SVG/CSS, and every other asset is JS/HTML/CSS text. Sourcing
a real SIL OFL-licensed script font correctly (finding the actual license file,
verifying the license terms permit embedding-as-a-local-asset, choosing a specific
weight/format, and vetting that the chosen file is what it claims to be) is a
nontrivial step that a Builder cannot do reliably without either fetching the file
from somewhere at build time (which the project's hard "no network calls" rule
forbids doing even as a one-time step, since there's no build step to do it during —
everything ships as committed source) or the Architect/user manually sourcing and
vetting a specific font file out-of-band and committing it themselves. Given the
system-stack option (a) is genuinely zero-effort, zero-new-asset-type, and degrades
gracefully (plain-but-legible, never broken) on the platforms where it doesn't have a
decorative font available, **recommend (a) as the final answer, not a placeholder** —
this is not being left as an open question for the Architect to resolve; the CSS
custom property stack above is ready to hand to the Builder as-is.

---

## Sources referenced
- W3C, Understanding SC 1.4.3 / relative luminance definition: https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
- W3C, Understanding SC 1.4.11 (Non-Text Contrast): https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html
- W3C, Compositing and Blending Level 1 ("over" operator): https://www.w3.org/TR/compositing-1/#simplealphacompositing
- Material Design 3, Shape scale tokens: https://m3.material.io/styles/shape/shape-scale-tokens
- Material Design 2, Elevation: https://m2.material.io/design/environment/elevation.html
- Apple Support, Fonts included with macOS Sonoma: https://support.apple.com/en-am/108939
- Microsoft Learn, Segoe Script font family (Typography): https://learn.microsoft.com/en-us/typography/font-list/segoe-script
- Microsoft Learn, Segoe Print font family (Typography): https://learn.microsoft.com/en-us/typography/font-list/segoe-print
- MDN, `font-family` (CSS generic families incl. `cursive`): https://developer.mozilla.org/en-US/docs/Web/CSS/font-family
- MDN, Data URLs: https://developer.mozilla.org/en-US/docs/Web/URI/Schemes/data
