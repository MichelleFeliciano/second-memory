# Second Memory

A personal, local-first organizer — books, recipes, notes, resume & portfolio links,
an encrypted password vault and a private journal, all in one place. (The authoritative
current list of sections lives in the `TABS` constant in `app.js`.)

> **Lists that moved to other apps (version 83).** The to-do list, shopping list, calendar,
> medications and equipment, diagnoses, weight tracker and health summary now live in
> **Petalkeeper** (to-dos and calendar), **MealMate** (shopping list) and **Caregiver Command
> Center** (medications, equipment, diagnoses and weight). Recipes stay here, without the cooking
> extras (scaling, cook mode, pinning, sharing, printing, the sideways row, "My order").
> **Nothing was deleted.** See [RETIRED_LISTS.md](RETIRED_LISTS.md).

## Use it now

The app is already live at **https://michellefeliciano.github.io/second-memory/** — that's
the normal way to use it day to day. Nothing to install; it works in any modern browser, on
any device, and can be added to your phone's home screen like an app (it's a PWA).

All of your data is stored in that browser's `localStorage`, on that device only.
Nothing is sent anywhere over the network unless you deliberately set up syncing between
devices, described below (once sync is set up, opening the app also sends the server one
empty "wake up" request, with no data and no passphrase).

## What else is in the app

- **Home:** search across every list, quick add (a note), the books you are reading (hide panels with Customize Home), recent searches, a first-run welcome card, and a notice about the lists that moved to other apps.
- **Books:** owned/read/unread/want-to-buy shelves, ratings, finished dates and a yearly reading goal. **Recipes:** title, category, ingredients, steps and notes, with search, category chips and three sorts; the Add form is a dropdown. **Notes**, **Resume & Portfolio** links and the **Journal** (a prompt of the day and "this day last year", a therapy summary).
- **Undo:** deleting shows an Undo bar for a few seconds; the Undo and Redo buttons also work for other changes.
- **Facts:** short things you keep having to look up (a shoe size, a plate number, a policy number), with a Copy button; tap a label or value to edit it. **Lists:** your own named lists (packing, gift ideas, movies to watch) with items you tick off; done items sink to the bottom and Clear done removes them. **Books:** a "Lend" button records who borrowed a book and when (and "Returned" clears it); searching the person's name finds the book. Facts and Lists sync between devices like notes do.
- **Passwords:** an encrypted password vault. You choose a master password (at least 10 characters); everything is encrypted on the device with the browser's built-in Web Crypto (PBKDF2-SHA256, 600,000 rounds, then AES-256-GCM), so nothing readable is ever stored. The vault is **never synced** and never searched, summarised or put in Undo. It locks itself after 3 idle minutes, after a minute out of sight, and with the app lock. It has a password generator, a Show / Copy button per entry (a copied password is cleared from the clipboard after 30 seconds) and an export of the still-encrypted file. **If you forget the master password the passwords cannot be recovered.**
- **Menu:** Theme (Auto, Light, Dark), Text size, High contrast, a **Settings check** (what is set up and what needs a look), **History** (recent changes with Undo), **Help** (a short tour), **Auto-sync**, **Update now** (reloads onto the newest version), **App lock** (a PIN; it hides the app but does not encrypt the data, and if you forget it the only way back in is to erase that device), and the app version. These settings stay on the device.

## Syncing between devices (optional)

