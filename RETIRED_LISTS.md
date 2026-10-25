# Lists that moved to other apps (version 83)

On 2026-10-25 these sections were taken off Second Memory's screens because other apps now do the job:

| Was in Second Memory | Now in | Where to bring it in |
|---|---|---|
| To-do list and Calendar | **Petalkeeper** (Seed Pouch, Garden Path month view) | Garden Shed > "Bring in to-dos from Second Memory" |
| Shopping list | **MealMate** (Shopping List page) | Shopping List > "Copy the shopping list from Second Memory" |
| Medications and equipment, Diagnoses, Weight and goal, Health summary, refill and weigh-in reminders | **Caregiver Command Center** | More > "Move lists in or out" |
| Recipe scaling, cook mode, pinning, share, print, sideways row, "My order" for recipes, "add to shopping list" | Gone. Recipes keep title, category, ingredients, steps and notes. | n/a |

## Nothing was deleted

- The code that **showed** these lists is gone. The **data** is not: it stays in this browser under the same storage
  keys (`secondMemory.todos.v1`, `.shoppingList.v1`, `.medications.v1`, `.diagnoses.v1`, `.weights.v1`, `.weightGoal.v1`).
  No code in this app removes those keys. (The only thing that clears them is "Forgot PIN: erase this device".)
- **Export data** still writes them to the file, in the same place as before (`collections.todos`, `collections.shoppingList`,
  `collections.medications`, `collections.diagnoses`, `collections.weights`, `local.weightGoal`), so an export from this version
  can be read by the other apps exactly like an export from version 82. The shape is pinned by
  `tests/fixtures/second-memory-export-v82.sample.json`, a real export made by version 82 from sample data, which each receiving
  app also tests against.
- **Import data** still merges those lists back into the hidden copy (same rules as before: never drops a record, never
  brings back a deleted one).
- **Sync** no longer sends or receives them, but the sync **server** still names them (`COLLECTION_NAMES` in `sync_server.py`
  must keep doing so: a list the server does not name is dropped on its next save). `sync_server.py` was not touched, so
  nothing is redeployed and the server's copy stays as it is.
- Records that the removed recipe extras added (`pinned`, `sortOrder`) stay on the recipe records, in exports and in sync.

## Order to move things safely

1. Open the **old** version of the app (or this one, which exports the same thing) and use **Export data** on every device
   that has lists you care about. Keep the file.
2. In each receiving app, bring the lists in from that file. Each importer shows counts first (or skips anything already
   there), so running it twice adds nothing the second time.
3. Check the counts match what you expect.
4. Only then deploy this version (merge the branch). Until a device has loaded it, the old screens keep working.

## Not carried over on purpose

- Second Memory's cook mode and the other cooking extras (recipes themselves are untouched).
- A Home quick add for to-dos and shopping items (quick add now makes notes only).
- Refill, weigh-in and to-do reminders (Caregiver Command Center and Petalkeeper have their own).
