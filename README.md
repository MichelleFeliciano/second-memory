# Second Memory

A personal, local-first organizer — books, recipes, medications, diagnoses, appointments, a
weight tracker, a to-do list, a shopping list, notes, a household budget/bills tracker, resume & portfolio
links, and a private journal, all in one place. (The authoritative current list of sections
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

## If a device is lost, reset, or something goes wrong

Where your data lives decides how you get it back. Never put the sync passphrase in this
file, in the code, or in a commit; keep it in a password manager.

| What | Where it lives | How to get it back |
|---|---|---|
| Everything that syncs (books, recipes, medications, diagnoses, appointments, weight, to-dos, shopping, notes, links, bills, income) | Each device, plus the Render server | Open the app on the new device, enter the passphrase, tap **Sync now**. It pulls everything down. |
| The journal | **Only** the device where you wrote it. It is never synced. | Open the app, go to Journal, tap **Restore journal**, choose a journal backup file. Or use **Import data** with a full backup (see below). |
| Pay-period settings | Only the device you set them on | Come back with a full backup. Otherwise set them again in Budget. |

**Keep a full backup.** In the app's Menu, tap **Export data** to download a full backup file. It
holds everything above, including the journal and pay-period settings, so keep the file
somewhere private. To restore, tap **Import data** in the Menu and choose the file. Importing
adds what is missing and updates what is older; it never deletes anything, and it skips what it
cannot read. Something you deleted on this device stays deleted, so an old file will not bring
it back. The app reminds you when a backup is overdue (the journal after 7 days, the full backup
after 30).

**A new phone or a wiped browser:**
1. Open https://michellefeliciano.github.io/second-memory/ and add it to the home screen.
2. Enter the passphrase and tap **Sync now**. Your synced lists come back.
3. Tap **Import data** and choose your latest full backup to bring back the journal and
   pay-period settings. Anything already identical is left alone.

**You deleted or changed something by mistake:**
- Tap **Undo** in the app straight away if you can.
- Otherwise the server keeps a restore point for each of the last 30 days, taken before that
  day's first change. You can list them, then download one (replace the passphrase placeholder;
  a passphrase with non-English characters needs a `u:` prefix and URL-encoding):

  ```
  curl -X POST https://second-memory-mwm3.onrender.com/api/backup -H "X-Sync-Token: YOUR_PASSPHRASE"
  curl -X POST https://second-memory-mwm3.onrender.com/api/backup -H "X-Sync-Token: YOUR_PASSPHRASE" -d "{\"date\":\"2026-10-08\"}" -o restore.json
  ```

  The server may take up to a minute to answer if it was asleep. Open `restore.json` in a text
  editor to look up what an item used to say and re-enter it by hand. That always works. Using
  **Import data** on it is for a device that lost its data: it refills what is missing, but it
  will not un-delete something on a device that has already deleted it.

**The server's data is lost or the service is rebuilt:** nothing is lost on your devices. Tap
**Sync now** on the device with the most up-to-date data; the server is refilled from it.

**Before you rely on any of this:** do one trial restore from a full backup on a spare browser,
so you know the steps work.

## Files

- `index.html`, `style.css`, `app.js` — the app (hosted on GitHub Pages)
- `manifest.json`, `icons/`, `sw.js` — installable/offline PWA assets
- `sync_server.py` — the sync API server (hosted on Render; reads `PORT` and
  `SYNC_TOKEN` from the environment, stores data on a persistent disk at `DATA_DIR`,
  defaulting to `/var/data`)
- `requirements.txt` — empty on purpose; the sync server is Python stdlib only
- `tests/` — the automated tests (see below)

## Running the tests

Run these after any change. They never touch your saved data or the real sync server.

- **The app:** from the project folder run `python -m http.server`, then open
  `http://localhost:8000/tests/tests.html`. It loads the real app in hidden frames that use
  memory-only storage and have no network, and runs every suite (tabs, lists, budget maths,
  journal, repeating to-dos, search, and the app's side of syncing). The page title ends in
  `OK` when everything passes.
- **The sync server:** `python -m unittest discover -s tests` (standard library only).

Each file in `tests/suites/` is a plain script that is run inside a fresh copy of the app, so
it can use the app's own functions and variables directly. To add a check, add a
`check('what should be true', condition)` line to the matching suite.
