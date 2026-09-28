// Hell Clock save editor: a static page. Game data (names, rolls, stats, trees) and images come from Maxroll's planner;
// save files are read and written in the browser (storage.js).

import { img, loadGameData, fetchProfile } from "./maxroll.js";
import * as store from "./storage.js";

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const STASH_W = 7, STASH_H = 10, LOADOUT_W = 7, LOADOUT_H = 6;
const RARITY = ["Common", "Magic", "Rare", "Unique"];
const IMPLICIT = { FuryImbued: 0, FaithImbued: 1, DisciplineImbued: 2, Corrupted: 3 };
const IMPLICIT_NAME = ["Fury", "Faith", "Discipline", "Corrupted"];
const TIERS = ["", "I", "II", "III", "IV"];

let MR;                             // Maxroll planner data
const relicById = {}, affixById = {}, skillById = {}, gearById = {}, nodeByGuid = {}, nodeByConst = {};
const state = {
  saves: [], saveId: null, save: null, dirty: false,
  stashPage: 0, loadout: 0, tab: "relics",
  selected: null,                   // { item, container }
  sources: { relics: true, gear: true, bell: true, constellations: true },
  anyAffix: false,                  // editor: ignore the game's affix pools
  search: "",                       // stash search
  statFilter: "", changedOnly: false,
  collapsed: new Set(JSON.parse(localGet("collapsed") || "[]")),
  cells: { stash: 52, loadout: 62 },
  entry: null,                      // the open save (storage.listSaves / openSaveFile entry)
  loadedModified: 0,                // file time when loaded, to notice the game writing it meanwhile
  baseline: null,                   // shape of the save when loaded (skill slot and loadout counts)
  confirmedClosed: false,           // asked "is the game closed?" this session
  pendingDir: null,                 // remembered folder that needs a click to re-grant access
  gearLoadout: 0, gearSlot: null,
};

// ------------------------------------------------------------------ boot

async function boot() {
  try {
    MR = await loadGameData();
  } catch (e) {
    $("#loading").innerHTML = `<div class="load-icon">⚠</div><div>Couldn't load the game data from Maxroll (${esc(e.message)}).</div>
      <div class="small muted">The editor needs an internet connection for game data and icons.</div><button class="primary" onclick="location.reload()">Try again</button>`;
    return;
  }
  for (const [key, r] of Object.entries(MR.relics)) relicById[r.id] = { key, ...r };
  for (const [key, a] of Object.entries(MR.relicAffixes)) affixById[a.id] = { key, ...a };
  for (const [key, s] of Object.entries(MR.skills)) skillById[s.id] = { key, ...s };
  for (const [key, g] of Object.entries(MR.gear)) gearById[g.id] = { key, ...g };
  for (const tree of Object.values(MR.skillTrees)) for (const n of Object.values(tree.nodes || {})) nodeByGuid[n.GUID] = n;
  // Node GUIDs repeat across constellations (e.g. Ogum and Yorixiamori); the save keys them by constellation id.
  for (const c of Object.values(MR.constellations)) for (const n of Object.values(c.nodes || {})) nodeByConst[`${c.id}:${n.GUID}`] = n;

  wireUi();
  $("#loading").classList.add("hidden");
  await restoreFolder();
}

