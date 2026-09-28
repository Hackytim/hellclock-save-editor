// Save files. Chrome and Edge can read and write the save folder directly (File System Access API; the folder is
// remembered in IndexedDB and permission is re-requested on the next visit). Other browsers open a single save file
// and download the edited copy. Nothing is uploaded anywhere.

const DB_NAME = "hcse", STORE = "handles";
const SAVE_NAME = /^PlayerSave(\d+)\.json$/;

export const canUseFolders = typeof window.showDirectoryPicker === "function";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(key) {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const r = db.transaction(STORE).objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(undefined);
    });
  } catch { return undefined; }
}

async function dbSet(key, value) {
  try {
    const db = await openDb();
    await new Promise((resolve) => {
      const r = db.transaction(STORE, "readwrite").objectStore(STORE).put(value, key);
      r.onsuccess = resolve;
      r.onerror = resolve;
    });
  } catch { /* storage unavailable: the folder just isn't remembered */ }
}

/** The folder picked on an earlier visit, and whether access is still granted (it usually needs one click). */
export async function rememberedFolder(key = "saveDir") {
  const dir = await dbGet(key);
  if (!dir) return null;
  try { return { dir, granted: (await dir.queryPermission({ mode: "readwrite" })) === "granted" }; } catch { return null; }
}

export async function requestAccess(dir) {
  return (await dir.requestPermission({ mode: "readwrite" })) === "granted";
}

export async function pickFolder(key = "saveDir", id = "hellclock-saves") {
  const dir = await window.showDirectoryPicker({ id, mode: "readwrite" });
  await dbSet(key, dir);
  return dir;
}

/** The PlayerSave<n>.json files (one per save slot) in the save folder. */
export async function listSaves(dir) {
  const saves = [];
  for await (const [name, handle] of dir.entries()) {
    const m = SAVE_NAME.exec(name);
    if (!m || handle.kind !== "file") continue;
    const file = await handle.getFile();
    saves.push({ id: `slot/${m[1]}`, kind: "folder", slot: Number(m[1]), name, handle, folder: dir, modified: file.lastModified,
      label: `Save slot ${Number(m[1]) + 1}` });
  }
  return saves.sort((a, b) => a.slot - b.slot);
}

export async function readSave(entry) {
  const file = await entry.handle.getFile();
  return { text: await file.text(), modified: file.lastModified };
}

export async function lastModified(entry) {
  return (await entry.handle.getFile()).lastModified;
}

async function copyFile(fromFolder, name, toFolder) {
  let src;
  try { src = await (await fromFolder.getFileHandle(name)).getFile(); } catch { return; }
  const w = await (await toFolder.getFileHandle(name, { create: true })).createWritable();
  await w.write(await src.arrayBuffer());
  await w.close();
}

/** Copies the save and the game's two backups to _editor_backups/<timestamp>/, then writes the new save. */
export async function writeSave(entry, text) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
  const backups = await (await entry.folder.getDirectoryHandle("_editor_backups", { create: true })).getDirectoryHandle(stamp, { create: true });
  for (const name of [`PlayerSave${entry.slot}.json`, `PlayerSave_Bck${entry.slot}.json`, `PlayerSave_Bck${entry.slot}.bkp.json`])
    await copyFile(entry.folder, name, backups);
  const w = await entry.handle.createWritable();
  await w.write(text);
  await w.close();
  return { backup: `_editor_backups\\${stamp}`, modified: await lastModified(entry) };
}

/** Fallback for browsers without folder access: open one save file… */
export function openSaveFile() {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: ".json,application/json" });
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return resolve(null);
      const m = SAVE_NAME.exec(file.name);
      resolve({ id: "file/" + file.name, kind: "file", slot: m ? Number(m[1]) : 0, name: file.name, label: file.name,
        modified: file.lastModified, text: await file.text() });
    };
    input.click();
  });
}

/** …and download the edited copy under the same name. */
export function downloadSave(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
