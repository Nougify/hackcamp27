import { beforeEach, describe, expect, it } from "vitest";
import { loadPrefs } from "./settings";

// Minimal localStorage for the node test environment.
const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  get length() {
    return store.size;
  },
} as Storage;

describe("loadPrefs", () => {
  beforeEach(() => store.clear());

  it("migrates v1 prefs, keeping user settings but taking the new always-armed default", () => {
    store.set("mise.cook-prefs", JSON.stringify({ showCamera: false, gesture: { delegate: "CPU", alwaysArmed: false } }));
    const p = loadPrefs();
    expect(p.showCamera).toBe(false);
    expect(p.gesture.delegate).toBe("CPU");
    expect(p.gesture.alwaysArmed).toBe(true);
    expect(store.has("mise.cook-prefs")).toBe(false);
    expect(store.has("mise.cook-prefs.v2")).toBe(true);
  });

  it("v2 prefs win and keep an explicit alwaysArmed=false", () => {
    store.set("mise.cook-prefs.v2", JSON.stringify({ gesture: { alwaysArmed: false } }));
    expect(loadPrefs().gesture.alwaysArmed).toBe(false);
  });

  it("defaults when nothing is saved", () => {
    expect(loadPrefs().gesture.alwaysArmed).toBe(true);
  });
});
