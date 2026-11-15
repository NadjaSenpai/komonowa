import { describe, expect, it } from "vitest";
import { tagHue } from "../tagColor";

describe("タグの色", () => {
  it("同じ名前はいつも同じ色相で、0〜359 に収まる", () => {
    for (const name of ["手順", "ごはん", "API", "おでかけ"]) {
      expect(tagHue(name)).toBe(tagHue(name));
      expect(tagHue(name)).toBeGreaterThanOrEqual(0);
      expect(tagHue(name)).toBeLessThan(360);
    }
  });

  it("全角半角・大文字小文字・前後の空白が違っても同じ色", () => {
    expect(tagHue("ＡＰＩ")).toBe(tagHue("api"));
    expect(tagHue(" Api ")).toBe(tagHue("api"));
  });

  it("違う名前は、たいてい違う色になる", () => {
    const hues = new Set(["手順", "ごはん", "API", "おでかけ", "メモ", "会議", "写真", "買い物"].map(tagHue));
    expect(hues.size).toBeGreaterThanOrEqual(7);
  });
});