function localGet(k) { try { return localStorage.getItem("hcse." + k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem("hcse." + k, v); } catch { /* private mode */ } }

const SAVE_PATH = "%USERPROFILE%\\AppData\\LocalLow\\Rogue Snail\\Hell Clock";

// ---- welcome screen (no save open yet)

async function restoreFolder() {
  if (store.canUseFolders) {
    const r = await store.rememberedFolder();
    if (r?.granted) return useFolder(r.dir);
    state.pendingDir = r?.dir || null;
  }
  showWelcome();
}

function showWelcome() {
  document.body.classList.add("no-save");
  const pending = state.pendingDir;
  $("#welcome").innerHTML = `
    <div class="welcome-card">
      <div class="welcome-mark">⧗</div>
      <h1>Hell Clock Save Editor</h1>
      <p class="lead">Edit relics, gear, skills, constellations and the Great Bell, see your stats, and import Maxroll builds.</p>
      <ol class="steps">
        <li><b>Close Hell Clock.</b> The game rewrites the save when it exits and would undo your edits.</li>
        <li><b>${store.canUseFolders ? "Open your save folder" : "Open your save file"}.</b> It's here:
          <div class="path"><code>${esc(SAVE_PATH)}</code><button data-copy-path title="Copy the path">Copy</button></div>
          <div class="small muted">In the ${store.canUseFolders ? "folder" : "file"} picker, paste the path into the address bar and press Enter.${store.canUseFolders ? "" : " Pick <code>PlayerSave0.json</code>."}</div></li>
        <li><b>Edit, then save.</b> ${store.canUseFolders ? "The editor backs up the old files to <code>_editor_backups</code> in that folder first." : "You'll download the edited save; put it back in that folder (keep a copy of the old one)."}</li>
      </ol>
      <div class="welcome-actions">
        ${store.canUseFolders ? (pending
          ? `<button class="primary big" data-welcome="reconnect">Reopen “${esc(pending.name)}”</button><button data-welcome="pick">Choose another folder</button>`
          : `<button class="primary big" data-welcome="pick">Open save folder</button>`)
          : `<button class="primary big" data-welcome="file">Open save file</button>`}
        ${store.canUseFolders ? `<button class="linkish" data-welcome="file">or open a single save file</button>` : ""}
      </div>
      ${store.canUseFolders ? "" : `<p class="small muted">Tip: Chrome or Edge can save straight into the folder, with automatic backups.</p>`}
      <p class="small muted privacy">Your save never leaves your computer: everything runs in this page. Game data and icons come from Maxroll.gg.</p>
    </div>`;
}

async function onWelcomeAction(act) {
  try {
    if (act === "pick") await useFolder(await store.pickFolder());
    else if (act === "reconnect") { if (await store.requestAccess(state.pendingDir)) await useFolder(state.pendingDir); }
    else if (act === "file") {
      const entry = await store.openSaveFile();
      if (!entry) return;
      state.folder = null;
      state.saves = [entry];
      renderSavePicker();
      await loadSave(entry.id);
    }
  } catch (e) {
    if (e.name !== "AbortError") toast(`Couldn't open that: ${e.message}`, true);
  }
}

async function useFolder(dir) {
  const saves = await store.listSaves(dir);
  if (!saves.length) {
    toast(`"${dir.name}" has no Hell Clock saves (PlayerSave0.json). Pick the "Hell Clock" folder shown on this page.`, true);
    state.pendingDir = null;
    return showWelcome();
  }
  state.folder = dir;
  state.saves = saves;
  renderSavePicker();
  const preferred = saves.find((x) => x.id === localGet("saveId")) || saves[0];
  await loadSave(preferred.id);
}

function renderSavePicker() {
  const sel = $("#saveSelect");
  sel.innerHTML = state.saves.map((x) => `<option value="${esc(x.id)}">${esc(x.label)} · ${new Date(x.modified).toLocaleString()}</option>`).join("");
  if (state.saveId) sel.value = state.saveId;
  $(".save-picker").classList.remove("hidden");
  $("#folderBtn").title = state.folder ? `Folder: ${state.folder.name}. Click to open another folder.` : "Open a save folder or file";
}

async function loadSave(id, fresh = true) {
  const entry = state.saves.find((x) => x.id === id);
  if (!entry) return;
  let text, modified;
  try {
    ({ text, modified } = entry.kind === "file" ? entry : await store.readSave(entry));
    state.save = JSON.parse(text);
    if (!state.save?.externalInventorySaveData || !state.save?._relicLoadoutsSaveData) throw new Error("that isn't a Hell Clock save");
  } catch (e) {
    return toast(`Couldn't read ${entry.name}: ${e.message}`, true);
  }
  state.entry = entry;
  state.saveId = id;
  state.loadedModified = modified;
  state.baseline = { skillSlots: (state.save.skillSlots || []).length, loadouts: state.save._relicLoadoutsSaveData._loadouts.length };
  localSet("saveId", id);
  $("#saveSelect").value = id;
  document.body.classList.remove("no-save");
  if (fresh) {
    state.selected = null;
    state.stashPage = 0;
    state.gearSlot = null;
  }
  state.loadout = state.save._relicLoadoutsSaveData?._currentIndex ?? 0;
  state.gearLoadout = state.save._blessedGearLoadoutsSaveData?._currentIndex ?? 0;
  for (const k of Object.keys(treeCache)) delete treeCache[k];
  for (const k of Object.keys(treeView)) delete treeView[k];
  setDirty(false);
  renderAll();
  const unknown = unknownRelicCount();
  if (unknown) toast(`This save has ${unknown} relic${unknown === 1 ? "" : "s"} that aren't in Maxroll's game data (a newer game version?). You can look around, but saving is disabled because their size is unknown.`, true);
}

function updateSaveButton() {
  const b = $("#saveBtn");
  b.disabled = !state.dirty;
  const download = state.entry?.kind === "file";
  $("#saveLabel").textContent = state.dirty ? (download ? "Download save" : "Save changes") : state.save ? "Saved" : "No save open";
}

// ---- saving

// Things the game can't load (it crashes or throws). Returns a list of problems; empty means OK to write.
function validateSave() {
  const s = state.save, problems = [];
  const slots = s.skillSlots || [];
  if (state.baseline && slots.length !== state.baseline.skillSlots) problems.push(`the save has ${slots.length} skill slots instead of ${state.baseline.skillSlots}`);
  const idx = slots.map((x) => x._slotIndex).sort((a, b) => a - b);
  if (idx.some((v, i) => v !== i)) problems.push("skill slot numbers must run from 1 without gaps");
  const ids = slots.map((x) => x._skillHashId).filter((x) => x !== -1);
  if (new Set(ids).size !== ids.length) problems.push("the same skill is in two slots");
  if (state.baseline && s._relicLoadoutsSaveData._loadouts.length !== state.baseline.loadouts) problems.push("the number of relic loadouts changed");
  const containers = [...stashPages().map((_, i) => ({ kind: "stash", index: i })), ...loadouts().map((_, i) => ({ kind: "loadout", index: i }))];
  for (const c of containers) {
    const where = c.kind === "stash" ? `stash page ${c.index + 1}` : `relic loadout ${TIERS[c.index + 1]}`;
    const { W, H } = containerSize(c);
    const used = new Set();
    for (const it of containerItems(c)) {
      const name = itemName(it) || `relic #${it._relicBaseDefinitionID}`;
      if (!it._position || !Array.isArray(it._affixesData) || !Array.isArray(it._implicitAffixesData)) { problems.push(`${where}: ${name} is incomplete`); continue; }
      if (it._affixesData.some((a) => !Number.isInteger(a._relicAffixDefinitionId))) problems.push(`${where}: ${name} has an affix without a valid id`);
      const { w, h } = itemDims(it), { x, y } = it._position;
      if (x < 0 || y < 0 || x + w > W || y + h > H) problems.push(`${where}: ${name} is outside the grid`);
      const cells = cellsOf(it);
      if (cells.some((k) => used.has(k))) problems.push(`${where}: ${name} overlaps another relic`);
      cells.forEach((k) => used.add(k));
    }
  }
  return problems;
}

async function saveToDisk() {
  if (!state.save || !state.dirty) return;
  const unknown = unknownRelicCount();
  if (unknown) return toast(`Not saved: ${unknown} relic${unknown === 1 ? " isn't" : "s aren't"} in Maxroll's game data, so overlaps can't be checked.`, true);
  const problems = validateSave();
  if (problems.length) return toast("Not saved. The game couldn't load this: " + problems.slice(0, 4).join("; ") + ".", true);
  const text = JSON.stringify(state.save);
  if (state.entry.kind === "file") {
    store.downloadSave(state.entry.name, text);
    setDirty(false);
    return toast(`Downloaded ${state.entry.name}. Replace the file in your save folder with it (close the game first).`);
  }
  try {
    const now = await store.lastModified(state.entry);
    if (now !== state.loadedModified && !confirm(`${state.entry.name} changed on disk since you opened it (was the game running?). Overwrite it with your edits?`)) return;
    if (!state.confirmedClosed && !confirm("Is Hell Clock closed?\n\nThe game rewrites the save when it exits, which would undo your edits.")) return;
    state.confirmedClosed = true;
    const r = await store.writeSave(state.entry, text);
    state.loadedModified = r.modified;
    state.entry.modified = r.modified;
    state.baseline = { skillSlots: (state.save.skillSlots || []).length, loadouts: loadouts().length };
    setDirty(false);
    renderSavePicker();
    toast(`Saved. The previous files are backed up in ${r.backup}.`);
  } catch (e) {
    toast(`Couldn't save: ${e.message}`, true);
  }
}

function renderAbout() {
  $("#aboutBody").innerHTML = `
    <p>A save editor for <b>Hell Clock</b> in the spirit of Path of Building: edit relics, gear, skills, constellations and
      the Great Bell, check the resulting stats, and import builds from Maxroll's planner.</p>
    <h3>Safety</h3>
    <ul>
      <li>Close the game before saving; it rewrites the save when it exits.</li>
      <li>Every save first copies the old files to <code>_editor_backups</code> in your save folder.</li>
      <li>Saves the game couldn't load (missing skill slots, overlapping relics…) are refused.</li>
      <li>Your save never leaves your computer; everything runs in this page.</li>
    </ul>
    <h3>Shortcuts</h3>
    <p><kbd>Ctrl</kbd>+<kbd>S</kbd> save · <kbd>/</kbd> search the stash · <kbd>Esc</kbd> deselect · <kbd>Del</kbd> delete the selected relic ·
      in the trees: click +1, right-click −1, Shift for max/none, scroll to zoom, drag to pan.</p>
    <h3>Credits</h3>
    <p class="small">Game data and icons: <a href="https://maxroll.gg/hell-clock" target="_blank" rel="noopener">Maxroll.gg</a>'s Hell Clock planner.
      Hell Clock © Rogue Snail. This is a fan-made tool, not affiliated with Rogue Snail or Maxroll. Edit at your own risk.</p>`;
}

function setDirty(d) {
  state.dirty = d;
  document.title = (d ? "● " : "") + "Hell Clock Save Editor";
  searchCache.clear();
  updateSaveButton();
}

function toast(text, error = false) {
  const el = document.createElement("div");
  el.className = "toast" + (error ? " error" : "");
  el.innerHTML = `<div class="t-body"></div><button title="Dismiss">✕</button>`;
  el.querySelector(".t-body").textContent = text;
  const close = () => el.remove();
  el.querySelector("button").onclick = close;
  $("#toasts").appendChild(el);
  setTimeout(close, error ? 12000 : 5000);
  while ($("#toasts").children.length > 4) $("#toasts").firstChild.remove();
}

// ------------------------------------------------------------------ lookups

function relicMeta(id) {
  const mr = relicById[id];
  const size = mr?.eRelicSize || "Small";
  let icon = null;
  if (mr?.sprite) icon = img(mr.sprite);
  return { mr, size, unique: !!mr?.name, name: mr?.name?.en || "", icon, lore: mr?.lore?.en };
}

function dims(size) {
  const d = MR.relicSizes[size];
  return d ? { w: d.width, h: d.height } : { w: 1, h: 1 };
}

function itemDims(item) { return dims(relicMeta(item._relicBaseDefinitionID).size); }

// Some names are untranslated game text keys like "TNF:(LifeRegenAffixName)"; turn those into "Life Regen".
function cleanName(name) {
  const m = /^TNF:\((.*)\)$/.exec(name || "");
  if (!m) return name;
  return m[1].replace(/(Affix)?Name$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
}

function affixMeta(id) {
  const mr = affixById[id];
  return { mr, name: cleanName(mr?.name?.en) || `Affix ${id}` };
}

// Relics missing from Maxroll's game data (e.g. added by a newer game version): their size and effects are unknown.
const isUnknownRelic = (item) => !relicById[item._relicBaseDefinitionID];

function unknownRelicCount() {
  let n = 0;
  for (const p of stashPages()) n += p.Items.filter(isUnknownRelic).length;
  for (const l of loadouts()) n += l.Items.filter(isUnknownRelic).length;
  return n;
}

function itemName(item) {
  const m = relicMeta(item._relicBaseDefinitionID);
  if (isUnknownRelic(item)) return `Unknown relic #${item._relicBaseDefinitionID}`;
  if (m.unique && m.name) return m.name;
  const first = item._affixesData[0];
  const prefix = first ? affixMeta(first._relicAffixDefinitionId).name : "";
  return `${prefix} ${m.size} Relic`.trim();
}

function itemIcon(item) {
  if (isUnknownRelic(item)) return null;
  const m = relicMeta(item._relicBaseDefinitionID);
  if (m.icon) return m.icon;
  const tiers = MR.relicTiers;
  const t = tiers[Math.max(0, Math.min(tiers.length - 1, item._tier || 1))];
  const sprite = t?.spritePerSize?.[m.size];
  return sprite ? img(sprite) : null;
}

// ------------------------------------------------------------------ affix values (RelicAffixDefinition.RemapValueWithUpgrade)

function upgradeFor(def, level) {
  const override = def.upgradeModifierOverride;
  if (override && Object.keys(override).length) {
    const keys = Object.keys(override).map(Number);
    return { type: def.modifierType || "Additive", m: override[Math.min(level, Math.max(...keys))] ?? 0 };
  }
  const cfg = def.relicUpgradeModifierConfig;
  if (cfg && cfg.upgradeModifier) {
    const keys = Object.keys(cfg.upgradeModifier).map(Number);
    return { type: cfg.modifierType, m: cfg.upgradeModifier[Math.min(level, Math.max(...keys))] ?? 1 };
  }
  return null;
}

function rolled(def, a, upgradeLevel) {
  const ranges = def.tierRollRanges || [];
  const rr = ranges.find((r) => r.tier === a._tier) || ranges[ranges.length - 1];
  if (!rr) return null;
  const [lo, hi] = rr.rollRange;
  let v = lo + (hi - lo) * a._rollValue;
  const up = upgradeFor(def, upgradeLevel);
  if (up) {
    if (up.type === "Additive") v += up.m;
    else if (up.type === "MultiplicativeAdditive") v = (v - 1) * up.m + 1;
    else if (up.type === "Multiplicative") v *= up.m;
  }
  return v;
}

function num(v, digits = 2) {
  if (v == null || !isFinite(v)) return "?";
  const abs = Math.abs(v);
  const d = abs >= 1000 ? 0 : abs >= 100 ? 1 : digits;
  return Number(v.toFixed(d)).toLocaleString();
}

const isPct = (stat) => MR.stats[stat]?.format === "PERCENTAGE";
const statName = (stat) => {
  const n = MR.stats[stat]?.name?.en;
  if (n && !n.startsWith("TNF:")) return n;
  return String(stat).replace(/Stat$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
};

function fmtMod(stat, type, v) {
  if (v == null) return "?";
  if (type === "Multiplicative") return "x" + num(v, 2);
  if (type === "MultiplicativeAdditive") { const p = (v - 1) * 100; return (p >= 0 ? "+" : "") + num(p, 1) + "%"; }
  if (isPct(stat)) { const p = v * 100; return (p >= 0 ? "+" : "") + num(p, 1) + "%"; }
  return (v >= 0 ? "+" : "") + num(v, 1);
}

function fmtVar(v, format) {
  if (v == null || !isFinite(v)) return "?";
  if (format === "Percentage") return num(v * 100, 1) + "%";
  if (format === "MultiplicativeAdditive") { const p = (v - 1) * 100; return (p >= 0 ? "+" : "") + num(p, 1) + "%"; }
  if (format === "Multiplicative") return "x" + num(v, 2);
  if (format === "Rounded") return num(Math.round(v), 0);
  return num(v, 2);
}

function styled(text) {
  return String(text)
    .replace(/<style="?\w+"?>(.*?)<\/style>/g, '<span class="val">$1</span>')
    .replace(/<(?!\/?span)[^>]+>/g, "")
    .replace(/\n/g, "<br>")
    .replace(/\{\d\}/g, '<span class="val">?</span>');
}

function describeAffix(a, upgradeLevel) {
  const { mr } = affixMeta(a._relicAffixDefinitionId);
  if (!mr) return `<span class="muted">Unknown affix #${a._relicAffixDefinitionId}</span>`;
  let tpl = mr.description?.en || "{0} {1}";
  const v = rolled(mr, a, upgradeLevel);
  if (mr.type === "StatModifierAffixDefinition") {
    tpl = tpl.replace("{0}", esc(statName(mr.eStatDefinition))).replace("{1}", fmtMod(mr.eStatDefinition, mr.statModifierType, v));
    const extra = (mr.additionalStatModifierDefinitions || []).map((s) => {
      const val = mr.applyRollToAdditionalStatModifiers && v != null ? s.value * v : s.value;
      return ` and <span class="val">${fmtMod(s.eStatDefinition, s.statModifierType, val)}</span> ${esc(statName(s.eStatDefinition))}`;
    }).join("");
    tpl = tpl.replace("{2}", extra);
  } else if (mr.behaviorData) {
    const vars = mr.behaviorData.variables?.variables || [];
    const rollVar = vars.find((x) => x.name === mr.rollVariableName);
    tpl = tpl.replace("{0}", `<span class="val">${fmtVar(v, rollVar?.eSkillEffectVariableFormat)}</span>`);
    (mr.additionalLocalizationVariables || []).forEach((lv, i) => {
      const ref = typeof lv === "string" ? lv : lv?.skillEffectVariableReference?.valueOrName ?? lv?.name;
      const def = vars.find((x) => x.name === ref);
      const value = def ? def.baseValue : Number(ref);
      const format = lv?.overrideFormat ? lv.valueFormatOverride : def?.eSkillEffectVariableFormat;
      if (def || isFinite(value)) tpl = tpl.replace(`{${i + 1}}`, `<span class="val">${fmtVar(value, format)}</span>`);
    });
  } else {
    const stat = mr.eStatRegen || mr.eStatDefinition;
    tpl = tpl.replace("{0}", `<span class="val">${stat && !isPct(stat) && v != null && v < 1 ? num(v * 100, 2) + "%" : num(v)}</span>`).replace("{1}", esc(stat ? statName(stat) : ""));
  }
  return styled(tpl);
}

// ------------------------------------------------------------------ containers

const stashPages = () => state.save.externalInventorySaveData.ItemPages;
const loadouts = () => state.save._relicLoadoutsSaveData._loadouts;

function containerItems(c) {
  return c.kind === "stash" ? stashPages()[c.index].Items : loadouts()[c.index].Items;
}
function containerSize(c) { return c.kind === "stash" ? { W: STASH_W, H: STASH_H } : { W: LOADOUT_W, H: LOADOUT_H }; }

function cellsOf(item, pos = item._position) {
  const { w, h } = itemDims(item);
  const out = [];
  for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) out.push(`${pos.x + dx},${pos.y + dy}`);
  return out;
}

function fits(c, item, pos, ignore) {
  const { W, H } = containerSize(c);
  const { w, h } = itemDims(item);
  if (pos.x < 0 || pos.y < 0 || pos.x + w > W || pos.y + h > H) return false;
  const used = new Set();
  for (const it of containerItems(c)) if (it !== ignore) cellsOf(it).forEach((k) => used.add(k));
  return !cellsOf(item, pos).some((k) => used.has(k));
}

// First free spot, scanning from the top-left as the game displays it (the game's y axis points up).
function findSpot(c, item) {
  const { W, H } = containerSize(c);
  const { w, h } = itemDims(item);
  for (let row = 0; row + h <= H; row++) {
    for (let x = 0; x + w <= W; x++) {
      const pos = { x, y: H - row - h };
      if (fits(c, item, pos)) return pos;
    }
  }
  return null;
}

// Like the game: normal pages first, then temporary pages, and a new temporary page when everything is full
// (the game removes empty temporary pages itself).
function addToStash(item, preferPage = state.stashPage) {
  const pages = stashPages();
  const idx = pages.map((_, i) => i);
  const order = [preferPage, ...idx.filter((i) => i !== preferPage && !pages[i].IsTemporary), ...idx.filter((i) => i !== preferPage && pages[i].IsTemporary)];
  for (const i of order) {
    const c = { kind: "stash", index: i };
    const pos = findSpot(c, item);
    if (pos) { item._position = pos; pages[i].Items.push(item); return c; }
  }
  pages.push({ Items: [], IsTemporary: true });
  const c = { kind: "stash", index: pages.length - 1 };
  const pos = findSpot(c, item);
  if (!pos) { pages.pop(); return null; }
  item._position = pos;
  pages[c.index].Items.push(item);
  return c;
}

function removeItem(c, item) {
  const arr = containerItems(c);
  const i = arr.indexOf(item);
  if (i >= 0) arr.splice(i, 1);
}

// ------------------------------------------------------------------ rendering

const cellFor = (el) => Number(el.dataset.cell) || 52;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Fit both grids to the window (the layout doesn't scroll on wide screens; narrow ones stack and scroll).
// The relic editor sits to the right of the loadout grid when the panel is wide enough; otherwise it goes below.
const EDITOR_MIN = 440;

function layoutCells() {
  const width = $(".character").clientWidth - 32;
  const beside = Math.floor((width - EDITOR_MIN - 18) / LOADOUT_W);
  const stacked = beside < 50;
  $("#tab-relics").classList.toggle("stacked", stacked);
  const loadout = stacked ? clamp(Math.floor(width / LOADOUT_W), 48, 72) : Math.min(beside, 68);
  if (matchMedia("(max-width: 1250px)").matches) { state.cells = { stash: 50, loadout }; }
  else {
    const panel = $(".reliquary"), wrap = $("#stashGrid").parentElement, legend = $(".reliquary .legend");
    const avail = panel.getBoundingClientRect().bottom - wrap.getBoundingClientRect().top - legend.offsetHeight - 34;
    state.cells = { stash: clamp(Math.floor(avail / STASH_H), 38, 60), loadout };
  }
  document.documentElement.style.setProperty("--stash-cell", state.cells.stash + "px");
}

function renderAll() {
  renderHeader();
  renderStashTabs();
  layoutCells();
  renderGrid($("#stashGrid"), { kind: "stash", index: state.stashPage });
  renderLoadoutTabs();
  renderGrid($("#loadoutGrid"), { kind: "loadout", index: state.loadout });
  renderEditor();
  renderGear();
  renderSkills();
  for (const kind of ["const", "bell"]) if (!$(`#tab-${kind}`).classList.contains("hidden")) renderTree(kind);
  renderStats();
}

function renderHeader() {
  const s = state.save;
  const hours = Math.floor((s.gameplayTime || 0) / 3600);
  const st = computeStats();
  const key = [["Life", "Life"], ["BaseDamage", "Base Damage"], ["CriticalChance", "Crit"], ["CriticalDamage", "Crit Dmg"], ["Evasion", "Evasion"], ["MovementSpeed", "Move"]]
    .filter(([k]) => st[k]).map(([k, label]) => `<span class="keystat">${label}<b>${fmtStat(k, st[k].value)}</b></span>`).join("");
  $("#charHeader").innerHTML = `
    <div class="portrait"><img src="art/pajeu.png" alt="Pajeú"></div>
    <div class="name">Pajeú</div>
    <div class="facts">
      <span>World Tier <b>${s.worldTier}</b></span><span>Soul Stones <b>${num(s.soulStones, 0)}</b></span>
      <span>Runs <b>${s.totalRuns}</b></span><span>Best hit <b>${num(s.highestDamageInstanceDealt, 0)}</b></span><span>Played <b>${hours}h</b></span>
    </div>
    <div class="keystats">${key}</div>`;
}

// Text a relic can be found by: name, size, rarity and every affix line.
const searchCache = new Map();
function searchText(item) {
  let t = searchCache.get(item);
  if (t == null) {
    const m = relicMeta(item._relicBaseDefinitionID);
    t = [itemName(item), m.size, RARITY[item._eRelicRarity], ...allAffixes(item).map((a) => affixMeta(a._relicAffixDefinitionId).name + " " + describeAffix(a, item._upgradeLevel))]
      .join(" ").replace(/<[^>]+>/g, "").toLowerCase();
    searchCache.set(item, t);
  }
  return t;
}
const matches = (item) => !state.search || state.search.split(/\s+/).every((w) => searchText(item).includes(w));

function renderStashTabs() {
  let normal = 0, temp = 0, total = 0, hitsTotal = 0;
  $("#stashTabs").innerHTML = stashPages().map((p, i) => {
    const label = p.IsTemporary ? `T${++temp}` : String(++normal);
    const used = p.Items.reduce((n, it) => { const d = itemDims(it); return n + d.w * d.h; }, 0);
    const hits = state.search ? p.Items.filter(matches).length : 0;
    total += p.Items.length; hitsTotal += hits;
    const pct = Math.min(100, Math.round((used / (STASH_W * STASH_H)) * 100));
    const cls = ["page-chip", i === state.stashPage && "active", p.IsTemporary && "temp", pct >= 100 && "full", state.search && !hits && "no-hits"].filter(Boolean).join(" ");
    return `<button data-page="${i}" class="${cls}" title="${p.IsTemporary ? "Temporary page " + temp : "Page " + normal}: ${p.Items.length} relics, ${pct}% full">${label}<span class="fill" style="width:${pct}%"></span>${hits ? `<span class="hits">${hits}</span>` : ""}</button>`;
  }).join("");
  $("#stashSummary").textContent = state.search ? `${hitsTotal} match${hitsTotal === 1 ? "" : "es"}` : `${total} relics`;
}

function renderLoadoutTabs() {
  const cur = state.save._relicLoadoutsSaveData._currentIndex;
  $("#loadoutTabs").innerHTML = `<div class="segmented">${loadouts().map((l, i) =>
    `<button data-loadout="${i}" class="${i === state.loadout ? "active" : ""} ${i === cur ? "current" : ""}" title="Loadout ${TIERS[i + 1]}: ${l.Items.length} relics${i === cur ? " (active in game)" : ""}">${TIERS[i + 1]}</button>`).join("")}</div>
    <span class="info">${state.loadout === cur ? "<b>●</b> Active in game" : `Game uses loadout ${TIERS[cur + 1]}`} · ${loadouts()[state.loadout].Items.length} relics</span>
    ${state.loadout === cur ? "" : `<button id="makeActive" class="accent" title="Make this the loadout the game uses">Use in game</button>`}`;
}

function renderGrid(el, c) {
  const { W, H } = containerSize(c);
  const cell = c.kind === "stash" ? state.cells.stash : state.cells.loadout;
  el.dataset.cell = cell;
  el.style.setProperty("--cell", cell + "px");
  el.style.width = W * cell + "px";
  el.style.height = H * cell + "px";
  el.dataset.kind = c.kind;
  el.dataset.index = c.index;
  el.innerHTML = "";
  for (const item of containerItems(c)) {
    const m = relicMeta(item._relicBaseDefinitionID);
    const { w, h } = dims(m.size);
    const div = document.createElement("div");
    const hit = state.search && c.kind === "stash" ? (matches(item) ? " match" : " dim") : "";
    div.className = `item r${item._eRelicRarity}${state.selected?.item === item ? " selected" : ""}${hit}`;
    div.style.left = item._position.x * cell + "px";
    div.style.top = (H - item._position.y - h) * cell + "px";
    div.style.width = w * cell + "px";
    div.style.height = h * cell + "px";
    const icon = itemIcon(item);
    div.innerHTML = (icon ? `<img src="${icon}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'fallback',textContent:${JSON.stringify(itemName(item))}}))">` : `<div class="fallback">${esc(itemName(item))}</div>`)
      + (item._upgradeLevel ? `<span class="badge">+${item._upgradeLevel}</span>` : "")
      + (item._isCorrupted ? `<span class="corrupt">◆</span>` : "")
      + (item._showNotification ? `<span class="new">!</span>` : "");
    div._item = item;
    div._container = c;
    el.appendChild(div);
  }
}

function tooltipHtml(item) {
  const m = relicMeta(item._relicBaseDefinitionID);
  const level = item._upgradeLevel;
  const rows = item._affixesData.map((a) => {
    const am = affixMeta(a._relicAffixDefinitionId);
    const cls = am.mr?.eAffixRarity === "Unique" ? "unique" : "";
    return `<div class="affix ${cls}">${describeAffix(a, level)}</div>`;
  }).join("");
  const imps = item._implicitAffixesData.map((im) =>
    `<div class="affix ${im._eImplicitAffixCategory === 3 ? "corrupted" : "implicit"}">[${IMPLICIT_NAME[im._eImplicitAffixCategory]}] ${describeAffix(im._relicAffixData, level)}</div>`).join("");
  return `<div class="title c${item._eRelicRarity}">${esc(itemName(item))}</div>
    <div class="meta">${RARITY[item._eRelicRarity]} ${m.size} relic · Tier ${TIERS[item._tier] || item._tier} · Upgrade +${level}${item._ascended ? " · Ascended" : ""}${item._isCorrupted ? " · Corrupted" : ""}</div>
    ${isUnknownRelic(item) ? `<div class="affix corrupted">This relic isn't in Maxroll's game data, so its size and effects are unknown.</div>` : ""}
    ${rows}${imps ? '<div class="sep"></div>' + imps : ""}${m.lore ? `<div class="lore">${esc(m.lore)}</div>` : ""}`;
}

function showTooltip(item, x, y) {
  const t = $("#tooltip");
  t.innerHTML = tooltipHtml(item);
  t.classList.remove("hidden");
  const r = t.getBoundingClientRect();
  let left = x + 18, top = y + 12;
  if (left + r.width > innerWidth - 8) left = x - r.width - 18;
  if (top + r.height > innerHeight - 8) top = Math.max(8, innerHeight - r.height - 8);
  t.style.left = left + "px";
  t.style.top = top + "px";
}
const hideTooltip = () => $("#tooltip").classList.add("hidden");

// ------------------------------------------------------------------ relic rules (RelicInventoryItem.RollAffixes)
// Affixes are stored as [unique effects..., special (rares only), primary..., secondary...]. Counts come from the base
// (primary/secondaryAffixAmount) plus the rarity's additional amounts for the relic size. Rares get one Special affix
// (any size when dropped; crafting blocks some sizes). Implicits: one imbue (Fury/Faith/Discipline) and/or one corruption.

const ROLE_ORDER = { intrinsic: 0, special: 1, primary: 2, secondary: 3, other: 4 };
const ROLE_LABEL = { intrinsic: "Unique", special: "Special", primary: "Primary", secondary: "Secondary", other: "Other" };
const IMBUE_KEYS = ["FuryImbued", "FaithImbued", "DisciplineImbued"];

function affixIdByKey(key) {
  const mr = MR.relicAffixes[key];
  return mr ? mr.id : NaN;
}

const range2 = (a) => (Array.isArray(a) ? a : [0, 0]);

function relicRules(item) {
  const m = relicMeta(item._relicBaseDefinitionID);
  const base = m.mr;
  const rarity = MR.relicRarities[RARITY[item._eRelicRarity]] || {};
  const addP = range2(rarity.additionalPrimaryAffixAmount?.[m.size]), addS = range2(rarity.additionalSecondaryAffixAmount?.[m.size]);
  const bp = range2(base?.primaryAffixAmount), bs = range2(base?.secondaryAffixAmount);
  const ids = (list) => (list || []).map((k) => affixIdByKey(typeof k === "string" ? k : k?.affix || k?.name)).filter((x) => Number.isFinite(x));
  return {
    meta: m, base, size: m.size,
    intrinsic: ids(base?.intrinsicAffixes),
    primaryPool: ids(base?.primaryAffixPool),
    secondaryPool: ids(base?.secondaryAffixPool),
    primary: [bp[0] + addP[0], bp[1] + addP[1]],
    secondary: [bs[0] + addS[0], bs[1] + addS[1]],
  };
}

function affixRoles(item, rules = relicRules(item)) {
  return item._affixesData.map((a) => {
    const id = a._relicAffixDefinitionId;
    if (rules.intrinsic.includes(id)) return "intrinsic";
    if (affixById[id]?.eAffixRarity === "Special") return "special";
    if (rules.primaryPool.includes(id)) return "primary";
    if (rules.secondaryPool.includes(id)) return "secondary";
    return "other";
  });
}

function sortAffixes(item) {
  const roles = affixRoles(item);
  const rows = item._affixesData.map((a, i) => ({ a, r: ROLE_ORDER[roles[i]], i }));
  rows.sort((x, y) => x.r - y.r || x.i - y.i);
  item._affixesData = rows.map((x) => x.a);
}

const hasTier = (def, tier) => !def.tierRollRanges?.length || def.tierRollRanges.some((r) => r.tier === tier);

function specialPool(tier) {
  return Object.values(affixById).filter((a) => a.eAffixRarity === "Special" && hasTier(a, tier)).map((a) => a.id);
}

function anyPool() {
  const ids = Object.values(affixById).filter((a) => a.eAffixRarity !== "Implicit").map((a) => a.id);
  return ids;
}

function poolFor(role, item, rules) {
  if (state.anyAffix || role === "other") return anyPool();
  if (role === "special") return specialPool(item._tier);
  if (role === "primary") return rules.primaryPool;
  if (role === "secondary") return rules.secondaryPool;
  return rules.intrinsic;
}

const newAffix = (id, tier, roll = 1) => ({ _relicAffixDefinitionId: id, _rollValue: roll, _tier: tier, _locked: false });

function pickUnused(pool, used) {
  const free = pool.filter((id) => !used.has(id));
  return free.length ? free[Math.floor(Math.random() * free.length)] : null;
}

// Fills the relic like a drop: unique effects, a special for rares, then the maximum primary and secondary counts.
function rerollAffixes(item, roll = 1) {
  const rules = relicRules(item);
  const used = new Set(rules.intrinsic);
  const ids = [...rules.intrinsic];
  if (item._eRelicRarity === 2) { const s = pickUnused(specialPool(item._tier), used); if (s != null) { ids.push(s); used.add(s); } }
  for (const [pool, count] of [[rules.primaryPool, rules.primary[1]], [rules.secondaryPool, rules.secondary[1]]]) {
    for (let i = 0; i < count; i++) { const id = pickUnused(pool, used); if (id == null) break; ids.push(id); used.add(id); }
  }
  item._affixesData = ids.map((id) => newAffix(id, item._tier, roll));
}

// Changing rarity adds or removes the special slot and fits the primary/secondary counts to the new rarity.
function setRarity(item, rarity) {
  item._eRelicRarity = rarity;
  const rules = relicRules(item);
  let roles = affixRoles(item, rules);
  if (rarity !== 2) item._affixesData = item._affixesData.filter((_, i) => roles[i] !== "special");
  else if (!roles.includes("special")) {
    const s = pickUnused(specialPool(item._tier), new Set(item._affixesData.map((a) => a._relicAffixDefinitionId)));
    if (s != null) item._affixesData.unshift(newAffix(s, item._tier));
  }
  for (const role of ["primary", "secondary"]) {
    const [min, max] = rules[role];
    roles = affixRoles(item, rules);
    let idx = roles.map((r, i) => (r === role ? i : -1)).filter((i) => i >= 0);
    while (idx.length > max) item._affixesData.splice(idx.pop(), 1);
    const used = new Set(item._affixesData.map((a) => a._relicAffixDefinitionId));
    for (let n = idx.length; n < min; n++) {
      const id = pickUnused(rules[role + "Pool"], used);
      if (id == null) break;
      used.add(id);
      item._affixesData.push(newAffix(id, item._tier));
    }
  }
  sortAffixes(item);
}

function implicitPools(size) {
  const pools = MR.relicSizes[size]?.implicitAffixes || {};
  const out = {};
  for (const [k, list] of Object.entries(pools)) out[IMPLICIT[k]] = list.map(affixIdByKey).filter((x) => Number.isFinite(x));
  return out;
}

const labelCache = new Map();
function affixLabel(id, tier) {
  const key = id + ":" + tier;
  if (!labelCache.has(key)) {
    const text = describeAffix(newAffix(id, tier), 0).replace(/<br>/g, " ").replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
    const name = affixMeta(id).name;
    const full = `${name}: ${text}`;
    labelCache.set(key, full.length > 95 ? full.slice(0, 92) + "..." : full);
  }
  return labelCache.get(key);
}

function affixOptions(pool, current, used, tier) {
  const ids = [...new Set([current, ...pool.filter((id) => id === current || !used.has(id))])].filter((x) => x != null);
  ids.sort((a, b) => affixLabel(a, tier).localeCompare(affixLabel(b, tier)));
  return ids.map((id) => `<option value="${id}" ${id === current ? "selected" : ""}>${esc(affixLabel(id, tier))}</option>`).join("");
}

// ------------------------------------------------------------------ editor

function renderEditor() {
  const el = $("#editor");
  const sel = state.selected;
  if (!sel || !containerItems(sel.container).includes(sel.item)) {
    state.selected = null;
    el.className = "editor empty";
    el.innerHTML = `<div class="big">No relic selected</div>Click a relic in the stash or loadout to edit it, or drag it between them.<br>
      <button data-act="new" class="accent">＋ Create a new relic</button>`;
    return;
  }
  const item = sel.item;
  const rules = relicRules(item);
  const m = rules.meta;
  const roles = affixRoles(item, rules);
  const used = new Set(item._affixesData.map((a) => a._relicAffixDefinitionId));
  el.className = "editor";
  const tierOpts = (t) => [1, 2, 3, 4].map((n) => `<option value="${n}" ${n === t ? "selected" : ""}>${TIERS[n]}</option>`).join("");
  const rollInputs = (a, path) => `
      <input type="range" min="0" max="1" step="0.01" value="${a._rollValue}" data-path="${path}" data-field="_rollValue" title="Roll ${Math.round(a._rollValue * 100)}%">
      <select data-path="${path}" data-field="_tier" title="Affix tier">${tierOpts(a._tier)}</select>`;

  const count = (role) => roles.filter((r) => r === role).length;
  const canRemove = (role) => state.anyAffix || role === "other" || (role === "primary" && count(role) > rules.primary[0])
    || (role === "secondary" && count(role) > rules.secondary[0]);
  const affixRows = item._affixesData.map((a, i) => {
    const role = roles[i];
    const fixed = role === "intrinsic" && !state.anyAffix;
    return `<div class="affix-row">
      <span class="role ${role}">${ROLE_LABEL[role]}</span>
      <div class="pick">${fixed ? "" : `<select data-affix-index="${i}">${affixOptions(poolFor(role, item, rules), a._relicAffixDefinitionId, used, item._tier)}</select>`}
        <div class="desc">${describeAffix(a, item._upgradeLevel)}</div></div>
      ${rollInputs(a, "a" + i)}
      ${canRemove(role) ? `<button class="x" data-act="remove" data-index="${i}" title="Remove affix">×</button>` : "<span></span>"}
    </div>`;
  }).join("");

  const addButtons = [];
  if (!m.unique || rules.primary[1] || rules.secondary[1]) {
    if (count("primary") < rules.primary[1] && rules.primaryPool.some((id) => !used.has(id))) addButtons.push(`<button data-act="add" data-role="primary">+ Primary</button>`);
    if (count("secondary") < rules.secondary[1] && rules.secondaryPool.some((id) => !used.has(id))) addButtons.push(`<button data-act="add" data-role="secondary">+ Secondary</button>`);
  }
  if (item._eRelicRarity === 2 && !count("special")) addButtons.push(`<button data-act="add" data-role="special">+ Special</button>`);
  if (state.anyAffix) addButtons.push(`<button data-act="add" data-role="other">+ Any affix</button>`);

  const pools = implicitPools(m.size);
  const imbueIdx = item._implicitAffixesData.findIndex((x) => x._eImplicitAffixCategory !== 3);
  const corruptIdx = item._implicitAffixesData.findIndex((x) => x._eImplicitAffixCategory === 3);
  const imbue = item._implicitAffixesData[imbueIdx], corrupt = item._implicitAffixesData[corruptIdx];
  const implicitOpts = (cat, current) => affixOptions(state.anyAffix ? Object.values(pools).flat() : pools[cat] || [], current, new Set(), item._tier);
  const hasPools = Object.keys(pools).length > 0;

  el.innerHTML = `
    <div class="ed-head">
      <div class="ed-icon item r${item._eRelicRarity}" style="position:static">${itemIcon(item) ? `<img src="${itemIcon(item)}" alt="">` : ""}</div>
      <div><h3 class="c${item._eRelicRarity}">${esc(itemName(item))}</h3>
      <div class="sub">${RARITY[item._eRelicRarity]} ${m.size} relic · ${sel.container.kind === "stash" ? "stash page " + (sel.container.index + 1) : "loadout " + TIERS[sel.container.index + 1]}${m.mr ? "" : " · not in Maxroll data"}</div></div>
      <button class="close" data-act="close" title="Deselect (Esc)">✕</button>
    </div>
    <div class="controls">
      <label>Rarity <select data-item-field="_eRelicRarity" ${m.unique ? "disabled" : ""}>${RARITY.map((r, i) => `<option value="${i}" ${i === item._eRelicRarity ? "selected" : ""} ${(i === 3) !== m.unique ? "disabled" : ""}>${r}</option>`).join("")}</select></label>
      <label>Tier <select data-item-field="_tier">${tierOpts(item._tier)}</select></label>
      <label>Upgrade <input type="number" min="0" max="10" value="${item._upgradeLevel}" data-item-field="_upgradeLevel" style="width:56px"></label>
      <label><input type="checkbox" data-item-field="_ascended" ${item._ascended ? "checked" : ""}> Ascended</label>
      <label><input type="checkbox" data-item-field="_isCorrupted" ${item._isCorrupted ? "checked" : ""}> Corrupted</label>
    </div>
    <div class="section">Affixes <span class="rules">${m.unique ? "" : `${RARITY[item._eRelicRarity]} ${m.size}: `}primary ${fmtRange(rules.primary)}, secondary ${fmtRange(rules.secondary)}${item._eRelicRarity === 2 ? ", 1 special" : ""}</span></div>
    ${countWarning(rules, count)}
    ${affixRows || '<div class="hint small">No affixes.</div>'}
    ${addButtons.length ? `<div class="add-row">${addButtons.join("")}</div>` : ""}
    <div class="section">Implicits</div>
    ${hasPools || state.anyAffix ? `
    <div class="affix-row">
      <span class="role implicit">Imbued</span>
      <div class="pick"><div class="imbue-pick">
        <select data-imbue-color>${["None", ...IMPLICIT_NAME.slice(0, 3)].map((n, i) => `<option value="${i - 1}" ${(imbue ? imbue._eImplicitAffixCategory : -1) === i - 1 ? "selected" : ""}>${n}</option>`).join("")}</select>
        ${imbue ? `<select data-implicit="${imbueIdx}">${implicitOpts(imbue._eImplicitAffixCategory, imbue._relicAffixData._relicAffixDefinitionId)}</select>` : ""}</div>
        ${imbue ? `<div class="desc">${describeAffix(imbue._relicAffixData, item._upgradeLevel)}</div>` : ""}</div>
      ${imbue ? rollInputs(imbue._relicAffixData, "i" + imbueIdx) : "<span></span><span></span>"}<span></span>
    </div>
    <div class="affix-row">
      <span class="role corrupted">Corruption</span>
      <div class="pick"><select data-corrupt>${`<option value="">None</option>` + implicitOpts(3, corrupt?._relicAffixData._relicAffixDefinitionId)}</select>
        ${corrupt ? `<div class="desc">${describeAffix(corrupt._relicAffixData, item._upgradeLevel)}</div>` : ""}</div>
      ${corrupt ? rollInputs(corrupt._relicAffixData, "i" + corruptIdx) : "<span></span><span></span>"}<span></span>
    </div>` : '<div class="hint small">This relic size has no implicit pools.</div>'}
    <label class="any"><input type="checkbox" data-any ${state.anyAffix ? "checked" : ""}> Allow any affix (ignore the game's pools; the game may not handle every combination)</label>
    <div class="actions">
      <button data-act="max">Max all rolls</button>
      <button data-act="reroll" ${m.unique && !rules.primary[1] && !rules.secondary[1] ? "disabled" : ""}>Reroll affixes</button>
      <button data-act="dup">Duplicate to stash</button>
      <button data-act="move">${sel.container.kind === "stash" ? "Equip in loadout " + TIERS[state.loadout + 1] : "Move to stash"}</button>
      <span class="grow"></span>
      <button data-act="delete" class="primary" title="Delete (Del)">Delete</button>
    </div>`;
}

const fmtRange = ([a, b]) => (a === b ? String(a) : `${a}-${b}`);

function countWarning(rules, count) {
  if (!rules.base) return "";
  const bad = ["primary", "secondary"].filter((r) => count(r) < rules[r][0] || count(r) > rules[r][1]);
  return bad.length ? `<div class="warn">Not a natural roll: ${bad.map((r) => `${count(r)} ${r} (this rarity rolls ${fmtRange(rules[r])})`).join(", ")}. The game still loads it.</div>` : "";
}

function affixByPath(item, path) {
  const i = Number(path.slice(1));
  return path[0] === "a" ? item._affixesData[i] : item._implicitAffixesData[i]._relicAffixData;
}

function allAffixes(item) { return [...item._affixesData, ...item._implicitAffixesData.map((x) => x._relicAffixData)]; }

function onEditorInput(e) {
  const sel = state.selected;
  const t = e.target;
  if (t.dataset.any !== undefined) { state.anyAffix = t.checked; return renderEditor(); }
  if (!sel) return;
  const item = sel.item;
  if (t.type === "range" && e.type === "input") {
    // Live update while dragging a roll slider, without rebuilding the editor.
    const a = affixByPath(item, t.dataset.path);
    a._rollValue = Number(t.value);
    t.closest(".affix-row").querySelector(".desc").innerHTML = describeAffix(a, item._upgradeLevel);
    setDirty(true);
    return renderStats();
  }
  if (e.type !== "change") return;
  if (t.dataset.itemField) {
    const f = t.dataset.itemField;
    if (f === "_eRelicRarity") setRarity(item, Number(t.value));
    else if (t.type === "checkbox") item[f] = t.checked;
    else item[f] = Math.max(0, Number(t.value) || 0);
    if (f === "_tier") for (const a of allAffixes(item)) a._tier = item._tier;
  } else if (t.dataset.affixIndex !== undefined) {
    item._affixesData[Number(t.dataset.affixIndex)]._relicAffixDefinitionId = Number(t.value);
    sortAffixes(item);
  } else if (t.dataset.path) {
    affixByPath(item, t.dataset.path)[t.dataset.field] = Number(t.value);
  } else if (t.dataset.imbueColor !== undefined) {
    const cat = Number(t.value);
    item._implicitAffixesData = item._implicitAffixesData.filter((x) => x._eImplicitAffixCategory === 3);
    const pool = implicitPools(relicMeta(item._relicBaseDefinitionID).size)[cat] || [];
    if (cat >= 0 && pool.length) item._implicitAffixesData.unshift({ _eImplicitAffixCategory: cat, _relicAffixData: newAffix(pool[0], item._tier) });
  } else if (t.dataset.implicit !== undefined) {
    item._implicitAffixesData[Number(t.dataset.implicit)]._relicAffixData._relicAffixDefinitionId = Number(t.value);
  } else if (t.dataset.corrupt !== undefined) {
    item._implicitAffixesData = item._implicitAffixesData.filter((x) => x._eImplicitAffixCategory !== 3);
    if (t.value) {
      item._implicitAffixesData.push({ _eImplicitAffixCategory: 3, _relicAffixData: newAffix(Number(t.value), item._tier) });
      item._isCorrupted = true;
    }
  } else return;
  setDirty(true);
  renderAll();
}

function onEditorAction(act, btn) {
  if (act === "new") return openNewRelic();
  if (act === "close") { state.selected = null; return renderAll(); }
  const sel = state.selected;
  if (!sel) return;
  const item = sel.item;
  if (act === "max") {
    for (const a of allAffixes(item)) a._rollValue = 1;
  } else if (act === "reroll") {
    rerollAffixes(item);
  } else if (act === "remove") {
    item._affixesData.splice(Number(btn.dataset.index), 1);
  } else if (act === "add") {
    const rules = relicRules(item);
    const used = new Set(item._affixesData.map((a) => a._relicAffixDefinitionId));
    const id = pickUnused(poolFor(btn.dataset.role, item, rules), used);
    if (id == null) return toast("No unused affix left in that pool.", true);
    item._affixesData.push(newAffix(id, item._tier));
    sortAffixes(item);
  } else if (act === "dup") {
    const copy = structuredClone(item);
    copy._showNotification = true;
    if (!addToStash(copy)) return toast("No free stash space.", true);
    toast("Copied to the stash.");
  } else if (act === "delete") {
    if (!confirm(`Delete ${itemName(item)}?`)) return;
    removeItem(sel.container, item);
    state.selected = null;
  } else if (act === "move") {
    if (sel.container.kind === "stash") {
      const c = { kind: "loadout", index: state.loadout };
      const pos = findSpot(c, item);
      if (!pos) return toast("No room in this loadout.", true);
      removeItem(sel.container, item);
      item._position = pos;
      containerItems(c).push(item);
      state.selected = { item, container: c };
    } else {
      removeItem(sel.container, item);
      const c = addToStash(item);
      if (!c) { containerItems(sel.container).push(item); return toast("No free stash space.", true); }
      state.selected = { item, container: c };
      state.stashPage = c.index;
    }
  }
  setDirty(true);
  renderAll();
}

// ------------------------------------------------------------------ new relic
// A non-unique relic's picture comes from its tier and size (RelicTierConfig.GetSpriteForSize); every base of a size has
// the same affix counts and pools, so the picker shows sizes at the chosen tier and uses the base matching that tier.

const SIZES = ["Small", "Large", "Exalted", "Grand"];
const newState = { rarity: 2, size: "Small", uniqueId: null, search: "", sizeFilter: "", tier: 4, upgrade: 0, roll: 100, where: "stash" };

function tierSprite(size, tier) {
  const tiers = MR.relicTiers;
  const t = tiers[Math.max(0, Math.min(tiers.length - 1, tier))];
  return t?.spritePerSize?.[size] ? img(t.spritePerSize[size]) : null;
}

function baseForSize(size, tier) {
  const bases = Object.values(relicById).filter((r) => !r.name && r.eRelicSize === size);
  return bases.find((b) => new RegExp(`_Tier${tier}(_|$)`).test(b.key)) || bases[0];
}

function uniqueChoices() {
  const list = Object.values(relicById).filter((r) => r.name).map((r) => ({ id: r.id, name: r.name.en, size: r.eRelicSize, icon: relicMeta(r.id).icon }));
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

function openNewRelic() {
  newState.uniqueId = null;
  renderNewRelic();
  $("#newDialog").showModal();
  $("#nrSearch")?.focus();
}

// Picture box with the relic's grid shape.
function shapeImg(src, size, alt, cell = 42) {
  const { w, h } = dims(size);
  return `<span class="shape" style="width:${w * cell}px;height:${h * cell}px">${src ? `<img src="${src}" alt="${esc(alt)}">` : ""}</span>`;
}

function renderNewRelic() {
  const ns = newState;
  const unique = ns.rarity === 3;
  let body;
  if (unique) {
    const q = ns.search.toLowerCase();
    const list = uniqueChoices().filter((u) => (!q || u.name.toLowerCase().includes(q)) && (!ns.sizeFilter || u.size === ns.sizeFilter));
    if (!list.some((u) => u.id === ns.uniqueId)) ns.uniqueId = list[0]?.id ?? null;
    body = `
      <div class="row">
        <input id="nrSearch" type="text" value="${esc(ns.search)}" placeholder="Search uniques, e.g. Blood Boil" spellcheck="false">
        <select id="nrSizeFilter"><option value="">All sizes</option>${SIZES.map((s) => `<option ${s === ns.sizeFilter ? "selected" : ""}>${s}</option>`).join("")}</select>
      </div>
      <div class="pick-grid uniques">${list.map((u) => `
        <button class="pick-card ${u.id === ns.uniqueId ? "active" : ""}" data-unique="${u.id}" title="${esc(u.name)} (${u.size})">
          ${shapeImg(u.icon, u.size, u.name)}<span class="pc-name c3">${esc(u.name)}</span><span class="pc-size">${u.size}</span>
        </button>`).join("") || '<div class="hint">No unique matches.</div>'}</div>`;
  } else {
    body = `<div class="pick-grid sizes">${SIZES.map((s) => `
        <button class="pick-card ${s === ns.size ? "active" : ""}" data-size="${s}">
          ${shapeImg(tierSprite(s, ns.tier), s, s, 58)}<span class="pc-name c${ns.rarity}">${RARITY[ns.rarity]} ${s} Relic</span><span class="pc-size">${dims(s).w}×${dims(s).h}</span>
        </button>`).join("")}</div>`;
  }
  $("#newBody").innerHTML = `
    <div class="rarity-tabs">${RARITY.map((r, i) => `<button class="c${i} ${i === ns.rarity ? "active" : ""}" data-rarity="${i}">${r}</button>`).join("")}</div>
    ${body}
    <div class="opts inline">
      <label>Tier <select id="nrTier">${[1, 2, 3, 4].map((n) => `<option value="${n}" ${n === ns.tier ? "selected" : ""}>${TIERS[n]}</option>`).join("")}</select></label>
      <label>Upgrade <input id="nrUpgrade" type="number" min="0" max="10" value="${ns.upgrade}" style="width:60px"></label>
      <label>Rolls <input id="nrRoll" type="range" min="1" max="100" value="${ns.roll}"> <span id="nrRollText">${ns.roll}%</span></label>
      <label>Put it in <select id="nrWhere"><option value="stash">the stash</option>${loadouts().map((_, i) => `<option value="${i}" ${String(i) === ns.where ? "selected" : ""}>relic loadout ${TIERS[i + 1]}</option>`).join("")}</select></label>
    </div>
    <p class="hint small">${unique ? "Double-click a unique to create it straight away." : "A relic's picture comes from its size and tier, like in the game."} Affixes are rolled like a drop; change any of them in the editor afterwards.</p>`;
  $("#newCreate").disabled = unique && ns.uniqueId == null;
}

function onNewRelicEvent(e) {
  const ns = newState, t = e.target;
  const card = t.closest?.("[data-unique],[data-size],[data-rarity]");
  if (e.type === "click" && card) {
    if (card.dataset.rarity) { ns.rarity = Number(card.dataset.rarity); ns.search = ""; }
    if (card.dataset.size) ns.size = card.dataset.size;
    if (card.dataset.unique) ns.uniqueId = Number(card.dataset.unique);
    renderNewRelic();
    return;
  }
  if (e.type === "dblclick" && t.closest?.("[data-unique]")) return createNewRelic();
  if (t.id === "nrSearch" && e.type === "input") {
    ns.search = t.value;
    const pos = t.selectionStart;
    renderNewRelic();
    $("#nrSearch").focus();
    $("#nrSearch").setSelectionRange(pos, pos);
    return;
  }
  if (t.id === "nrRoll") { ns.roll = Number(t.value); $("#nrRollText").textContent = t.value + "%"; return; }
  if (e.type !== "change") return;
  if (t.id === "nrSizeFilter") { ns.sizeFilter = t.value; renderNewRelic(); }
  if (t.id === "nrTier") { ns.tier = Number(t.value); renderNewRelic(); }
  if (t.id === "nrUpgrade") ns.upgrade = Math.max(0, Number(t.value) || 0);
  if (t.id === "nrWhere") ns.where = t.value;
}

function createNewRelic() {
  const ns = newState;
  ns.upgrade = Math.max(0, Number($("#nrUpgrade").value) || 0);
  const baseId = ns.rarity === 3 ? ns.uniqueId : baseForSize(ns.size, ns.tier)?.id;
  if (baseId == null) return;
  const item = {
    _relicBaseDefinitionID: baseId, _eRelicRarity: ns.rarity, _ascended: false, _upgradeLevel: ns.upgrade,
    _tier: ns.tier, _affixesData: [], _implicitAffixesData: [], _position: { x: 0, y: 0 }, _isCorrupted: false, _isDivined: false, _showNotification: true,
  };
  rerollAffixes(item, ns.roll / 100);
  let c;
  if (ns.where === "stash") c = addToStash(item);
  else {
    c = { kind: "loadout", index: Number(ns.where) };
    const pos = findSpot(c, item);
    if (pos) { item._position = pos; containerItems(c).push(item); } else c = null;
  }
  if (!c) return toast("No room there.", true);
  if (c.kind === "stash") state.stashPage = c.index; else state.loadout = c.index;
  state.selected = { item, container: c };
  $("#newDialog").close();
  setDirty(true);
  renderAll();
  toast(`Created ${itemName(item)}. Edit it below, then "Save changes" (Ctrl+S).`);
}

// ------------------------------------------------------------------ drag and drop

let drag = null;

function onPointerDown(e) {
  const el = e.target.closest(".item");
  if (!el || e.button !== 0) return;
  e.preventDefault();
  const r = el.getBoundingClientRect();
  const src = cellFor(el.parentElement);
  drag = { el, item: el._item, from: el._container, start: [e.clientX, e.clientY], grab: [(e.clientX - r.left) / src, (e.clientY - r.top) / src], moved: false, ghost: null, target: null };
}

function gridUnder(x, y) {
  for (const g of [$("#stashGrid"), $("#loadoutGrid")]) {
    const r = g.getBoundingClientRect();
    if (x >= r.left && x < r.right && y >= r.top && y < r.bottom && g.offsetParent) return g;
  }
  return null;
}

function onPointerMove(e) {
  if (!drag) {
    const el = e.target.closest?.(".item");
    if (el) showTooltip(el._item, e.clientX, e.clientY); else hideTooltip();
    return;
  }
  if (!drag.moved && Math.hypot(e.clientX - drag.start[0], e.clientY - drag.start[1]) < 5) return;
  drag.moved = true;
  hideTooltip();
  drag.el.classList.add("dragging");
  drag.target = null;
  drag.ghost?.remove();
  drag.ghost = null;
  document.querySelectorAll("button.drop").forEach((b) => b.classList.remove("drop"));
  const tab = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("#stashTabs button, #loadoutTabs button[data-loadout]");
  if (tab) { tab.classList.add("drop"); drag.target = { tab }; return; }
  const g = gridUnder(e.clientX, e.clientY);
  if (!g) return;
  const c = { kind: g.dataset.kind, index: Number(g.dataset.index) };
  const { H } = containerSize(c);
  const { w, h } = itemDims(drag.item);
  const cell = cellFor(g);
  const r = g.getBoundingClientRect();
  const x = Math.round((e.clientX - r.left) / cell - drag.grab[0]);
  const row = Math.round((e.clientY - r.top) / cell - drag.grab[1]);
  const pos = { x, y: H - row - h };
  const ok = fits(c, drag.item, pos, drag.item);
  const ghost = document.createElement("div");
  ghost.className = "ghost" + (ok ? "" : " bad");
  Object.assign(ghost.style, { left: x * cell + "px", top: row * cell + "px", width: w * cell + "px", height: h * cell + "px" });
  g.appendChild(ghost);
  drag.ghost = ghost;
  drag.target = ok ? { c, pos } : null;
}

function onPointerUp() {
  if (!drag) return;
  const d = drag;
  drag = null;
  d.ghost?.remove();
  d.el.classList.remove("dragging");
  if (!d.moved) {
    state.selected = { item: d.item, container: d.from };
    return renderAll();
  }
  if (d.target?.tab) {
    const b = d.target.tab;
    const c = b.dataset.page != null ? { kind: "stash", index: Number(b.dataset.page) } : { kind: "loadout", index: Number(b.dataset.loadout) };
    const pos = findSpot(c, d.item);
    if (!pos) { toast("No room there.", true); return renderAll(); }
    moveItem(d, c, pos);
  } else if (d.target) {
    moveItem(d, d.target.c, d.target.pos);
  }
  renderAll();
}

function moveItem(d, c, pos) {
  removeItem(d.from, d.item);
  d.item._position = pos;
  containerItems(c).push(d.item);
  state.selected = { item: d.item, container: c };
  setDirty(true);
}

// ------------------------------------------------------------------ gear and skills

function gearStatValue(s, mult) {
  const v = s.type === "Additive" ? s.value * mult : 1 + (s.value - 1) * mult;
  return `<span class="val">${fmtMod(s.stat, s.type, v)}</span>`;
}

function renderSkills() {
  const s = state.save;
  const unlocked = (s.unlockedSkills || []).map((id) => skillById[id]).filter(Boolean);
  const slots = [...(s.skillSlots || [])].sort((a, b) => a._slotIndex - b._slotIndex);
  $("#tab-skills").innerHTML = `<div class="skill-list">${slots.map((slot) => {
    const sk = skillById[slot._skillHashId];
    return `<div class="skill-card">${sk ? `<img src="${img(sk.icon)}" alt="">` : ""}<div>
      <div class="n">Slot ${slot._slotIndex + 1}</div>
      <select data-slot="${slot._slotIndex}"><option value="-1" ${slot._skillHashId === -1 ? "selected" : ""}>Empty</option>${unlocked.map((u) => `<option value="${u.id}" ${u.id === slot._skillHashId ? "selected" : ""}>${esc(u.name?.en || u.key)}</option>`).join("")}
      ${sk || slot._skillHashId === -1 ? "" : `<option selected>Unknown #${slot._skillHashId}</option>`}</select></div></div>`;
  }).join("")}</div><p class="hint small">Equipped skills. Only skills you have unlocked are offered; picking a skill that is in another slot swaps them.</p>`;
}

// ------------------------------------------------------------------ stats (formula: (base + Σadd) × Πmult × (1 + Σ(multAdd − 1)))

function collectModifiers(loadoutIndex = state.loadout) {
  const mods = [];
  const push = (stat, type, value, source) => { if (stat && value != null && isFinite(value)) mods.push({ stat, type, value, source }); };
  const s = state.save;
  if (state.sources.relics) {
    const lo = loadouts()[loadoutIndex];
    for (const item of lo?.Items || []) {
      const name = itemName(item);
      for (const a of [...item._affixesData, ...item._implicitAffixesData.map((x) => x._relicAffixData)]) {
        const def = affixById[a._relicAffixDefinitionId];
        if (def?.type !== "StatModifierAffixDefinition") continue;
        const v = rolled(def, a, item._upgradeLevel);
        push(def.eStatDefinition, def.statModifierType, v, name);
        for (const extra of def.additionalStatModifierDefinitions || [])
          push(extra.eStatDefinition, extra.statModifierType, def.applyRollToAdditionalStatModifiers ? extra.value * v : extra.value, name);
      }
    }
  }
  if (state.sources.gear) {
    const lo = s._blessedGearLoadoutsSaveData;
    const range = MR.gearRarities?.BlessedGearRarity?.range || [0.666, 1];
    for (const g of lo?._loadouts?.[state.gearLoadout]?._gear || []) {
      const def = gearById[g._gearDefinitionHashId];
      const v = def?.variants[g._variantIndex];
      if (!v) continue;
      const mult = range[0] + (range[1] - range[0]) * g._multiplier;
      for (const st of v.stats) push(st.stat, st.type, st.type === "Additive" ? st.value * mult : 1 + (st.value - 1) * mult, v.name.en);
    }
  }
  const nodeMods = (nodes, label, constellationId) => {
    for (const n of nodes || []) {
      const def = constellationId == null ? nodeByGuid[n._nodeDefinitionGuid] : nodeByConst[`${constellationId}:${n._nodeDefinitionGuid}`];
      if (!def || !n._upgradeLevel) continue;
      for (const a of def.affixes || []) {
        if (a.type !== "StatModifierNodeAffixDefinition") continue;
        const lvl = n._upgradeLevel;
        const v = a.statModifierType === "Additive" ? a.value * lvl : (a.value - 1) * lvl + 1;
        push(a.eStatDefinition, a.statModifierType, v, `${label}: ${def.name?.en || "node"}`);
      }
    }
  };
  if (state.sources.bell) nodeMods(s.greatBellSkillTreeData?._skillTreeNodes, "Great Bell");
  if (state.sources.constellations) for (const t of s.constellationsData?.skillTreesData || []) nodeMods(t._skillTreeNodes, "Constellation", t._skillTreeHashId);
  return mods;
}

function computeStats(loadoutIndex = state.loadout) {
  const byStat = {};
  for (const m of collectModifiers(loadoutIndex)) (byStat[m.stat] ||= []).push(m);
  const out = {};
  const stats = new Set([...Object.values(MR.displayedStats).flat(), ...Object.keys(byStat)]);
  for (const stat of stats) {
    const def = MR.stats[stat];
    const base = MR.statBaseOverrides?.[stat] ?? def?.baseValue ?? 0;
    let add = 0, mult = 1, ma = 0;
    for (const m of byStat[stat] || []) {
      if (m.type === "Additive") add += m.value;
      else if (m.type === "Multiplicative") mult *= m.value;
      else if (m.type === "MultiplicativeAdditive") ma += m.value - 1;
    }
    out[stat] = { base, add, mult, ma, value: (base + add) * mult * (1 + ma), mods: byStat[stat] || [] };
  }
  // Clamps may name another stat (e.g. PhysicalResistance max = MaxPhysicalResistance).
  const bound = (b, fallback, seen) => {
    if (b == null) return fallback;
    if (typeof b === "number") return b;
    return valueOf(b, seen);
  };
  const valueOf = (stat, seen = new Set()) => {
    if (!out[stat]) {
      const def = MR.stats[stat];
      if (!def) return NaN;
      const base = MR.statBaseOverrides?.[stat] ?? def.baseValue ?? 0;
      out[stat] = { base, add: 0, mult: 1, ma: 0, value: base, mods: [] };
    }
    const s = out[stat];
    if (s.clamped || seen.has(stat)) return s.value;
    seen.add(stat);
    const c = MR.stats[stat]?.clamp;
    if (c) s.value = Math.min(bound(c.max, Infinity, seen), Math.max(bound(c.min, -Infinity, seen), s.value));
    s.clamped = true;
    return s.value;
  };
  for (const stat of Object.keys(out)) valueOf(stat);
  return out;
}

function fmtStat(stat, v) {
  if (isPct(stat)) return num(v * 100, 1) + "%";
  return num(v, 2);
}

function renderStats() {
  const stats = computeStats();
  const active = state.save._relicLoadoutsSaveData._currentIndex;
  // Like Path of Building: when viewing a loadout other than the in-game one, show the difference against it.
  const base = state.loadout !== active && state.sources.relics ? computeStats(active) : null;
  $("#statLoadout").innerHTML = `<span>Relic loadout</span><div class="segmented">${loadouts().map((_, i) =>
    `<button data-stat-loadout="${i}" class="${i === state.loadout ? "active" : ""} ${i === active ? "current" : ""}" title="${i === active ? "Active in game" : ""}">${TIERS[i + 1]}</button>`).join("")}</div>
    <span class="note">${state.loadout === active ? "This is the loadout the game uses." : `Differences are against loadout ${TIERS[active + 1]}, the one the game uses.`}</span>`;
  $("#statSources").innerHTML = Object.keys(state.sources).map((k) =>
    `<label class="chip-toggle ${state.sources[k] ? "on" : ""}"><input type="checkbox" data-src="${k}" ${state.sources[k] ? "checked" : ""}>${({ relics: "Relics", gear: "Gear", bell: "Great Bell", constellations: "Constellations" })[k]}</label>`).join("");
  const q = state.statFilter.toLowerCase();
  const groups = { ...MR.displayedStats };
  const shown = new Set(Object.values(groups).flat());
  groups["Other modified stats"] = Object.keys(stats).filter((k) => !shown.has(k) && stats[k].mods.length);
  const label = (g) => ({ DamageLabel: "Damage", DefenseLabel: "Defense", VitalityLabel: "Vitality", OtherLabel: "Other" })[g] || g;
  $("#statsBody").innerHTML = Object.entries(groups).map(([g, list]) => {
    const rows = list.filter((stat) => stats[stat] && (!q || statName(stat).toLowerCase().includes(q))
      && (!state.changedOnly || stats[stat].mods.length || (base?.[stat] && base[stat].value !== stats[stat].value)));
    if (!rows.length) return "";
    return `<div class="stat-group ${state.collapsed.has(g) && !q ? "collapsed" : ""}" data-group="${esc(g)}"><h4>${esc(label(g))}</h4>${rows.map((stat) => {
      const s = stats[stat];
      return `<div class="stat-row ${s.mods.length ? "changed" : ""}" data-stat="${esc(stat)}"><span>${esc(statName(stat))}</span><span class="v">${deltaHtml(stat, s.value, base?.[stat]?.value)}${fmtStat(stat, s.value)}</span></div>`;
    }).join("")}</div>`;
  }).join("") || '<div class="muted small">No stats match.</div>';
  state.lastStats = stats;
}

// Stats where a smaller number is better (costs); their differences are coloured the other way round.
const LOWER_IS_BETTER = /ManaCost|Cost$/;

function deltaHtml(stat, value, before) {
  if (before == null || !isFinite(before) || !isFinite(value)) return "";
  const d = value - before;
  if (Math.abs(d) < 1e-9 * Math.max(1, Math.abs(before))) return "";
  const good = LOWER_IS_BETTER.test(stat) ? d < 0 : d > 0;
  return `<span class="delta ${good ? "up" : "down"}">${d > 0 ? "+" : "−"}${fmtStat(stat, Math.abs(d))}</span>`;
}

function statTooltip(stat, x, y) {
  const s = state.lastStats?.[stat];
  if (!s) return;
  const t = $("#tooltip");
  const desc = MR.stats[stat]?.description?.en;
  t.innerHTML = `<div class="title c2">${esc(statName(stat))}</div>${desc ? `<div class="meta">${esc(desc)}</div>` : ""}
    <div>Base <span class="val">${fmtStat(stat, s.base)}</span></div>
    ${s.mods.map((m) => `<div class="affix">${fmtMod(stat, m.type, m.value)} <span class="tag">${esc(m.source)}</span></div>`).join("")}
    <div class="sep"></div><div>Total <span class="val">${fmtStat(stat, s.value)}</span></div>`;
  t.classList.remove("hidden");
  const r = t.getBoundingClientRect();
  t.style.left = Math.max(8, x - r.width - 16) + "px";
  t.style.top = Math.min(y, innerHeight - r.height - 8) + "px";
}

// ------------------------------------------------------------------ Maxroll import
// A planner build holds: relics.variants[].data (cells row-major from the top-left), skills[], equipment.variants[].data
// ({SLOT: {id, rarity, variant}}), and constellations / bell variants[].data.history: one entry per point in the order
// they were spent (constellation entries are "<constellationId>-<node key>", bell entries are node GUIDs). Replaying
// the history in order keeps every step valid, so stopping when the points run out still gives a legal tree.

let importState = null;

const activeOf = (section) => section?.active ?? 0;

function planRelics(build, variantIndex, warnings) {
  const variant = build.relics?.variants?.[variantIndex];
  const items = [];
  (variant?.data || []).forEach((r, index) => {
    if (!r) return;
    const base = MR.relics[r.id];
    if (!base) { warnings.push(`Unknown relic "${r.id}" skipped.`); return; }
    const unique = !!base.name;
    const names = [...(r.affixes || [])];
    const intrinsic = base.intrinsicAffixes?.[0];
    if (unique && intrinsic && !names.includes(intrinsic)) names.unshift(intrinsic);
    if (r.special) names.unshift(r.special);
    const tier = r.tier || 4;
    const affix = (n) => {
      const a = MR.relicAffixes[n];
      if (!a) { warnings.push(`Unknown affix "${n}" on ${base.name?.en || r.id} skipped.`); return null; }
      return { _relicAffixDefinitionId: a.id, _rollValue: 1, _tier: tier, _locked: false };
    };
    const implicits = [];
    if (r.imbued) {
      const pools = MR.relicSizes[base.eRelicSize]?.implicitAffixes || {};
      const cat = ["FuryImbued", "DisciplineImbued", "FaithImbued"].find((k) => pools[k]?.includes(r.imbued)) || "FuryImbued";
      const a = affix(r.imbued);
      if (a) implicits.push({ _eImplicitAffixCategory: IMPLICIT[cat], _relicAffixData: a });
    }
    if (r.corrupted) {
      const a = affix(r.corrupted);
      if (a) implicits.push({ _eImplicitAffixCategory: 3, _relicAffixData: a });
    }
    const item = {
      _relicBaseDefinitionID: base.id, _eRelicRarity: unique ? 3 : r.special ? 2 : names.length > 1 ? 2 : 1, _ascended: false,
      _upgradeLevel: r.rank ?? 0, _tier: tier, _affixesData: names.map(affix).filter(Boolean), _implicitAffixesData: implicits,
      _position: { x: 0, y: 0 }, _isCorrupted: !!r.corrupted, _isDivined: false, _showNotification: true,
    };
    // Planner cells are indexed row-major from the top-left of the 7-wide grid; the game's y axis points up.
    const { h } = dims(base.eRelicSize);
    const pos = { x: index % LOADOUT_W, y: LOADOUT_H - Math.floor(index / LOADOUT_W) - h };
    items.push({ item, pos, label: `${base.name?.en || `${r.special ? MR.relicAffixes[r.special]?.name?.en + " " : ""}${base.eRelicSize} relic`} (T${tier} +${item._upgradeLevel})` });
  });
  return items;
}

function planGear(build, variantIndex, warnings) {
  const data = build.equipment?.variants?.[variantIndex]?.data || {};
  const pieces = [];
  for (const [slot, g] of Object.entries(data)) {
    if (!g?.id) continue;
    const def = MR.gear[g.id];
    if (!def) { warnings.push(`Unknown gear "${g.id}" skipped.`); continue; }
    const variant = Math.min(g.variant ?? 0, def.variants.length - 1);
    pieces.push({ slot: def.slot || slot, def, variant, label: `${slotName(def.slot || slot)}: ${def.variants[variant].name.en} (T${def.tier})` });
  }
  return pieces.sort((a, b) => GEAR_SLOTS.indexOf(a.slot) - GEAR_SLOTS.indexOf(b.slot));
}

function planHistory(kind, build, variantIndex, warnings) {
  const section = kind === "bell" ? build.bell : build.constellations;
  const history = section?.variants?.[variantIndex]?.data?.history || [];
  const tree = getTree(kind);
  const steps = [];
  let unknown = 0;
  for (const entry of history) {
    const alt = kind === "bell" ? stripKey(entry) : String(entry).replace(/^(\d+)-/, "$1:");
    const guid = tree.byKey.get(entry) || (tree.nodes.has(alt) ? alt : null);
    if (guid) steps.push(guid); else unknown++;
  }
  if (unknown) warnings.push(`${unknown} ${kind === "bell" ? "Great Bell" : "constellation"} point${unknown === 1 ? "" : "s"} refer to nodes this game version doesn't have and were skipped.`);
  return steps;
}

function planBuild() {
  const s = importState;
  const planner = JSON.parse(s.profile.data).planner;
  const build = planner.builds[s.buildIndex];
  const warnings = [];
  return {
    planner, build, warnings,
    items: planRelics(build, s.relicVariant, warnings),
    skills: (build.skills || []).map((x, slot) => x && { slot, def: MR.skills[x.id], level: x.level, id: x.id }).filter(Boolean),
    gear: planGear(build, s.gearVariant, warnings),
    constSteps: planHistory("const", build, s.constVariant, warnings),
    bellSteps: planHistory("bell", build, s.bellVariant, warnings),
  };
}

function variantSelect(id, section, value, count) {
  const vs = section?.variants || [];
  if (vs.length <= 1) return vs.length ? `<span class="muted small">${esc(vs[0].name)}</span>` : "";
  return `<select id="${id}">${vs.map((v, i) => `<option value="${i}" ${i === value ? "selected" : ""}>${esc(v.name)}${count ? ` (${count(v)})` : ""}</option>`).join("")}</select>`;
}

function renderImport() {
  const body = $("#importBody");
  if (!importState) { body.innerHTML = ""; $("#importApply").disabled = true; return; }
  const s = importState, o = s.opts;
  const plan = planBuild();
  s.plan = plan;
  const b = plan.build;
  const builds = plan.planner.builds;
  const unlocked = new Set(state.save.unlockedSkills || []);
  const cur = state.save._relicLoadoutsSaveData._currentIndex;
  const gearData = gearLoadoutData();
  const gearCur = gearData?._currentIndex ?? 0;
  const bellBudget = state.save.greatBellSkillTreeData._memoryLevel;
  const constBudget = treeState("const").budget;
  const section = (key, title, summary, inner) => `
    <div class="imp-sec ${o[key] ? "" : "off"}">
      <label class="imp-head"><input type="checkbox" data-imp="${key}" ${o[key] ? "checked" : ""}> <b>${title}</b> <span class="muted small">${summary}</span></label>
      ${o[key] ? `<div class="imp-body">${inner}</div>` : ""}
    </div>`;
  const list = (rows) => `<div class="preview">${rows.join("") || '<span class="muted">Nothing in this variant.</span>'}</div>`;

  body.innerHTML = `
    <div class="build-name">${esc(s.profile.name)}</div>
    <div class="hint small">Updated ${esc(s.profile.date)}${builds.length > 1 ? ` · <select id="impBuild">${builds.map((x, i) => `<option value="${i}" ${i === s.buildIndex ? "selected" : ""}>${esc(x.name || "Build " + (i + 1))}</option>`).join("")}</select>` : ""}</div>
    <div class="imp-sections">
    ${section("relics", "Relics", `${plan.items.length} relics`, `
      <div class="imp-row">${variantSelect("impRelicVariant", b.relics, s.relicVariant, (v) => v.data.filter(Boolean).length + " relics")}
        <select id="impTarget"><option value="stash" ${o.relicTarget === "stash" ? "selected" : ""}>to the stash</option>
          ${loadouts().map((_, i) => `<option value="${i}" ${String(i) === String(o.relicTarget) ? "selected" : ""}>into relic loadout ${TIERS[i + 1]} (same layout; its relics go to the stash)${i === cur ? " · active" : ""}</option>`).join("")}</select></div>
      ${list(plan.items.map((p) => `<div class="c${p.item._eRelicRarity}">${esc(p.label)}</div>`))}`)}
    ${section("skills", "Skill slots", plan.skills.map((x) => esc(x.def?.name?.en || x.id)).join(", "), `
      <div class="muted small">Each skill goes in the slot the planner uses; locked or missing skills leave the slot empty.
      ${plan.skills.filter((x) => x.def && !unlocked.has(x.def.id)).map((x) => `<span class="warn">${esc(x.def.name.en)} is locked.</span>`).join(" ")}</div>`)}
    ${section("gear", "Gear", `${plan.gear.length} pieces`, `
      <div class="imp-row">${variantSelect("impGearVariant", b.equipment, s.gearVariant, (v) => Object.keys(v.data || {}).length + " pieces")}
        <select id="impGearTarget">${(gearData?._loadouts || []).map((_, i) => `<option value="${i}" ${String(i) === String(o.gearTarget) ? "selected" : ""}>into gear loadout ${TIERS[i + 1]} (its gear goes to the gear stash)${i === gearCur ? " · active" : ""}</option>`).join("")}</select></div>
      ${list(plan.gear.map((g) => `<div>${esc(g.label)}</div>`))}`)}
    ${section("const", "Constellations", `${plan.constSteps.length} points`, `
      <div class="imp-row">${variantSelect("impConstVariant", b.constellations, s.constVariant, (v) => (v.data?.history?.length || 0) + " points")}
        <span class="${plan.constSteps.length > constBudget ? "warn" : "muted"} small">This save has ${constBudget} constellation points${plan.constSteps.length > constBudget ? ` (the build uses ${plan.constSteps.length})` : ""}.</span></div>
      <label class="small"><input type="checkbox" id="impConstCap" ${o.constCap ? "checked" : ""}> Stop when my points run out (follows the planner's order, so the result stays valid)</label>
      <div class="muted small">Replaces all your constellation points.</div>`)}
    ${section("bell", "Great Bell", `${plan.bellSteps.length} points`, `
      <div class="imp-row">${variantSelect("impBellVariant", b.bell, s.bellVariant, (v) => (v.data?.history?.length || 0) + " points")}
        <span class="${plan.bellSteps.length > bellBudget ? "warn" : "muted"} small">Memory level ${bellBudget}${plan.bellSteps.length > bellBudget ? `: the build needs ${plan.bellSteps.length}, so the last ${plan.bellSteps.length - bellBudget} points are left out` : ""}.</span></div>
      <div class="muted small">Replaces all your Great Bell points, spending them in the planner's order.</div>`)}
    </div>
    ${plan.warnings.length ? `<div class="preview">${plan.warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join("")}</div>` : ""}
    <p class="hint small">Relic and gear rolls are set to maximum (the planner doesn't store rolls). Nothing is written until you click "Save changes".</p>`;
  $("#importApply").disabled = !["relics", "skills", "gear", "const", "bell"].some((k) => o[k]);
}

async function fetchImport() {
  const ref = $("#importUrl").value.trim();
  if (!ref) return;
  $("#importBody").innerHTML = '<div class="muted">Fetching…</div>';
  let json;
  try { json = await fetchProfile(ref); } catch (e) { $("#importBody").innerHTML = `<div class="warn">${esc(e.message)}</div>`; return; }
  const build = JSON.parse(json.data).planner.builds[0];
  importState = {
    profile: json, buildIndex: 0,
    relicVariant: activeOf(build.relics), gearVariant: activeOf(build.equipment), constVariant: activeOf(build.constellations), bellVariant: activeOf(build.bell),
    opts: {
      relics: true, skills: false, gear: true, const: true, bell: true, constCap: false,
      relicTarget: String(state.save._relicLoadoutsSaveData._currentIndex), gearTarget: String(gearLoadoutData()?._currentIndex ?? 0),
    },
  };
  localSet("lastImport", ref);
  renderImport();
}

function onImportEvent(e) {
  const s = importState;
  if (!s) return;
  const t = e.target;
  if (t.dataset.imp) s.opts[t.dataset.imp] = t.checked;
  else if (t.id === "impBuild") { s.buildIndex = Number(t.value); const b = JSON.parse(s.profile.data).planner.builds[s.buildIndex]; Object.assign(s, { relicVariant: activeOf(b.relics), gearVariant: activeOf(b.equipment), constVariant: activeOf(b.constellations), bellVariant: activeOf(b.bell) }); }
  else if (t.id === "impRelicVariant") s.relicVariant = Number(t.value);
  else if (t.id === "impGearVariant") s.gearVariant = Number(t.value);
  else if (t.id === "impConstVariant") s.constVariant = Number(t.value);
  else if (t.id === "impBellVariant") s.bellVariant = Number(t.value);
  else if (t.id === "impTarget") { s.opts.relicTarget = t.value; return; }
  else if (t.id === "impGearTarget") { s.opts.gearTarget = t.value; return; }
  else if (t.id === "impConstCap") { s.opts.constCap = t.checked; return; }
  else return;
  renderImport();
}

// Replays a planner history onto a tree: clears it, then adds one level per step (capped at each node's max level),
// stopping at the budget when asked.
function replayTree(kind, steps, budget) {
  const tree = getTree(kind);
  for (const n of treeSaveNodes(kind)) n._upgradeLevel = 0;
  const levels = new Map();
  let spent = 0;
  for (const guid of steps) {
    if (budget != null && spent >= budget) break;
    const lvl = levels.get(guid) || 0;
    if (lvl >= (tree.nodes.get(guid).def.maxLevel || 1)) continue;
    levels.set(guid, lvl + 1);
    spent++;
  }
  for (const [guid, lvl] of levels) setNodeLevel(kind, tree, guid, lvl);
  return { spent, skipped: steps.length - spent, invalid: treeState(kind).invalid.length };
}

function applyImport() {
  const s = importState, plan = s?.plan;
  if (!plan) return;
  const o = s.opts;
  const done = [];
  const pagesBefore = stashPages().length;
  if (o.relics && plan.items.length) {
    let placed = 0, stashed = 0;
    if (o.relicTarget === "stash") {
      for (const p of plan.items) if (addToStash(p.item)) placed++;
    } else {
      const c = { kind: "loadout", index: Number(o.relicTarget) };
      for (const old of [...containerItems(c)]) { removeItem(c, old); if (addToStash(old)) stashed++; }
      for (const p of plan.items) {
        if (fits(c, p.item, p.pos)) { p.item._position = p.pos; containerItems(c).push(p.item); placed++; }
        else if (addToStash(p.item)) placed++;
      }
      state.loadout = c.index;
    }
    done.push(`${placed} relics${stashed ? ` (${stashed} old ones to the stash)` : ""}`);
  }
  if (o.skills) {
    // The skill bar needs every slot to exist (0..count-1); a slot without a skill is -1. The planner's list index is the slot.
    const unlocked = new Set(state.save.unlockedSkills || []);
    for (const slot of state.save.skillSlots) {
      const x = plan.skills.find((k) => k.slot === slot._slotIndex);
      slot._skillHashId = x?.def && unlocked.has(x.def.id) ? x.def.id : -1;
    }
    done.push("skill slots");
  }
  if (o.gear && plan.gear.length && gearLoadoutData()) {
    const lo = gearLoadoutData()._loadouts[Number(o.gearTarget)];
    const stash = (state.save._blessedGearStashData ||= { _gearData: [] })._gearData;
    let moved = 0;
    for (const g of plan.gear) {
      const old = gearOf(lo, g.slot);
      if (old) { lo._gear.splice(lo._gear.indexOf(old), 1); stash.unshift(old); moved++; }
      lo._gear.push({ _guid: uuid(), _gearDefinitionHashId: g.def.id, _multiplier: 1, _variantIndex: g.variant, _hasNotification: false });
    }
    state.gearLoadout = Number(o.gearTarget);
    done.push(`${plan.gear.length} gear pieces${moved ? ` (${moved} old ones to the gear stash)` : ""}`);
  }
  const treeNote = (name, r) => `${r.spent} ${name} points${r.skipped ? ` (${r.skipped} left out)` : ""}${r.invalid ? `, ${r.invalid} not connected` : ""}`;
  if (o.const && plan.constSteps.length) done.push(treeNote("constellation", replayTree("const", plan.constSteps, o.constCap ? treeState("const").budget : null)));
  if (o.bell && plan.bellSteps.length) done.push(treeNote("Great Bell", replayTree("bell", plan.bellSteps, state.save.greatBellSkillTreeData._memoryLevel)));
  setDirty(true);
  $("#importDialog").close();
  renderAll();
  const newPages = stashPages().length - pagesBefore;
  toast(`Imported ${done.join(", ") || "nothing"}${newPages ? `; the stash was full, so ${newPages} temporary page${newPages > 1 ? "s were" : " was"} added` : ""}. Click "Save changes" (Ctrl+S) to write the save.`);
}

// ------------------------------------------------------------------ gear
// Blessed gear loadouts hold one piece per slot (an empty slot has no entry). A piece's stats are the variant's
// values scaled by the rarity multiplier range remapped from its roll (RuntimeGear.RarityMultiplier).

const GEAR_SLOTS = ["WEAPON", "HELMET", "SHOULDERS", "ARMOR", "BRACERS", "PANTS", "BOOTS", "RING_LEFT", "RING_RIGHT", "TRINKET", "ACCESSORY"];
const gearLoadoutData = () => state.save._blessedGearLoadoutsSaveData;
const gearOf = (loadout, slot) => (loadout?._gear || []).find((g) => gearById[g._gearDefinitionHashId]?.slot === slot);
const slotName = (slot) => MR.blessedGearSlots[slot]?.name?.en || slot;
const gearRange = () => MR.gearRarities?.BlessedGearRarity?.range || [0.666, 1];
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 3) | 8).toString(16);
}));

function gearStatsHtml(g) {
  const def = gearById[g._gearDefinitionHashId];
  const v = def?.variants[g._variantIndex] || def?.variants[0];
  if (!v) return "";
  const range = gearRange();
  const mult = range[0] + (range[1] - range[0]) * g._multiplier;
  return v.stats.map((s) => `${gearStatValue(s, mult)} ${esc(statName(s.stat))}`).join("<br>");
}

// "Act1_Boots_BlessedT2" -> "Act 1", "EndGame_..." -> "Endgame"
const gearSource = (d) => { const p = d.key.split("_")[0]; return p === "EndGame" ? "Endgame" : p.replace(/(\D)(\d)/, "$1 $2"); };

function gearChoices(slot) {
  return Object.values(gearById).filter((g) => g.slot === slot && g.blessed).sort((a, b) => b.tier - a.tier || a.id - b.id);
}

function renderGear() {
  const data = gearLoadoutData();
  if (!data) { $("#tab-gear").innerHTML = '<p class="muted">This save has no blessed gear.</p>'; return; }
  const cur = data._currentIndex;
  const lo = data._loadouts[state.gearLoadout] || data._loadouts[cur];
  const sel = state.gearSlot;
  const slotCard = (slot) => {
    const g = gearOf(lo, slot);
    const def = g && gearById[g._gearDefinitionHashId];
    const v = def && (def.variants[g._variantIndex] || def.variants[0]);
    return `<button class="gear-slot ${slot === sel ? "active" : ""} ${g ? "" : "empty"}" data-gear-slot="${slot}">
      <span class="gs-icon">${v ? `<img src="${img(v.sprite)}" alt="">` : "＋"}</span>
      <span class="gs-text"><span class="gs-slot">${esc(slotName(slot))}${def ? ` · T${def.tier}` : ""}</span>
        <span class="gs-name">${v ? esc(v.name.en) : "Empty"}</span>
        ${g ? `<span class="gs-stats">${gearStatsHtml(g)}</span>` : ""}</span>
    </button>`;
  };
  $("#tab-gear").innerHTML = `
    <div class="loadout-bar">
      <div class="segmented">${data._loadouts.map((l, i) => `<button data-gear-loadout="${i}" class="${i === state.gearLoadout ? "active" : ""} ${i === cur ? "current" : ""}" title="Gear loadout ${TIERS[i + 1]}: ${l._gear.length} pieces${i === cur ? " (active in game)" : ""}">${TIERS[i + 1]}</button>`).join("")}</div>
      <span class="info">${state.gearLoadout === cur ? "<b>●</b> Active in game" : `Game uses gear loadout ${TIERS[cur + 1]}`} · ${lo._gear.length}/${GEAR_SLOTS.length} slots</span>
      ${state.gearLoadout === cur ? "" : `<button data-gear-act="use" class="accent">Use in game</button>`}
    </div>
    <div class="gear-split">
      <div class="gear-doll">${GEAR_SLOTS.map(slotCard).join("")}</div>
      <div class="gear-editor">${sel ? gearEditorHtml(lo, sel) : '<div class="editor empty"><div class="big">No slot selected</div>Click a slot to change its gear, roll or variant, or to equip something from your gear stash.</div>'}</div>
    </div>`;
}

function gearEditorHtml(lo, slot) {
  const g = gearOf(lo, slot);
  const stash = state.save._blessedGearStashData?._gearData || [];
  const inStash = stash.filter((x) => gearById[x._gearDefinitionHashId]?.slot === slot)
    .sort((a, b) => gearById[b._gearDefinitionHashId].tier - gearById[a._gearDefinitionHashId].tier || b._multiplier - a._multiplier);
  const range = gearRange();
  let body;
  if (g) {
    const def = gearById[g._gearDefinitionHashId];
    const mult = range[0] + (range[1] - range[0]) * g._multiplier;
    body = `
      <div class="controls">
        <label>Item <select data-gear-field="def">${gearChoices(slot).map((d) => `<option value="${d.id}" ${d.id === def.id ? "selected" : ""}>T${d.tier} · ${gearSource(d)} · ${esc(d.variants.map((v) => v.name.en).slice(0, 2).join(" / "))}${d.variants.length > 2 ? " …" : ""}</option>`).join("")}</select></label>
        <label>Variant <select data-gear-field="variant">${def.variants.map((v, i) => `<option value="${i}" ${i === g._variantIndex ? "selected" : ""}>${esc(v.name.en)}: ${esc(v.stats.map((s) => statName(s.stat)).join(", "))}</option>`).join("")}</select></label>
      </div>
      <div class="gear-roll">
        <label>Roll <input type="range" min="0" max="1" step="0.01" value="${g._multiplier}" data-gear-field="roll"></label>
        <span class="muted small">${Math.round(g._multiplier * 100)}% · stats ×${num(mult, 3)}</span>
      </div>
      <div class="gear-stats-big">${gearStatsHtml(g)}</div>
      <div class="actions"><button data-gear-act="max">Max roll</button><span class="grow"></span><button data-gear-act="unequip">Unequip to gear stash</button></div>`;
  } else {
    body = `<div class="muted">Nothing equipped. <button data-gear-act="new" class="accent">＋ Equip a new ${esc(slotName(slot))}</button></div>`;
  }
  return `<div class="editor">
    <div class="ed-head"><div><h3 class="c2">${esc(slotName(slot))}</h3><div class="sub">Gear loadout ${TIERS[state.gearLoadout + 1]}</div></div>
      <button class="close" data-gear-act="close" title="Close">✕</button></div>
    ${body}
    <div class="section">Gear stash <span class="rules">${inStash.length} ${esc(slotName(slot))}${inStash.length === 1 ? "" : "s"}</span></div>
    <div class="gear-stash">${inStash.map((x) => {
      const d = gearById[x._gearDefinitionHashId];
      const v = d.variants[x._variantIndex] || d.variants[0];
      return `<div class="gear-card"><img src="${img(v.sprite)}" alt=""><div class="gc-body"><div class="n">${esc(v.name.en)}</div>
        <div class="s">T${d.tier} · roll ${Math.round(x._multiplier * 100)}%</div><div class="s">${gearStatsHtml(x)}</div></div>
        <button data-gear-act="equip" data-guid="${x._guid}">Equip</button></div>`;
    }).join("") || '<div class="muted small">No gear for this slot in the stash.</div>'}</div>
  </div>`;
}

function onGearEvent(e) {
  const data = gearLoadoutData();
  if (!data) return;
  const t = e.target;
  const lo = data._loadouts[state.gearLoadout];
  if (e.type === "click") {
    const lb = t.closest("[data-gear-loadout]");
    if (lb) { state.gearLoadout = Number(lb.dataset.gearLoadout); return renderAll(); }
    const sb = t.closest("[data-gear-slot]");
    if (sb) {
      state.gearSlot = sb.dataset.gearSlot === state.gearSlot ? null : sb.dataset.gearSlot;
      renderGear();
      // When the editor sits below the slots (narrow panel), bring it into view.
      if (state.gearSlot) $("#tab-gear .gear-editor").scrollIntoView({ block: "nearest", behavior: "smooth" });
      return;
    }
    const ab = t.closest("[data-gear-act]");
    if (!ab) return;
    const act = ab.dataset.gearAct, slot = state.gearSlot;
    const g = slot && gearOf(lo, slot);
    const stash = (state.save._blessedGearStashData ||= { _gearData: [] })._gearData;
    if (act === "close") { state.gearSlot = null; return renderGear(); }
    if (act === "use") data._currentIndex = state.gearLoadout;
    else if (act === "max" && g) g._multiplier = 1;
    else if (act === "unequip" && g) { lo._gear.splice(lo._gear.indexOf(g), 1); stash.unshift(g); toast(`${slotName(slot)} moved to the gear stash.`); }
    else if (act === "equip") {
      const i = stash.findIndex((x) => x._guid === ab.dataset.guid);
      if (i < 0) return;
      const [piece] = stash.splice(i, 1);
      if (g) { lo._gear.splice(lo._gear.indexOf(g), 1, piece); stash.splice(i, 0, g); } else lo._gear.push(piece);
    } else if (act === "new") {
      const d = gearChoices(slot)[0];
      if (!d) return;
      lo._gear.push({ _guid: uuid(), _gearDefinitionHashId: d.id, _multiplier: 1, _variantIndex: 0, _hasNotification: false });
    } else return;
    setDirty(true);
    return renderAll();
  }
  const f = t.dataset.gearField;
  if (!f) return;
  const g = gearOf(lo, state.gearSlot);
  if (!g) return;
  if (f === "roll") {
    g._multiplier = Number(t.value);
    setDirty(true);
    if (e.type === "input") {
      const range = gearRange();
      t.closest(".gear-roll").querySelector(".small").textContent = `${Math.round(g._multiplier * 100)}% · stats ×${num(range[0] + (range[1] - range[0]) * g._multiplier, 3)}`;
      $("#tab-gear .gear-stats-big").innerHTML = gearStatsHtml(g);
      renderStats();
      return;
    }
    return renderAll();
  }
  if (e.type !== "change") return;
  if (f === "def") { g._gearDefinitionHashId = Number(t.value); g._variantIndex = Math.min(g._variantIndex, gearById[g._gearDefinitionHashId].variants.length - 1); }
  if (f === "variant") g._variantIndex = Number(t.value);
  setDirty(true);
  renderAll();
}

// ------------------------------------------------------------------ skill trees: Great Bell and constellations
// Rules (SkillTreeNode): a node can be upgraded when it is a root or when a linked node (links work both ways) has at
// least the link's pointsToUnlock levels; every level costs 1 point. A constellation also needs devotion
// (its conditions), which comes from DevotionIncrement nodes and from mastering (fully allocating) constellations.
// Great Bell points = memory level; constellation points = starting + campaign bonus + earned (constellationPoints).

const DEVOTION = { Red: "Fury", Blue: "Faith", Green: "Discipline" };
const treeCache = {};
const treeView = {};                 // per tree: { x, y, k } pan and zoom
const stripKey = (k) => String(k).replace(/^\d+-/, "");

function bellDefinition() {
  const saved = new Set(state.save.greatBellSkillTreeData._skillTreeNodes.map((n) => n._nodeDefinitionGuid));
  return Object.values(MR.skillTrees)
    .map((t) => ({ t, hits: Object.values(t.nodes || {}).filter((n) => saved.has(n.GUID)).length }))
    .sort((a, b) => b.hits - a.hits)[0]?.t;
}

function getTree(kind) {
  if (treeCache[kind]) return treeCache[kind];
  const nodes = new Map(), adj = new Map(), groups = [], byKey = new Map();
  const add = (a, b, pts) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push({ to: b, pts }); adj.get(b).push({ to: a, pts });
  };
  if (kind === "bell") {
    for (const [key, n] of Object.entries(bellDefinition()?.nodes || {})) {
      nodes.set(n.GUID, { guid: n.GUID, saveGuid: n.GUID, def: n, x: n.position[0], y: n.position[1], group: null });
      byKey.set(key, n.GUID);
    }
  } else {
    for (const c of Object.values(MR.constellations)) {
      const [cx, cy] = c.position || [0, 0];
      const g = { id: c.id, def: c, x: cx, y: cy, w: c.width || 400, h: c.height || 400, nodes: [] };
      groups.push(g);
      for (const [key, n] of Object.entries(c.nodes || {})) {
        // GUIDs repeat across constellations, so nodes are identified by "<constellation id>:<GUID>".
        const id = `${c.id}:${n.GUID}`;
        byKey.set(key, id);
        // Node positions are sky-map coordinates (y down, like the game's UI), not relative to the constellation.
        nodes.set(id, { guid: id, saveGuid: n.GUID, def: n, x: n.position[0], y: n.position[1], group: g });
        g.nodes.push(id);
      }
    }
  }
  for (const nd of nodes.values()) for (const e of nd.def.edges || []) {
    const to = byKey.get(e.node) || (kind === "bell" ? stripKey(e.node) : String(e.node).replace(/^(\d+)-/, "$1:"));
    if (nodes.has(to)) add(nd.guid, to, e.pointsToUnlock ?? 1);
  }
  return (treeCache[kind] = { kind, nodes, adj, groups, byKey });
}

