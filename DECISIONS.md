# Decisions Log

This file is maintained by the Archivist role. Newest entries at the top. Each entry
records what was decided, why, and any standing constraint future work must respect.

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
