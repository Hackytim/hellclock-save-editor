# Hell Clock Save Editor

**Open it: https://hackytim.github.io/hellclock-save-editor/**

## What it does

- **Relics:** the Reliquary (all stash pages) and relic loadouts I/II/III, drawn like the game. Drag relics around, and
  create or edit Common, Magic, Rare and Unique relics. Affixes follow the game's rules: valid pools per slot, counts per
  rarity and size, imbues and corruption.
- **Gear:** blessed gear loadouts (item, variant, roll) and the gear stash.
- **Skills:** the five skill slots.
- **Constellations and the Great Bell:** interactive maps using the game's unlock rules, points and devotion.
- **Stats:** a character sheet computed from relics, gear, the Great Bell and constellations. Differences between
  loadouts are shown like Path of Building's.
- **Maxroll import:** paste a Maxroll planner link and import its relics, skills, gear, constellations and Great Bell.

## How to use it

1. **Close Hell Clock.** The game rewrites the save when it exits, which would undo your edits.
2. Click **Open save folder** and pick `%USERPROFILE%\AppData\LocalLow\Rogue Snail\Hell Clock` (paste it into the
   picker's address bar).
3. Edit, then **Save changes** (<kbd>Ctrl</kbd>+<kbd>S</kbd>). The previous files are copied to `_editor_backups` in that
   folder first.

**Browsers:** Chrome and Edge can save straight into the folder, and remember it for next time. Firefox and Safari open
a single save file instead and download the edited copy, which you then put back into the save folder yourself.

## Safety

- Every save is backed up first (folder mode).
- Saves the game couldn't load are refused, for example missing skill slots, overlapping relics, or broken relic data.
- If the file changed on disk after you opened it (the game was running), you're asked before overwriting.
- Relics that aren't in Maxroll's game data (e.g. from a newer game version) block saving, since their size can't be
  checked.

Still: this edits your save file. Keep your own copy if you care about it.

## Credits

- Game data and icons: [Maxroll.gg](https://maxroll.gg/hell-clock)'s Hell Clock planner, loaded from Maxroll at
  runtime (nothing of theirs is included here).
- Hell Clock © Rogue Snail.
- This is a fan-made tool, not affiliated with Rogue Snail or Maxroll.

## Running it locally

Browsers only allow folder access on `https://` or `localhost` pages, so opening `index.html` directly doesn't work.
Serve this folder with any static server, e.g. `python -m http.server 8765`, and open http://localhost:8765/.

## How it works

The site is plain static files with no build step: `index.html`, `style.css`, `app.js`, `maxroll.js`, `storage.js`.

- `maxroll.js`: finds Maxroll's current planner data module (`auto-loader.js` → `loader-<hash>.js` →
  `data.min-<hash>.js`) and fetches build profiles; all of these allow cross-origin requests.
- `storage.js`: save folder access (File System Access API, handle remembered in IndexedDB), backups, and the
  single-file fallback.
- `app.js`: everything else. Game rules are taken from the game's code, for example:
  - affix values = `lerp(tier range, roll)` × upgrade modifier;
  - stats = `(base + Σadd) × Πmult × (1 + Σ(multAdd − 1))`;
  - tree nodes need a root, or a linked node with `pointsToUnlock` levels;
  - constellation node GUIDs repeat across constellations, so nodes are keyed per constellation.
