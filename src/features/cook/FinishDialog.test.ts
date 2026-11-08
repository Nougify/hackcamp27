import { describe, expect, it } from "vitest";
import { finishPreviewFixture } from "@/contracts/fixtures";
import { deductible, toLines } from "./FinishDialog";

describe("finish preview lines", () => {
  const lines = toLines(finishPreviewFixture);
  const by = (status: string) => lines.filter((l) => l.status === status);

  it("pre-checks ok and clamped lines with their proposed amount", () => {
    for (const l of [...by("ok"), ...by("clamped")]) {
      expect(l.checked).toBe(true);
      expect(Number(l.qty)).toBeCloseTo(l.proposedQtyBase!, 1);
    }
  });

  it("unconvertible lines are editable but start unchecked and empty", () => {
    for (const l of by("unconvertible")) {
      expect(deductible(l)).toBe(true);
      expect(l.checked).toBe(false);
      expect(l.qty).toBe("");
    }
  });

  it("staples and unmatched lines can't be deducted", () => {
    for (const l of [...by("staple"), ...by("no_match")]) {
      expect(deductible(l)).toBe(false);
      expect(l.checked).toBe(false);
    }
  });
});