function treeSaveNodes(kind) {
  if (kind === "bell") return state.save.greatBellSkillTreeData._skillTreeNodes;
  return (state.save.constellationsData?.skillTreesData || []).flatMap((t) => t._skillTreeNodes);
}

function setNodeLevel(kind, tree, nodeId, level) {
  const nd = tree.nodes.get(nodeId);
  const guid = nd.saveGuid;
  let list;
  if (kind === "bell") list = state.save.greatBellSkillTreeData._skillTreeNodes;
  else {
    const id = nd.group.id;
    const all = (state.save.constellationsData.skillTreesData ||= []);
    let t = all.find((x) => x._skillTreeHashId === id);
    if (!t) all.push(t = { _skillTreeHashId: id, _skillTreeNodes: [] });
    list = t._skillTreeNodes;
  }
  const n = list.find((x) => x._nodeDefinitionGuid === guid);
  if (n) n._upgradeLevel = level; else list.push({ _nodeDefinitionGuid: guid, _upgradeLevel: level });
}

function devotionOf(tree, levels, open) {
  const dev = { Red: 0, Blue: 0, Green: 0 };
  for (const g of tree.groups) {
    if (!open.has(g.id)) continue;
    let mastered = g.nodes.length > 0;
    for (const guid of g.nodes) {
      const nd = tree.nodes.get(guid), lvl = levels.get(guid) || 0;
      if (lvl < (nd.def.maxLevel || 1)) mastered = false;
      for (const a of nd.def.affixes || []) if (a.type === "DevotionIncrementNodeAffixDefinition") dev[a.eDevotionCategory] = (dev[a.eDevotionCategory] || 0) + (a.valuePerLevel || 1) * lvl;
    }
    if (mastered) for (const [c, v] of Object.entries(g.def.masteredDevotionGranted || {})) dev[c] = (dev[c] || 0) + v;
  }
  return dev;
}

