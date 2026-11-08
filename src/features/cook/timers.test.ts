import { describe, expect, it } from "vitest";
import { createTimer, formatMs, parseDurationSeconds, settleTimers, timerMs, toggleTimer } from "./timers";

describe("parseDurationSeconds", () => {
  it.each([
    ["Simmer for 10–15 minutes", 600],
    ["Simmer for 10-15 minutes", 600],
    ["Simmer for 10 to 15 mins", 600],
    ["Bake for 1 hour 15 minutes", 4500],
    ["Bake for 1 hour and 15 minutes", 4500],
    ["Microwave 30 seconds", 30],
    ["Rest 1.5 hrs", 5400],
    ["Bake 20 minutes, then rest 5 minutes", 1200],
    ["Season to taste", null],
    ["Preheat the oven to 200°C (400°F).", null],
  ])("%s → %s", (text, secs) => expect(parseDurationSeconds(text)).toBe(secs));
});

describe("timers", () => {
  const t0 = 1_000_000;

  it("countdown remaining is derived from endsAt", () => {
    const t = toggleTimer(createTimer(3, "Simmer for 10–15 minutes", null), t0);
    expect(t.status).toBe("running");
    expect(t.endsAt).toBe(t0 + 600_000);
    expect(timerMs(t, t0 + 61_000)).toBe(539_000);
  });

  it("pause and resume keeps the remaining time", () => {
    let t = toggleTimer(createTimer(0, "Cook 10 minutes", null), t0);
    t = toggleTimer(t, t0 + 60_000); // pause with 9 min left
    expect(t.status).toBe("paused");
    expect(timerMs(t, t0 + 999_999)).toBe(540_000);
    t = toggleTimer(t, t0 + 120_000); // resume
    expect(t.endsAt).toBe(t0 + 660_000);
  });

  it("uses the contract timerSeconds over the text", () => {
    expect(createTimer(0, "Cook until done", 90).durationMs).toBe(90_000);
  });

  it("steps without a duration get a stopwatch", () => {
    let t = createTimer(1, "Season to taste", null);
    expect(t.kind).toBe("stopwatch");
    t = toggleTimer(t, t0);
    expect(timerMs(t, t0 + 5_000)).toBe(5_000);
    t = toggleTimer(t, t0 + 5_000);
    t = toggleTimer(t, t0 + 50_000);
    expect(timerMs(t, t0 + 52_000)).toBe(7_000);
  });

  it("settle fires elapsed countdowns once, even long after (hidden tab)", () => {
    const t = toggleTimer(createTimer(0, "Boil 1 minute", null), t0);
    const first = settleTimers([t], t0 + 120_000);
    expect(first.fired).toHaveLength(1);
    expect(first.timers[0].status).toBe("done");
    expect(settleTimers(first.timers, t0 + 130_000).fired).toHaveLength(0);
  });

  it("formats", () => {
    expect(formatMs(600_000)).toBe("10:00");
    expect(formatMs(4_500_000)).toBe("1:15:00");
    expect(formatMs(400)).toBe("0:01");
  });
});