By default, each device you use keeps its own separate copy of your data. If you want
your phone, laptop, etc. to share the same data, a sync server keeps them in sync. It
runs on [Render](https://render.com), not on any of your own devices, so it works whether or
not your computer or phone is on. On Render's Free plan the server falls asleep when idle
(the first Sync now after a while can take up to a minute) and keeps its data only in a
temporary folder, so it is a go-between, not a safe place for your data: every device keeps
its own full copy. Syncing happens when you tap **Sync now**, and on its own when the app opens and a few seconds after you change something (Menu, **Auto-sync**, turns that off; it pauses for a few minutes after a failed sync).

On each device, open the app and find the sync setup form — it just asks for a
passphrase (set as the `SYNC_TOKEN` environment variable on the Render service). Enter
it once per device and syncing starts immediately; no server address to type, no
certificate warning to click through, since Render provides a real, publicly-trusted
HTTPS certificate automatically.

If you ever need to change the passphrase, update `SYNC_TOKEN` in the Render dashboard
and restart the service, then re-enter the new passphrase on each device. Never put the
passphrase in this file, in the code, or in a commit.

## If a device is lost, reset, or something goes wrong

Where your data lives decides how you get it back. Never put the sync passphrase in this
file, in the code, or in a commit; keep it in a password manager.

| What | Where it lives | How to get it back |
|---|---|---|
| Everything that syncs (books, recipes, medications, diagnoses, weight, to-dos, shopping, notes, links) | Each device, plus the Render server (temporary) | Open the app on the new device, enter the passphrase, tap **Sync now**. It pulls everything down. |
| The password vault (encrypted) | **Only** the device where you made it, plus any backup file you download (Export vault file, or Export data, which carries the encrypted vault). It is never synced. | Open Passwords, **Restore a vault file**, then unlock it with its master password. Or **Import data** with a full backup on a device that has no vault yet. |
| The journal | **Only** the device where you wrote it. It is never synced. | Open the app, go to Journal, tap **Restore journal**, choose a journal backup file. Or use **Import data** with a full backup (see below). |
| Weight goal, reading goals, app lock, theme | Only the device you set them on | The first two come back with a full backup. The app lock and theme are per device: set them again in the Menu. |

**Keep a full backup.** In the app's Menu, tap **Export data** to download a full backup file. It
holds everything above, including the journal and goals, so keep the file
somewhere private. To restore, tap **Import data** in the Menu and choose the file. Importing
adds what is missing and updates what is older; it never deletes anything, and it skips what it
cannot read. Something you deleted on this device stays deleted, so an old file will not bring
it back. The app reminds you when a backup is overdue (the journal and the full backup after 7 days).

**A new phone or a wiped browser:**
1. Open https://michellefeliciano.github.io/second-memory/ and add it to the home screen.
2. Enter the passphrase and tap **Sync now**. Your synced lists come back.
3. Tap **Import data** and choose your latest full backup to bring back the journal and
   goals. Anything already identical is left alone.

**You deleted or changed something by mistake:**
- Tap **Undo** in the app straight away if you can.
- Otherwise the server keeps a restore point for each of the last 30 days, taken before that
  day's first change. On the Free plan these vanish whenever the server sleeps or is rebuilt,
  so they only help if you act soon, and a full backup file is the dependable copy. You can list them, then download one (replace the passphrase placeholder;
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
- `sync_server.py` — the sync API server (hosted on Render; reads `PORT`, `SYNC_TOKEN` and
  `DATA_DIR` from the environment; on the Free plan set `DATA_DIR` to a temporary folder such as
  `/tmp/second-memory-data`, which defaults to a folder in the system temp directory)
- `requirements.txt` — empty on purpose; the sync server is Python stdlib only
- `tests/` — the automated tests (see below)

## Running the tests

Run these after any change. They never touch your saved data or the real sync server.

- **The app:** from the project folder run `python -m http.server`, then open
  `http://localhost:8000/tests/tests.html`. It loads the real app in hidden frames that use
  memory-only storage and have no network, and runs every suite (tabs, lists,
  journal, repeating to-dos, search, and the app's side of syncing). The page title starts with
  `OK` and a count such as `OK 540/540` when everything passes.
- **The sync server and the app's files:** `python -m unittest discover -s tests` (standard
  library only). This starts the server on a throw-away folder and local port, and also checks
  the app's own files (version labels match, no external scripts, network calls only to the sync server).

Each file in `tests/suites/` is a plain script that is run inside a fresh copy of the app, so
it can use the app's own functions and variables directly. To add a check, add a
`check('what should be true', condition)` line to the matching suite.