function treeState(kind) {
  const tree = getTree(kind);
  const levels = new Map();
  if (kind === "bell") {
    for (const n of state.save.greatBellSkillTreeData._skillTreeNodes) if (tree.nodes.has(n._nodeDefinitionGuid)) levels.set(n._nodeDefinitionGuid, n._upgradeLevel);
  } else {
    for (const t of state.save.constellationsData?.skillTreesData || []) for (const n of t._skillTreeNodes) {
      const id = `${t._skillTreeHashId}:${n._nodeDefinitionGuid}`;
      if (tree.nodes.has(id)) levels.set(id, n._upgradeLevel);
    }
  }
  // Devotion conditions. Starting a new constellation needs devotion from constellations that are already open
  // (fixpoint). When the game loads a save it activates every allocated node and counts all their devotion
  // (ConstellationsController), so a constellation that already has points stays open if the total devotion,
  // including its own nodes, meets its conditions. Maxroll's planner allows such trees too.
  const open = new Set();
  let dev = { Red: 0, Blue: 0, Green: 0 };
  if (kind === "const") {
    const meets = (g, d) => Object.entries(g.def.conditions || {}).every(([c, v]) => (d[c] || 0) >= v);
    for (let changed = true; changed;) {
      changed = false;
      dev = devotionOf(tree, levels, open);
      for (const g of tree.groups) if (!open.has(g.id) && meets(g, dev)) { open.add(g.id); changed = true; }
    }
    const all = new Set(tree.groups.map((g) => g.id));
    dev = devotionOf(tree, levels, all);
    for (const g of tree.groups) if (!open.has(g.id) && g.nodes.some((id) => levels.get(id)) && meets(g, dev)) open.add(g.id);
  }
  const avail = new Set();
  for (const nd of tree.nodes.values()) if (nd.def.isRoot && (!nd.group || open.has(nd.group.id))) avail.add(nd.guid);
  for (let changed = true; changed;) {
    changed = false;
    for (const nd of tree.nodes.values()) {
      if (avail.has(nd.guid) || (nd.group && !open.has(nd.group.id))) continue;
      if ((tree.adj.get(nd.guid) || []).some((e) => avail.has(e.to) && (levels.get(e.to) || 0) >= e.pts)) { avail.add(nd.guid); changed = true; }
    }
  }
  let spent = 0;
  const invalid = [];
  for (const [guid, lvl] of levels) { spent += lvl; if (lvl > 0 && !avail.has(guid)) invalid.push(guid); }
  const budget = kind === "bell" ? state.save.greatBellSkillTreeData._memoryLevel
    : constBase() + (state.save.constellationsData.constellationPoints || 0) + (state.save.constellationsData.permanentConstellationPoints || 0);
  return { tree, levels, open, dev, avail, spent, invalid, budget };
}

