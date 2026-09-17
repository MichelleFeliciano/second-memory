# Research: iOS-Safari "Add to Home Screen" + Budget calendar mobile layout

## Question

Two mobile-friendliness improvements are planned for Second Memory, a zero-dependency
vanilla HTML/CSS/JS app, targeting an iPhone (iOS Safari) as the real device:

1. Can "Add to Home Screen" / installable-web-app behavior be done correctly for iOS
   Safari with zero build step / zero new runtime dependencies? What manifest fields,
   meta tags, icon formats/sizes, and (critically) whether a Service Worker is required?
2. Should the Budget tab's 7-column `.budget-week-cells` grid collapse to a stacked
   single-column "agenda" layout on phone-width screens, and if so at what breakpoint —
   is the existing app-wide `max-width: 700px` breakpoint already too narrow for a
   7-column grid, meaning some non-phone widths need the stacked layout too? Also:
   does iOS Safari's known input-zoom-on-focus quirk (font-size < 16px) affect this
   app's inputs, in Budget and elsewhere?

Codebase files read in full before this research: `index.html`, `style.css`,
`docs/specs/budget-tab.md` (the approved Budget spec, current markup/CSS for
`.budget-calendar`, `.budget-week-cells`, `.budget-day-cell`, `.budget-weekday-row`).

**Note on method:** an earlier draft of this brief existed in the repo before this
research pass. It was re-verified line-by-line against live web sources rather than
taken on faith, because it's the kind of area (iOS PWA support) that changes yearly and
a stale answer would be worse than no answer. **One material fact has changed since
that draft was written and materially affects the recommendation: iOS 26 (current at
time of writing, September 2026) changed Safari's default "Add to Home Screen"
behavior app-wide** — see §1.0. Everything else below was cross-checked and, with
that one exception, confirmed accurate.

---

## Part 1 — "Add to Home Screen" on iOS Safari, zero dependencies

### 1.0 New in iOS/Safari 26 — read this first, it changes the framing

