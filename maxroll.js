// Maxroll's Hell Clock planner data, build profiles and images. All of these endpoints allow cross-origin requests,
// so the editor loads them straight from Maxroll (nothing of theirs is bundled here).

const ASSETS = "https://assets-ng.maxroll.gg/hell-clock/";
const PROFILES = "https://planners.maxroll.gg/profiles/hell-clock/";
const DATA_KEY = "hcse.maxrollDataUrl";

/** URL of one of Maxroll's game images (sprite names come from the game data). */
export const img = (name) => `${ASSETS}images/webp/${encodeURIComponent(name)}.webp`;

/**
 * Loads the planner data module. Its file name carries a content hash, so it's discovered through Maxroll's loader
 * chain (auto-loader.js -> loader-<hash>.js -> data.min-<hash>.js); the last known URL is the fallback.
 */
export async function loadGameData() {
  let url = null;
  try {
    const auto = await (await fetch(ASSETS + "auto-loader.js", { cache: "no-cache" })).text();
    const loader = auto.match(/loader-[0-9a-f]+\.js/)[0];
    const text = await (await fetch(ASSETS + loader)).text();
    url = ASSETS + text.match(/data\.min-[0-9a-f]+\.js/)[0];
    try { localStorage.setItem(DATA_KEY, url); } catch { /* private mode */ }
  } catch {
    try { url = localStorage.getItem(DATA_KEY); } catch { /* private mode */ }
  }
  if (!url) throw new Error("Maxroll couldn't be reached");
  return (await import(url)).default;
}

/** Accepts a planner link ("https://maxroll.gg/hell-clock/planner/3c5os70i") or a bare profile id. */
export function profileId(ref) {
  const m = /(?:planner\/)?([a-z0-9]{6,12})\/?(?:[?#].*)?$/i.exec(String(ref).trim());
  return m ? m[1] : null;
}

export async function fetchProfile(ref) {
  const id = profileId(ref);
  if (!id) throw new Error("Paste a Maxroll planner link like https://maxroll.gg/hell-clock/planner/3c5os70i");
  const res = await fetch(PROFILES + id);
  if (res.status === 404) throw new Error("Maxroll has no build with that link.");
  if (!res.ok) throw new Error(`Maxroll answered ${res.status}. Try again later.`);
  return res.json();
}