const constBase = () => Math.max(0, Number(localGet("constBase") || 0));

function nodeAffixText(a, level) {
  const lvl = Math.max(level, 1);
  if (a.type === "StatModifierNodeAffixDefinition") {
    const v = a.statModifierType === "Additive" ? a.value * lvl : (a.value - 1) * lvl + 1;
    return styled(esc(a.description?.en || "{0} {1}").replace("{0}", `<span class="val">${fmtMod(a.eStatDefinition, a.statModifierType, v)}</span>`).replace("{1}", esc(statName(a.eStatDefinition))));
  }
  if (a.type === "DevotionIncrementNodeAffixDefinition") return `<span class="val">+${(a.valuePerLevel || 1) * lvl}</span> ${DEVOTION[a.eDevotionCategory] || a.eDevotionCategory} Devotion`;
  const text = a.description?.en || a.type.replace(/NodeAffixDefinition$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
  return styled(esc(text).replace(/&lt;(\/?style[^&]*)&gt;/g, "<$1>").replace(/&quot;/g, '"'));
}

function nodeTooltip(kind, guid, x, y) {
  const st = treeState(kind);
  const nd = st.tree.nodes.get(guid);
  if (!nd) return;
  const lvl = st.levels.get(guid) || 0, max = nd.def.maxLevel || 1;
  const reqs = [];
  if (nd.group && !st.open.has(nd.group.id))
    reqs.push(`Needs ${Object.entries(nd.group.def.conditions || {}).map(([c, v]) => `${v} ${DEVOTION[c] || c} Devotion (have ${st.dev[c] || 0})`).join(" and ")}`);
  else if (!st.avail.has(guid))
    reqs.push("Needs " + (st.tree.adj.get(guid) || []).map((e) => `${esc(st.tree.nodes.get(e.to).def.name?.en || "a linked node")} at level ${e.pts}`).join(" or "));
  const t = $("#tooltip");
  t.innerHTML = `<div class="title ${lvl ? "c2" : ""}">${esc(nd.def.name?.en || "Node")}</div>
    <div class="meta">${nd.group ? esc(nd.group.def.name?.en) + " · " : ""}Level ${lvl}/${max}${nd.def.isRoot ? " · starting node" : ""}</div>
    ${(nd.def.affixes || []).filter((a) => !a.hideDescription).map((a) => `<div class="affix">${nodeAffixText(a, lvl)}</div>`).join("")}
    ${lvl === 0 ? '<div class="tag">Values shown at level 1.</div>' : ""}
    ${reqs.length ? `<div class="sep"></div><div class="affix corrupted">${reqs.join("<br>")}</div>` : ""}
    <div class="sep"></div><div class="tag">Click +1 · right-click −1 · Shift for max/none</div>`;
  t.classList.remove("hidden");
  const r = t.getBoundingClientRect();
  let left = x + 18, top = y + 12;
  if (left + r.width > innerWidth - 8) left = x - r.width - 18;
  if (top + r.height > innerHeight - 8) top = Math.max(8, innerHeight - r.height - 8);
  t.style.left = left + "px";
  t.style.top = top + "px";
}

function changeNode(kind, guid, delta) {
  const st = treeState(kind);
  const nd = st.tree.nodes.get(guid);
  const cur = st.levels.get(guid) || 0, max = nd.def.maxLevel || 1;
  let next = clamp(cur + delta, 0, max);
  // The Great Bell budget is exact: spend only what's left (Shift+click fills a node as far as the points go).
  if (kind === "bell" && next > cur) next = Math.min(next, cur + Math.max(0, st.budget - st.spent));
  const name = nd.def.name?.en || "that node";
  if (next === cur) {
    if (kind === "bell" && delta > 0 && cur < max && st.avail.has(guid)) toast(`No Great Bell points left (memory level ${st.budget}).`, true);
    return;
  }
  if (next > cur) {
    if (!st.avail.has(guid)) return toast(`${name} is locked. Hover it to see what it needs.`, true);
    setNodeLevel(kind, st.tree, guid, next);
    if (kind === "const" && st.spent + (next - cur) > st.budget) toast(`That's more constellation points than this save has (${st.budget}). Set the starting points in the header if the game gives you more.`, true);
  } else {
    setNodeLevel(kind, st.tree, guid, next);
    const after = treeState(kind);
    if (after.invalid.length) {
      setNodeLevel(kind, st.tree, guid, cur);
      const names = after.invalid.slice(0, 3).map((g) => after.tree.nodes.get(g).def.name?.en).join(", ");
      return toast(`Can't remove it: ${names}${after.invalid.length > 3 ? "…" : ""} depend${after.invalid.length === 1 ? "s" : ""} on it. Remove those first.`, true);
    }
  }
  setDirty(true);
  renderTree(kind);
  renderHeader();
  renderStats();
}

function respecTree(kind) {
  const st = treeState(kind);
  if (!confirm(`Remove all ${st.spent} points from the ${kind === "bell" ? "Great Bell" : "constellations"}?`)) return;
  for (const n of treeSaveNodes(kind)) n._upgradeLevel = 0;
  setDirty(true);
  renderTree(kind);
  renderHeader();
  renderStats();
}

function treeBounds(tree) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const n of tree.nodes.values()) grow(n.x, n.y);
  for (const g of tree.groups) { grow(g.x - g.w / 2, g.y - g.h / 2); grow(g.x + g.w / 2, g.y + g.h / 2); }
  return { x0: x0 - 60, y0: y0 - 60, x1: x1 + 60, y1: y1 + 60 };
}