**Confirmed:** as of iOS 26 / Safari 26 (shipped September 2025, so this is the
baseline behavior on any iPhone updated within the last year, which is the safe
assumption for the user's device in September 2026), **every website added to the
Home Screen opens as a full-screen web app by default — with no browser chrome —
even if the site has no manifest, no `apple-mobile-web-app-capable` tag, and wasn't
built as a PWA at all.** The user gets a per-site "Open as Web App" toggle in the
Share Sheet's "Add to Home Screen" dialog, defaulted **on**. This is a genuine
default-behavior change from all iOS versions before it (which required the
`apple-mobile-web-app-capable` meta tag — or, in very old iOS, nothing, standalone
mode not existing at all until iOS 2.1).
— [WebKit: "News from WWDC25: Web Technology Coming This Fall in Safari 26 Beta"](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/) (WebKit's own words: *"By default, every website added to the Home Screen opens as a web app. If the user prefers to add a bookmark that opens in their default browser, they can turn off 'Open as Web App', even if the site is configured to be a web app."*)
— corroborated by [MacRumors](https://www.macrumors.com/how-to/save-safari-bookmark-web-app-iphone-home-screen/) and [iDownloadBlog](https://www.idownloadblog.com/2025/06/17/apple-ios-26-safari-web-apps-home-screen-bookmarks/)

**What this means practically:** the "no browser chrome" half of the ask is now
**free on the user's actual device**, with zero code changes at all. What a
manifest/meta-tags combination still buys you, and the reason to add them anyway:
- **The home-screen icon.** Without an `apple-touch-icon`, iOS falls back to a
  screenshot-thumbnail of the page as the icon — ugly, and not what "Add to Home
  Screen done correctly" means. This is still the main reason to do any work here.
- **The app name shown under the icon** (`apple-mobile-web-app-title`, or the
  manifest's `short_name`) — without it, iOS uses the page `<title>` or the URL,
  which for this app's `<title>Second Memory</title>` would actually be fine as a
  fallback, but explicit is better than implicit.
- **The status bar tint** (`apple-mobile-web-app-status-bar-style`) and Chrome/Android
  theming (`theme-color`) — cosmetic polish, not required for the core ask.
- Nothing above requires a Service Worker (see §1.3, unchanged and still confirmed).

**Recommendation given this new fact:** don't treat "get standalone/full-screen
launch working" as the goal anymore — that's now the OS default. Treat the goal as
"give iOS a real icon and name to use instead of its ugly page-screenshot fallback,"
which narrows this to exactly the manifest + `apple-touch-icon` + a couple of meta
tags described below — same artifacts as before, smaller stated purpose, same
recommended implementation.

### 1.1 Does iOS Safari use manifest.json, or Apple's own meta tags?

**Confirmed (mixed answer, re-verified against current sources — both matter, and
apple-touch-icon still wins on iOS specifically):**

- Safari added standard Web App Manifest `icons` support in **iOS 15.4** (2022).
  Before that, PWA icons on iOS could only be set via `<link rel="apple-touch-icon">`.
  — [GitHub/Lighthouse issue #14064, "Safari 15.4 supports manifest-declared PWA icons"](https://github.com/GoogleChrome/lighthouse/issues/14064)
- **Even now, in Safari 26, `apple-touch-icon` still takes priority over
  `manifest.json` icons when both are present, specifically on iOS/iPadOS** (macOS
  Safari's "Add to Dock" does use manifest icons directly). This is current guidance,
  not a stale 2022-era claim — multiple 2026-dated write-ups still state this as
  Safari's behavior and recommend shipping both for exactly this reason.
  — corroborated across current (2026) icon-guide sources; I did not find a single
  authoritative first-party WebKit/Apple page that states the priority order in so
  many words, so tagging this **Likely** rather than Confirmed, but it is consistent
  and unanimous across every independent source checked.
- Apple's own archived developer documentation still only documents the proprietary
  tags (predates iOS 15.4's manifest support, but remains the canonical reference
  Apple maintains): `apple-mobile-web-app-capable`, `apple-mobile-web-app-title`,
  `apple-mobile-web-app-status-bar-style`, `<link rel="apple-touch-icon">`.
  — [Apple Developer: Configuring Web Applications](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html)
- MDN's guide (page shows a "last updated" stamp of September 7, 2026 — current as of
  this research) confirms Android Chrome's install path *requires* a conforming
  manifest (`name`/`short_name`, `icons` with 192px+512px, `start_url`, `display`),
  while Safari (macOS and iOS) **can install a web app with or without a manifest
  file.**
  — [MDN: Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)

**Recommendation, unchanged:** ship both — a small `manifest.json` (for Android
Chrome, which does require it) *and* the Apple-specific meta/link tags (for iOS
Safari's icon/name specifically, since it still prefers them over the manifest).

### 1.2 Icon size/format — can a data-URI be used, or does this need a real file?

**Confirmed, re-verified as still true in 2026:** iOS Safari's `apple-touch-icon`
must be a **PNG**. Apple's own documentation instructs placing "an icon file in PNG
format... called `apple-touch-icon.png`" and shows `sizes="152x152"`/`"167x167"`/
`"180x180"` examples for iPad/iPad-Retina/iPhone-Retina.
— [Apple Developer: Configuring Web Applications](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html)

**Confirmed — SVG still not supported for `apple-touch-icon` specifically, even in
Safari 26.** This is worth double-checking precisely because Safari 26 added new SVG
support elsewhere: WebKit's own Safari 26 release notes say Safari now supports SVG
**favicons** ("SVG icons everywhere, including favicons"). That is a different,
narrower thing than the home-screen `apple-touch-icon` — multiple 2026 sources
specifically warn not to conflate the two: "Apple Touch Icons are exclusively PNG
files. No ICO, no SVG." The favicon-in-a-browser-tab SVG improvement does not extend
to the home-screen icon.
— [WebKit: Safari 26 beta blog post](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/); corroborated by current (2026) icon-format guides distinguishing favicon vs. apple-touch-icon SVG support

**Recommended concrete size, unchanged:** a single **180×180 PNG** remains the
current lowest-common-denominator that covers all modern iPhones. This is still the
consistent recommendation across current sources.

**Confirmed — solid background, no transparency:** iOS fills transparent regions of
the touch icon with a solid color, not the page background, so the PNG should have
an opaque background matching the app's own surface/accent color. I could not find
this stated on a first-party Apple page (still **Likely**, not Confirmed), but it is
long-standing, widely and consistently documented WebKit behavior.

**Data-URI vs. real file — re-verified, same conclusion, and this is still the part
that matters most for this project: iOS Safari needs a real file.**

- **Likely, re-confirmed in 2026 searches:** inline `data:image/png;base64,...` URIs
  in `<link rel="apple-touch-icon" href="...">` are not reliably honored by Safari.
  Current guidance (2026) still uniformly recommends "a direct file path... or place
  the icon file in the root directory," explicitly contrasting this with the fact
  that data-URI favicons *do* work in Chrome/Firefox — i.e., this is a Safari-specific
  gap, not a general limitation, and it hasn't closed as of Safari 26.
  — [Apple Developer Forums: apple-touch-icon specification discussion](https://developer.apple.com/forums/thread/65450); current (2026) icon-guide corroboration
- For the standard `manifest.json` `icons` array, MDN's current icons reference page
  only documents `src` as "a string that specifies **the path** to the icon image
  file" with URL-resolution rules — it does not mention `data:` URIs as a supported
  or unsupported option either way. **Unverified** for manifest icons specifically —
  treat as unsupported for this purpose rather than gambling on it, same as before.
  — [MDN: Web App Manifest — icons](https://developer.mozilla.org/en-US/docs/Web/Manifest/Reference/icons)

**Recommendation, unchanged and still the single most consequential finding for
Bob:** a **real binary PNG file** must be added to the repo — a genuine first
(everything decorative today is an inline SVG data-URI in `style.css`), but this does
**not** violate CLAUDE.md's "zero external/runtime dependencies" rule (that rule is
about no CDN scripts / no network calls / no npm packages; a local static PNG shipped
in the repo is exactly as "zero-dependency" as `style.css` itself). Minimum
footprint: one 180×180 PNG (e.g. `icons/apple-touch-icon.png`), reused as-is for the
manifest's icon entry too.

### 1.3 Is a Service Worker required for the home-screen-icon + full-screen-launch behavior specifically asked for here?

**Confirmed — no, not for this specific ask, and Safari 26's own release notes make
this more explicit than before, not less:**

- WebKit's Safari 26 post states plainly: **"nothing is required beyond the basics of
  an HTML file and a URL to provide a web app experience to users."** Service workers
  remain purely optional, for offline-caching use cases this project has deliberately
  avoided.
  — [WebKit: Safari 26 beta blog post](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/)
- MDN's current (Sept 2026) installability guide states a service worker is "not a
  requirement for a PWA to be installable," and standalone/full-screen launch on iOS
  now happens by default (§1.0) with literally no manifest or meta tags at all, let
  alone a service worker.
  — [MDN: Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- The one place a service worker genuinely matters is Chrome's automatic install
  banner heuristic (`beforeinstallprompt`), which is Chrome-specific UI polish, not
  relevant to the user's stated iPhone-first goal, and not required for manual
  "Add to Home Screen" from Chrome's menu either.

**Recommendation, unchanged and now on firmer footing: do not add a Service Worker
for this cycle.** It was already optional before this research pass; Safari 26's own
docs now state the "nothing required beyond HTML+URL" position even more directly.
Adding one would be scope creep this project doesn't need and would reintroduce real
cache-invalidation risk this project has deliberately avoided by staying on plain
`localStorage`.

### 1.4 Minimal correct tag/field set for both platforms

**Confirmed set, updated only in framing (§1.0) not in content** — the actual tags
needed are unchanged from before, because they still control the icon/name even
though they no longer control whether the app launches full-screen (iOS 26 does that
by default now regardless):

`index.html` `<head>` additions:
```html
<link rel="manifest" href="manifest.json">
<link rel="apple-touch-icon" sizes="180x180" href="icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Second Memory">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#2E5D34">
```
(`apple-mobile-web-app-capable` is now redundant for the standalone-launch behavior
itself on iOS 26+ per §1.0, but costs nothing to keep for compatibility with any
iOS version before 26 and is still Apple's documented tag for this purpose — no
reason to omit it. `theme-color` is Chrome/Android-side chrome-tinting, harmless
no-op elsewhere; `#2E5D34` matches this app's existing `--accent` value in
`style.css`.)

`manifest.json` (new file, repo root, alongside `index.html`/`style.css`):
```json
{
  "name": "Second Memory",
  "short_name": "2nd Memory",
  "start_url": "index.html",
  "display": "standalone",
  "background_color": "#F6FAF4",
  "theme_color": "#2E5D34",
  "icons": [
    { "src": "icons/apple-touch-icon.png", "sizes": "180x180", "type": "image/png" }
  ]
}
```
- `background_color`/`theme_color` reuse this app's existing `--bg`/`--accent` values
  verbatim from `style.css` — no new design decision needed.
- Chrome's own installability check wants a 192px **and** 512px icon in the manifest
  per MDN's current requirements. A single 180×180 PNG lets Android manually
  "Add to Home Screen" from the browser menu, but won't satisfy Chrome's automatic
  install-banner heuristic — a fine trade-off since the user's device is an iPhone.
  Flagging only so it isn't mistaken for an oversight later; if wanted, it needs two
  more PNG sizes (192×192, 512×512) generated from the same source art.

This is the smallest change that gets the actual outcome that still needs code on
this device (a real icon and name instead of iOS's ugly page-screenshot fallback):
one new small `manifest.json`, one new PNG file, six lines added to `index.html`. No
build step, no service worker, no new JS.

---

## Part 2 — Budget calendar responsive layout

This section is grounded directly in `style.css` as it exists in the repo right now
(re-read in full for this research pass) — the arithmetic below is not from an
external source, it's a direct calculation against the actual CSS rules, restated
here for traceability:
- `.content { padding: 32px 32px 48px; max-width: 960px; }` (style.css:351-356)
- `.sidebar { flex: 0 0 220px; }` (style.css:139)
- `@media (max-width: 700px) { .columns { grid-template-columns: 1fr; } .app-shell { flex-direction: column; } .sidebar { flex: 0 0 auto; } }` (style.css:518-522) — note this block does **not** currently touch `.budget-week-cells`, `.budget-day-cell`, or `.budget-weekday-row` at all.
- `.budget-week-cells { display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; }` (style.css:1243-1247)
- `.budget-weekday-row { display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; }` (style.css:1218-1227) — a separate, unlinked 7-column grid sitting above the `.budget-week` rows, not a header cell *inside* the same grid.
- `.budget-day-manual-input { font-size: 0.78rem; ... }` (style.css:1309-1319)

### 2.1 Is the existing 700px breakpoint already too narrow for the 7-column grid?

**Likely yes, marginally, right at the boundary — this is arithmetic, not an
external-source claim, so tagged "Likely" (sound reasoning from real numbers) not
"Confirmed" (no external authority sets a bright-line minimum calendar-cell width):**

- At exactly 700px viewport width, the same media query has already collapsed
  `.app-shell` to a column and `.sidebar` to `flex: 0 0 auto`, so the content area
  gets nearly the full viewport minus its own padding: `700 − 64 = 636px`.
- `636px − 48px (6 gaps × 8px)` = `588px` split across 7 columns → **≈84px per day
  cell**, and that's the *best case* right at the breakpoint's edge — every actual
  iPhone viewport is narrower still (iPhone CSS viewport widths run roughly 375–430px
  as of current iPhone models, all well under 700px).
- Each cell must fit: a date number, 1+ occurrence rows (checkbox + bill name,
  currently ellipsis-truncated via `.budget-occurrence-name`), and a bottom-pinned
  `<input type="number">`. At ~84px total width, after the input's own
  `padding: 4px 6px` plus border, there's very little room left for the bill name
  before ellipsis kicks in almost immediately.

**On "even desktop-classified narrow windows might need it":** above 700px, the
sidebar is *not* collapsed (`flex: 0 0 220px` stays fixed), so a browser window
resized to 900px gives the content area only `900 − 220 − 64 = 616px` — *worse* than
the 636px available right at the 700px mobile breakpoint, because the fixed 220px
sidebar doesn't shrink. Cell width at 900px works out to `(616 − 48) / 7 ≈ 81px` —
essentially the same cramped size as at the mobile breakpoint. **This confirms the
premise: a plain window resize well above the existing 700px mobile breakpoint hits
the same "too narrow for 7 columns" problem**, because the sidebar's fixed width
doesn't scale down. The grid doesn't become comfortable again until roughly
`(viewport − 220 − 64 − 48) / 7 ≈ 100–110px` per cell, i.e. viewport ≈ 1000–1050px —
at or above this app's own `.content { max-width: 960px }` ceiling.

**Recommendation:** give the Budget calendar its **own, wider breakpoint**, separate
from the app-wide `max-width: 700px` rule — don't reuse 700px for this. Concrete
number: **`max-width: 900px`**, applied only to the Budget-calendar-specific
selectors (`.budget-week-cells`, `.budget-day-cell`, `.budget-weekday-row`), not the
generic `.columns` rule used everywhere else. This is a judgment call from the
arithmetic above, not a number from an external spec — the Analyst/Architect should
feel free to adjust it, but 900px is comfortably past where the math above turns
ugly while still covering "narrow laptop window," not just phones.

### 2.2 Is a CSS-only single-column collapse a sound approach?

**Confirmed this is already this app's own established convention** (directly
verifiable in `style.css`): the exact media-query-swaps-`grid-template-columns`
technique already used for `.columns` (`repeat(3, 1fr)` → `1fr` at 700px) is
mechanically identical to what's needed for `.budget-week-cells`
(`repeat(7, 1fr)` → `1fr`) at the new breakpoint. CSS-only, no JS-driven layout
switching. **Recommend this over any JS-driven or agenda-library pattern** — it's
the smallest, most consistent-with-existing-conventions change, matching
CLAUDE.md's scope discipline and `docs/specs/budget-tab.md`'s own stated preference
elsewhere for reusing established patterns (e.g. `.scroll-block`) over inventing new
ones.

**One real implementation gap that must ship in the same breakpoint, not as a
follow-up bug (Likely, from direct markup inspection):** `.budget-weekday-row` is a
*separate* 7-column grid sitting above the stack of `.budget-week` rows — it is only
meaningful as a header while its columns visually line up with the columns
underneath. If `.budget-week-cells` collapses to one column while
`.budget-weekday-row` stays at 7 columns, the header breaks visually: seven day
labels spread across full width, sitting above a single stacked column that no
longer lines up under any of them. Two options, both CSS/markup-only:
(a) hide `.budget-weekday-row` entirely below the new breakpoint (simplest), relying
on each `.budget-day-cell`'s own date number for orientation; or
(b) fold the weekday name into each cell's own date label (e.g. "Sun · Sep 14")
instead of just the day-of-month, so day-of-week information isn't lost.
**Recommend (a)** given this project's preference for the smallest safe change,
unless the Analyst/Architect specifically wants the richer per-cell label.

### 2.3 iOS Safari's input-zoom-on-focus quirk — does it affect this app's inputs?

**Confirmed, the quirk itself is real, current, and well-documented as of 2026:**
iOS Safari automatically zooms the viewport when a focused form control's *computed*
font-size is under 16px, as a built-in accessibility heuristic ("any input rendering
smaller than 16px is assumed too small to read"). The fix is ensuring the control's
rendered font-size is ≥16px at the moment of focus — what matters is the computed
value after any inherited sizing, not the literal declared value. The behavior
applies to `<input>`, `<textarea>`, and `<select>` alike; it does not reproduce on
macOS Safari; it is not formally specified by CSS/HTML but is long-standing,
extensively corroborated, current WebKit behavior with no indication it has changed
in iOS 26.
— [CSS-Tricks: "16px or Larger Text Prevents iOS Form Zoom"](https://css-tricks.com/16px-or-larger-text-prevents-ios-form-zoom/); [defensivecss.dev: Input zoom on iOS Safari](https://defensivecss.dev/tip/input-zoom-safari/); corroborated by multiple current (2026) engineering write-ups found in this pass, including a still-open accessibility-tagged GitHub issue about exactly this behavior

**Confirmed this app is affected, and not just in Budget — verified directly against
`style.css`:**
- `.budget-day-manual-input` (the field this question specifically asked about) has
  `font-size: 0.78rem` — at this app's implicit 16px root, that's **≈12.5px**, well
  under the threshold. **This input will trigger iOS zoom on focus as currently
  styled.**
- Not isolated to Budget: `.sync-setup-form input` is `0.82rem` (≈13.1px);
  `.todo-edit-form`/`.shopping-edit-form input` are `0.85rem` (≈13.6px). More
  significantly, the **largest group of inputs in the app** — every
  `.add-form input[type=text/date/number/search]`, every `.X-edit-form input` built
  off the generic `.book-edit-form input, .recipe-edit-form input, ...` block, plus
  `.grade-input` and every `<select>` — declare **no explicit `font-size` at all**,
  only `font-family: inherit`. Without an explicit size these inherit the browser's
  own default control font, which is not guaranteed to compute to 16px on WebKit —
  I could not pin an exact universal default pixel value to a citable primary source
  (**Unverified** for that specific number), but the practical conclusion doesn't
  need that number: **any input without an explicit `font-size: 16px` or larger is a
  candidate for this bug and shouldn't be assumed safe.**

**Recommendation:** fix this as a **general, app-wide rule**, not a
Budget-tab-only patch, since the underlying gap (no input in this app currently
guarantees ≥16px) is app-wide and this bug fires on any iPhone regardless of which
breakpoint the calendar itself uses. Add, inside a mobile-width media query (either
the existing `@media (max-width: 700px)` block, since this isn't specific to the
900px calendar breakpoint, or a shared one): a rule setting `font-size: 16px` on all
text-entry form controls — `input[type="text"], input[type="search"],
input[type="number"], input[type="date"], input[type="password"], textarea, select`
— scoped inside that mobile media query so desktop's existing smaller type scale is
untouched. Pure CSS, zero dependencies, fixes `.budget-day-manual-input` and every
other small input across Notes/To-Do/Shopping List/etc. in one pass instead of
leaving the same latent bug for a future cycle to rediscover elsewhere.

---

## Summary of explicit recommendations

1. **Reframe the goal for Part 1** given iOS 26: full-screen/no-chrome launch on
   Add-to-Home-Screen is now the OS default on the user's likely-current iPhone with
   zero code changes. The actual work needed is giving iOS a real icon/name instead
   of its ugly page-screenshot fallback — same artifacts as originally planned,
   smaller and more accurate justification.
2. Add a minimal `manifest.json` **and** the Apple meta/link tags together — iOS
   still prioritizes `apple-touch-icon` over manifest icons for its home-screen icon
   specifically, so neither alone covers both platforms. Six new lines in
   `index.html`, one new small JSON file.
3. Ship one real **180×180 PNG** file (`icons/apple-touch-icon.png`) — a first binary
   asset for the repo, but not a CLAUDE.md violation (local static file, not a
   runtime dependency). SVG is still not supported for `apple-touch-icon` even after
   Safari 26's SVG-favicon improvements (that improvement covers regular favicons
   only). Data-URI icons are still not reliably honored by iOS Safari for this
   purpose — don't attempt it.
4. **Do not add a Service Worker.** Optional before this research pass and now
   stated even more explicitly as unnecessary by WebKit's own Safari 26 release
   notes ("nothing is required beyond the basics of an HTML file and a URL").
5. Give the Budget calendar its **own, wider breakpoint** (recommend `max-width:
   900px`) for collapsing `.budget-week-cells`/`.budget-day-cell` to a single
   column — the existing 700px app-wide breakpoint is already marginal for 7 columns
   and doesn't fix the problem on moderately narrow desktop windows either, since the
   220px fixed sidebar isn't collapsed until 700px.
6. In that same breakpoint, also **hide `.budget-weekday-row`** (simplest option) —
   it will visually misalign once the columns beneath it collapse to one; this needs
   to ship in the same change, not as a follow-up bug.
7. Add a **`font-size: 16px` floor on all text-entry inputs/selects/textareas inside
   the mobile media query**, app-wide — not just on `.budget-day-manual-input`. Every
   text-entry control in this app currently either declares a sub-16px font-size or
   none at all, so every one is a candidate for iOS Safari's focus-zoom quirk.

## Open items for the Analyst/Architect (not decided here)

- Exact breakpoint value for the Budget calendar (900px is a worked estimate from
  this app's real padding/gutter/sidebar numbers, not a measured/tested figure).
- Whether the weekday-row fix should be "hide it" (simplest) or "fold the weekday
  name into each cell" (richer, still CSS/markup-only, slightly more work).
- Whether to add the two extra manifest icon sizes (192×192, 512×512) now for
  Chrome's automatic-install-banner heuristic, or defer — recommend deferring, since
  the user's device is an iPhone and the automatic Chrome banner wasn't part of the
  ask.
- Whether it's worth confirming the user's exact iOS version before Bob builds this
  (the §1.0 framing assumes iOS 26+; if the device is actually on an older iOS, the
  standalone-launch behavior still requires `apple-mobile-web-app-capable`, which is
  included in the recommended tag set regardless, so this doesn't change what to
  build — only which sentence explains *why* it's needed).

## Sources

- [WebKit: News from WWDC25 — Web Technology Coming This Fall in Safari 26 Beta](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/)
- [MDN: Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable) (accessed Sept 2026, page shows Sept 7 2026 last-update stamp)
- [MDN: Web App Manifest — icons reference](https://developer.mozilla.org/en-US/docs/Web/Manifest/Reference/icons)
- [Apple Developer: Configuring Web Applications](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html)
- [Apple Developer Forums: apple-touch-icon specification discussion](https://developer.apple.com/forums/thread/65450)
- [GitHub/Lighthouse issue #14064: Safari 15.4 supports manifest-declared PWA icons](https://github.com/GoogleChrome/lighthouse/issues/14064)
- [MacRumors: iOS 26 — Add Web App or Bookmark to iPhone Home Screen](https://www.macrumors.com/how-to/save-safari-bookmark-web-app-iphone-home-screen/)
- [iDownloadBlog: iOS 26 — Safari opens every bookmark added to the Home Screen as a web app](https://www.idownloadblog.com/2025/06/17/apple-ios-26-safari-web-apps-home-screen-bookmarks/)
- [CSS-Tricks: 16px or Larger Text Prevents iOS Form Zoom](https://css-tricks.com/16px-or-larger-text-prevents-ios-form-zoom/)
- [defensivecss.dev: Input zoom on iOS Safari](https://defensivecss.dev/tip/input-zoom-safari/)
- `style.css` and `index.html` (this repo) — read in full for this research pass; all
  Budget-layout arithmetic in Part 2 is computed directly from the live values in
  these files, not from an external source.
