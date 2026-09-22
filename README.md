# Second Memory

A personal, local-first organizer — books, recipes, medications, diagnoses, a to-do
list, a shopping list, notes, a household budget/bills tracker, resume & portfolio
links, and coursework, all in one place. (The authoritative current list of sections
lives in the `TABS` constant in `app.js`.)

## Use it now

The app is already live at **https://michellefeliciano.github.io/second-memory/** — that's
the normal way to use it day to day. Nothing to install; it works in any modern browser, on
any device, and can be added to your phone's home screen like an app (it's a PWA).

All of your data is stored in that browser's `localStorage`, on that device only.
Nothing is sent anywhere over the network unless you deliberately set up syncing between
devices, described below.

## Syncing between devices (optional)

By default, each device you use keeps its own separate copy of your data. If you want
your phone, laptop, etc. to share the same data, a sync server keeps them in sync — it
runs continuously on [Render](https://render.com), not on any of your own devices, so it
works regardless of whether your computer or phone is on.

On each device, open the app and find the sync setup form — it just asks for a
passphrase (set as the `SYNC_TOKEN` environment variable on the Render service). Enter
it once per device and syncing starts immediately; no server address to type, no
certificate warning to click through, since Render provides a real, publicly-trusted
HTTPS certificate automatically.

If you ever need to change the passphrase, update `SYNC_TOKEN` in the Render dashboard
and restart the service, then re-enter the new passphrase on each device.

## Files

- `index.html`, `style.css`, `app.js` — the app (hosted on GitHub Pages)
- `manifest.json`, `icons/`, `sw.js` — installable/offline PWA assets
- `sync_server.py` — the sync API server (hosted on Render; reads `PORT` and
  `SYNC_TOKEN` from the environment, stores data on a persistent disk at `DATA_DIR`,
  defaulting to `/var/data`)
- `requirements.txt` — empty on purpose; the sync server is Python stdlib only