// Constellations open on the part of the sky you use (the whole sky with "Fit"); the Great Bell shows the whole tree.
function focusBounds(kind) {
  const tree = getTree(kind);
  if (kind !== "const") return treeBounds(tree);
  const st = treeState(kind);
  const used = tree.groups.filter((g) => g.nodes.some((guid) => st.levels.get(guid)));
  if (!used.length) return treeBounds(tree);
  const b = treeBounds({ nodes: new Map(), groups: used });
  const pad = 450;
  return { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad };
}

function fitTree(kind, whole = false) {
  const svg = $(`#tab-${kind} svg`);
  if (!svg) return;
  const b = whole ? treeBounds(getTree(kind)) : focusBounds(kind);
  const w = svg.clientWidth || 600, h = svg.clientHeight || 500;
  const k = Math.min(w / (b.x1 - b.x0), h / (b.y1 - b.y0));
  treeView[kind] = { k, x: (w - (b.x1 - b.x0) * k) / 2 - b.x0 * k, y: (h - (b.y1 - b.y0) * k) / 2 - b.y0 * k };
  applyView(kind);
}

function applyView(kind) {
  const v = treeView[kind];
  const g = $(`#tab-${kind} .vp`);
  if (g && v) g.setAttribute("transform", `translate(${v.x} ${v.y}) scale(${v.k})`);
}

