import { describe, expect, it } from "vitest";
import { parseTagInput, suggestTags } from "../tagSuggestions";

describe("タグ入力", () => {
  it("区切り・#・全半角の重複をまとめる", () => {
    expect(parseTagInput("#運用, 手順　運用、ＡＰＩ api")).toEqual(["運用", "手順", "API"]);
  });
  it("選択済みを除き、全半角を無視して一致し、使用数の多い順", () => {
    const tags = [
      { id: "1", name: "API", count: 2 },
      { id: "2", name: "API設計", count: 9 },
      { id: "3", name: "その他", count: 5 },
    ];
    expect(suggestTags(tags, "ａｐ", ["api"]).map((t) => t.name)).toEqual(["API設計"]);
    expect(suggestTags(tags, "", []).map((t) => t.name)).toEqual(["API設計", "その他", "API"]);
  });
});
