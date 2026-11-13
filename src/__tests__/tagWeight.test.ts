import { describe, expect, it } from "vitest";
import { tagWeight } from "../tagWeight";

describe("tagWeight", () => {
  it("最小の件数は 0、最大は 1", () => {
    expect(tagWeight(1, 1, 20)).toBe(0);
    expect(tagWeight(20, 1, 20)).toBe(1);
  });

  it("対数で重み付けし、1 件の差が大きく効きすぎない", () => {
    const mid = tagWeight(4, 1, 16);
    expect(mid).toBeCloseTo(0.5, 5);
  });

  it("全部同じ件数なら中間の重み", () => {
    expect(tagWeight(3, 3, 3)).toBe(0.5);
  });
});