function renderTree(kind) {
  const el = $(`#tab-${kind}`);
  const st = treeState(kind);
  const tree = st.tree;
  const r = kind === "bell" ? 30 : 17;
  const lines = [];
  const seen = new Set();
  for (const [a, list] of tree.adj) for (const e of list) {
    const key = a < e.to ? a + e.to : e.to + a;
    if (seen.has(key)) continue;
    seen.add(key);
    const A = tree.nodes.get(a), B = tree.nodes.get(e.to);
    const la = st.levels.get(a) || 0, lb = st.levels.get(e.to) || 0;
    const cls = la && lb ? "on" : (la && st.avail.has(e.to)) || (lb && st.avail.has(a)) ? "open" : "";
    lines.push(`<line class="${cls}" x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}"/>`);
  }
  const art = kind === "const" ? tree.groups.map((g) => {
    const used = g.nodes.some((guid) => st.levels.get(guid));
    const opened = st.open.has(g.id);
    return `<g class="constellation ${used ? "used" : ""} ${opened ? "" : "closed"}">
      <image href="${img(`stars-1.2-${g.id}${used ? "-active" : ""}`)}" x="${g.x - g.w / 2}" y="${g.y - g.h / 2}" width="${g.w}" height="${g.h}" preserveAspectRatio="xMidYMid meet"/>
      <text x="${g.x}" y="${g.y - g.h / 2 + 14}">${esc(g.def.name?.en || "")}</text></g>`;
  }).join("") : "";
  const nodes = [...tree.nodes.values()].map((n) => {
    const lvl = st.levels.get(n.guid) || 0, max = n.def.maxLevel || 1;
    const s = lvl >= max ? "full" : lvl > 0 ? "part" : st.avail.has(n.guid) ? "avail" : "locked";
    const rr = n.def.importantNode ? r * 1.35 : r;
    return `<g class="node ${s} ${st.invalid.includes(n.guid) ? "invalid" : ""}" data-guid="${n.guid}" transform="translate(${n.x} ${n.y})">
      <circle r="${rr + 3}" class="ring"/>
      ${n.def.sprite ? `<image href="${img(n.def.sprite)}" x="${-rr}" y="${-rr}" width="${rr * 2}" height="${rr * 2}" clip-path="url(#nodeClip)"/>` : `<circle r="${rr}" class="blank"/>`}
      ${max > 1 || lvl ? `<text y="${rr + (kind === "bell" ? 18 : 13)}">${lvl}/${max}</text>` : ""}
    </g>`;
  }).join("");
  const devChips = kind === "const" ? Object.entries(DEVOTION).map(([c, n]) => `<span class="dev dev-${c}">${n} <b>${st.dev[c] || 0}</b></span>`).join("") : "";
  const left = st.budget - st.spent;
  el.innerHTML = `
    <div class="tree-bar">
      <span class="pts ${left < 0 ? "over" : ""}">Points <b>${st.spent}</b> / ${st.budget} <span class="muted">(${left < 0 ? `${-left} over` : `${left} left`})</span></span>
      ${kind === "bell" ? `<span class="muted small">Memory level ${st.budget}</span>` : `${devChips}
        <label class="small muted" title="Starting + campaign-completion points aren't in the save; enter what the game gives you so the total matches.">Starting points <input id="constBase" type="number" min="0" value="${constBase()}" style="width:58px"></label>`}
      ${st.invalid.length ? `<span class="warn-chip">${st.invalid.length} node${st.invalid.length === 1 ? "" : "s"} no longer connected</span>` : ""}
      <span class="spacer"></span>
      <button data-tree-act="fit" title="Fit to view">⤢ Fit</button>
      <button data-tree-act="expand" title="Bigger view">${el.classList.contains("expanded") ? "✕ Close" : "⛶ Expand"}</button>
      <button data-tree-act="respec" class="primary" ${st.spent ? "" : "disabled"}>Respec</button>
    </div>
    <svg class="tree-svg ${kind}">
      <defs><clipPath id="nodeClip" clipPathUnits="objectBoundingBox"><circle cx=".5" cy=".5" r=".5"/></clipPath></defs>
      <g class="vp">${art}<g class="links">${lines.join("")}</g>${nodes}</g>
    </svg>
    <div class="tree-help muted small">Scroll to zoom, drag to pan. Click a node to add a point, right-click to remove one; hold Shift to max it out or clear it.</div>`;
  if (treeView[kind]) applyView(kind); else fitTree(kind);
}

