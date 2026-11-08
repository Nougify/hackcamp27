import type { GestureConfig } from "@/contracts";
import { DEFAULT_GESTURE_CONFIG } from "./config";

// Per-device cook-mode settings in localStorage (decided: no DB column, no /api/me change).
export interface CookPrefs {
  gesture: GestureConfig;
  showCamera: boolean;
  autoRead: boolean;
}

// v2: alwaysArmed became the default. v1 prefs are migrated once without their alwaysArmed value.
const KEY = "mise.cook-prefs.v2";
const OLD_KEY = "mise.cook-prefs";
export const DEFAULT_PREFS: CookPrefs = { gesture: DEFAULT_GESTURE_CONFIG, showCamera: true, autoRead: false };

export function loadPrefs(): CookPrefs {
  try {
    let saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<CookPrefs> | null;
    if (!saved) {
      saved = JSON.parse(localStorage.getItem(OLD_KEY) ?? "null") as Partial<CookPrefs> | null;
      if (!saved) return DEFAULT_PREFS;
      if (saved.gesture) delete (saved.gesture as Partial<GestureConfig>).alwaysArmed; // take the new default
      localStorage.setItem(KEY, JSON.stringify(saved));
      localStorage.removeItem(OLD_KEY);
    }
    // Merge over defaults so new config fields added later still get values.
    return { ...DEFAULT_PREFS, ...saved, gesture: { ...DEFAULT_GESTURE_CONFIG, ...saved.gesture } };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: CookPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {}
}
