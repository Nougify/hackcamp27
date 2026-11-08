import { describe, expect, it } from "vitest";
import { cookSessionViewFixture } from "@/contracts/fixtures";
import { initCookState, makeCookReducer } from "./reducer";

const steps = cookSessionViewFixture.steps;
const reduce = makeCookReducer(steps);

describe("cook reducer", () => {
  it("clamps step navigation to the recipe", () => {
    let s = reduce(initCookState(), { type: "prev" });
    expect(s.stepIndex).toBe(0);
    for (let i = 0; i < steps.length + 3; i++) s = reduce(s, { type: "next" });
    expect(s.stepIndex).toBe(steps.length - 1);
  });

  it("toggles one timer per step and keeps others running", () => {
    let s = reduce(initCookState(3), { type: "toggleTimer", now: 0 }); // "Cook the onion for 4–5 minutes"
    s = reduce(s, { type: "next" });
    s = reduce(s, { type: "toggleTimer", now: 1000 });
    expect(s.timers.map((t) => [t.stepIndex, t.status])).toEqual([[3, "running"], [4, "running"]]);
    s = reduce(s, { type: "toggleTimer", now: 2000 });
    expect(s.timers[1].status).toBe("paused");
  });

  it("tick reports fired timers once, then clears them", () => {
    let s = reduce(initCookState(3), { type: "toggleTimer", now: 0 });
    s = reduce(s, { type: "tick", now: 240_000 });
    expect(s.fired).toHaveLength(1);
    s = reduce(s, { type: "tick", now: 241_000 });
    expect(s.fired).toHaveLength(0);
  });

  it("restore clamps a stale step index", () => {
    expect(reduce(initCookState(), { type: "restore", stepIndex: 99, timers: [] }).stepIndex).toBe(steps.length - 1);
  });
});