function wireTree(kind) {
  const el = $(`#tab-${kind}`);
  let pan = null;
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tree-act]");
    if (!b) return;
    const act = b.dataset.treeAct;
    if (act === "fit") fitTree(kind, true);
    if (act === "respec") respecTree(kind);
    if (act === "expand") { el.classList.toggle("expanded"); treeView[kind] = null; renderTree(kind); }
  });
  el.addEventListener("change", (e) => {
    if (e.target.id === "constBase") { localSet("constBase", String(Math.max(0, Number(e.target.value) || 0))); renderTree(kind); }
  });
  el.addEventListener("wheel", (e) => {
    const svg = e.target.closest("svg");
    if (!svg) return;
    e.preventDefault();
    const v = treeView[kind];
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const f = Math.exp(-e.deltaY * 0.0015);
    const k = clamp(v.k * f, 0.03, 4);
    v.x = mx - (mx - v.x) * (k / v.k);
    v.y = my - (my - v.y) * (k / v.k);
    v.k = k;
    applyView(kind);
  }, { passive: false });
  el.addEventListener("pointerdown", (e) => {
    if (!e.target.closest("svg") || (e.button !== 0 && e.button !== 2)) return;
    pan = { x: e.clientX, y: e.clientY, moved: false, node: e.target.closest(".node")?.dataset.guid, button: e.button, shift: e.shiftKey };
  });
  el.addEventListener("contextmenu", (e) => { if (e.target.closest("svg")) e.preventDefault(); });
  window.addEventListener("pointermove", (e) => {
    if (!pan) return;
    const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
    if (!pan.moved && Math.hypot(dx, dy) < 4) return;
    pan.moved = true;
    hideTooltip();
    treeView[kind].x += dx; treeView[kind].y += dy;
    pan.x = e.clientX; pan.y = e.clientY;
    applyView(kind);
  });
  window.addEventListener("pointerup", () => {
    if (!pan) return;
    const p = pan;
    pan = null;
    if (p.moved || !p.node) return;
    const up = p.button === 0;
    changeNode(kind, p.node, p.shift ? (up ? 999 : -999) : up ? 1 : -1);
  });
  el.addEventListener("mousemove", (e) => {
    if (pan?.moved) return;
    const n = e.target.closest?.(".node");
    if (n) nodeTooltip(kind, n.dataset.guid, e.clientX, e.clientY); else hideTooltip();
  });
  el.addEventListener("mouseleave", hideTooltip);
}

// ------------------------------------------------------------------ wiring

function wireUi() {
  $("#saveSelect").addEventListener("change", async (e) => {
    if (state.dirty && !confirm("Discard unsaved changes?")) { e.target.value = state.saveId; return; }
    await loadSave(e.target.value);
  });
  $("#reloadBtn").addEventListener("click", async () => {
    if (!state.entry) return;
    if (state.dirty && !confirm("Discard your unsaved changes and reload the save from disk?")) return;
    if (state.folder) state.saves = await store.listSaves(state.folder);
    renderSavePicker();
    await loadSave(state.saveId, false);
    toast("Reloaded from disk.");
  });
  $("#folderBtn").addEventListener("click", async () => {
    if (state.dirty && !confirm("Discard unsaved changes?")) return;
    await onWelcomeAction(store.canUseFolders ? "pick" : "file");
  });
  $("#saveBtn").addEventListener("click", saveToDisk);
  $("#welcome").addEventListener("click", (e) => {
    const b = e.target.closest("[data-welcome]");
    if (b) return onWelcomeAction(b.dataset.welcome);
    if (e.target.closest("[data-copy-path]")) navigator.clipboard?.writeText(SAVE_PATH).then(() => toast("Path copied."));
  });
  $("#aboutBtn").addEventListener("click", () => { renderAbout(); $("#aboutDialog").showModal(); });
  $("#aboutClose").addEventListener("click", () => $("#aboutDialog").close());
  $("#stashTabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-page]");
    if (b) { state.stashPage = Number(b.dataset.page); renderAll(); }
  });
  $("#loadoutTabs").addEventListener("click", (e) => {
    if (e.target.id === "makeActive") {
      state.save._relicLoadoutsSaveData._currentIndex = state.loadout;
      setDirty(true);
      return renderAll();
    }
    const b = e.target.closest("button[data-loadout]");
    if (b) { state.loadout = Number(b.dataset.loadout); renderAll(); }
  });
  document.querySelector(".main-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if (!b) return;
    document.querySelectorAll(".main-tabs button").forEach((x) => x.classList.toggle("active", x === b));
    for (const t of ["relics", "gear", "skills", "const", "bell"]) $("#tab-" + t).classList.toggle("hidden", t !== b.dataset.tab);
    if (b.dataset.tab === "const" || b.dataset.tab === "bell") renderTree(b.dataset.tab);
  });
  $("#editor").addEventListener("input", onEditorInput);
  $("#editor").addEventListener("change", onEditorInput);
  $("#editor").addEventListener("click", (e) => { const b = e.target.closest("button[data-act]"); if (b) onEditorAction(b.dataset.act, b); });
  $("#newBtn").addEventListener("click", () => (state.save ? openNewRelic() : toast("Open a save first.", true)));
  for (const ev of ["click", "input", "change"]) $("#tab-gear").addEventListener(ev, onGearEvent);
  wireTree("const");
  wireTree("bell");
  for (const ev of ["click", "dblclick", "input", "change"]) $("#newBody").addEventListener(ev, onNewRelicEvent);
  $("#newCreate").addEventListener("click", createNewRelic);
  $("#newCancel").addEventListener("click", () => $("#newDialog").close());
  $("#tab-skills").addEventListener("change", (e) => {
    const sel = e.target.closest("select[data-slot]");
    if (!sel) return;
    const slot = state.save.skillSlots.find((s) => s._slotIndex === Number(sel.dataset.slot));
    const id = Number(sel.value);
    const other = id !== -1 && state.save.skillSlots.find((s) => s !== slot && s._skillHashId === id);
    if (other) other._skillHashId = slot._skillHashId;
    slot._skillHashId = id;
    setDirty(true);
    renderAll();
  });
  $("#statLoadout").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-stat-loadout]");
    if (b) { state.loadout = Number(b.dataset.statLoadout); renderAll(); }
  });
  $("#statSources").addEventListener("change", (e) => { state.sources[e.target.dataset.src] = e.target.checked; renderHeader(); renderStats(); });
  $("#statFilter").addEventListener("input", (e) => { state.statFilter = e.target.value; renderStats(); });
  $("#statChangedOnly").addEventListener("change", (e) => { state.changedOnly = e.target.checked; renderStats(); });
  $("#statsBody").addEventListener("click", (e) => {
    const h = e.target.closest(".stat-group h4");
    if (!h) return;
    const g = h.parentElement.dataset.group;
    if (state.collapsed.has(g)) state.collapsed.delete(g); else state.collapsed.add(g);
    localSet("collapsed", JSON.stringify([...state.collapsed]));
    h.parentElement.classList.toggle("collapsed");
  });
  $("#stashSearch").addEventListener("input", (e) => {
    state.search = e.target.value.trim().toLowerCase();
    const pages = stashPages();
    // Jump to the first page with a match when the current one has none.
    if (state.search && !pages[state.stashPage].Items.some(matches)) {
      const i = pages.findIndex((p) => p.Items.some(matches));
      if (i >= 0) state.stashPage = i;
    }
    renderStashTabs();
    renderGrid($("#stashGrid"), { kind: "stash", index: state.stashPage });
  });
  // Poll whether the game is running, so the save button reflects it.

  $("#statsBody").addEventListener("mousemove", (e) => { const r = e.target.closest(".stat-row"); if (r) statTooltip(r.dataset.stat, e.clientX, e.clientY); else hideTooltip(); });
  $("#statsBody").addEventListener("mouseleave", hideTooltip);

  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("keydown", (e) => {
    const typing = e.target.closest?.("input,select,textarea");
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveToDisk(); return; }
    if (typing || document.querySelector("dialog[open]") || !state.save) return;
    if (e.key === "Delete" && state.selected) onEditorAction("delete");
    if (e.key === "Escape" && state.selected) { state.selected = null; renderAll(); }
    if (e.key === "/") { e.preventDefault(); $("#stashSearch").focus(); }
  });
  window.addEventListener("beforeunload", (e) => { if (state.dirty) e.preventDefault(); });
  window.addEventListener("resize", () => state.save && renderAll());

  $("#importBtn").addEventListener("click", () => {
    if (!state.save) return toast("Open a save first.", true);
    $("#importUrl").value = localGet("lastImport") || "";
    importState = null;
    renderImport();
    $("#importDialog").showModal();
  });
  $("#importFetch").addEventListener("click", fetchImport);
  $("#importUrl").addEventListener("keydown", (e) => { if (e.key === "Enter") fetchImport(); });
  $("#importCancel").addEventListener("click", () => $("#importDialog").close());
  $("#importApply").addEventListener("click", applyImport);
  $("#importBody").addEventListener("change", onImportEvent);
}

// For debugging from the console; openText(name, json) opens save text as if picked with "open a single save file".
window.hcEditor = {
  state, get drag() { return drag; }, relicRules, affixRoles, validateSave,
  async openText(name, text) {
    state.folder = null;
    state.saves = [{ id: "file/" + name, kind: "file", slot: 0, name, label: name, modified: Date.now(), text }];
    renderSavePicker();
    await loadSave("file/" + name);
  },
};
boot();
