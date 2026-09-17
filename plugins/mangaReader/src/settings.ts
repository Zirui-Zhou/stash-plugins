/**
 * What the reader remembers, between sessions.
 *
 * **Per browser, not per Stash install, and that is deliberate.** These are
 * reading preferences, and the switches they sit beside in the lightbox's own
 * options menu (fit, zoom, scroll mode) are stored the same way — Stash keeps them
 * in its per-browser interface settings, not in the server's configuration. A
 * plugin that put its switches in the server config would make the one menu they
 * all live in behave in two different ways.
 *
 * `localStorage` rather than Stash's own store, which is localForage behind a hook
 * this plugin cannot reach. A separate key means nothing here can corrupt the
 * settings Stash owns, and nothing Stash does can drop ours.
 */
import { NR, type MangaReaderSettings } from "./plugin-api";

const STORAGE_KEY = "mangaReader.settings";

/**
 * The settings a browser that has never been asked reads as.
 *
 * The mode itself is **off**. The lightbox is used for every kind of image in
 * Stash, so a plugin that rearranged all of them by default would be changing
 * something the reader never asked for; the other two describe how *spreads* are
 * put together once the mode is on, so they start in the position that suits a
 * manga.
 */
export const DEFAULT_SETTINGS: MangaReaderSettings = {
  doublePage: false,
  coverAlone: true,
  detectSpreads: true,
};

/**
 * Reads settings out of stored JSON, taking only what is recognised.
 *
 * A hand-edited or half-written value must not leave the reader with a setting
 * that is neither true nor false, so every field is checked rather than trusted —
 * and an absent field falls back to its default, which is what makes adding one
 * later harmless for a browser that already has a stored object.
 */
export function parseSettings(raw: string | null): MangaReaderSettings {
  const stored = ((): Record<string, unknown> => {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      // Not JSON: someone edited it by hand, or storage is holding another
      // plugin's value. Defaults are the only safe reading.
      return {};
    }
  })();

  const flag = (key: keyof MangaReaderSettings): boolean =>
    typeof stored[key] === "boolean"
      ? (stored[key] as boolean)
      : DEFAULT_SETTINGS[key];

  return {
    doublePage: flag("doublePage"),
    coverAlone: flag("coverAlone"),
    detectSpreads: flag("detectSpreads"),
  };
}

/** What this browser is set to. Read fresh each time: it is cheap and always current. */
export function readSettings(): MangaReaderSettings {
  try {
    return parseSettings(window.localStorage.getItem(STORAGE_KEY));
  } catch (e) {
    // Storage can be unavailable (a browser with it switched off, a sandboxed
    // frame). That is not a reason to stop reading — the defaults are a working
    // configuration, just not a remembered one.
    console.error(
      "[mangaReader] settings are not readable, using defaults:",
      e
    );
    return { ...DEFAULT_SETTINGS };
  }
}

/** Remembers the settings, and returns what was written. */
export function writeSettings(
  next: Partial<MangaReaderSettings>
): MangaReaderSettings {
  const merged = { ...readSettings(), ...next };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch (e) {
    console.error("[mangaReader] settings are not writable:", e);
  }

  return merged;
}

NR.parseSettings = parseSettings;
