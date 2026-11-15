import { describe, expect, it } from "vitest";
import { searchExcerpt, highlightParts } from "../../shared/searchExcerpt";

describe("検索結果の一致箇所", () => {
  it("先頭160文字より後ろの一致も抜粋に含む", () => {
    const text = "前".repeat(500) + "必要な手順" + "後".repeat(500);
    const excerpt = searchExcerpt(text, ["手順"]);
    expect(excerpt).toContain("必要な手順");
    expect(excerpt.length).toBeLessThanOrEqual(162);
    expect(excerpt.startsWith("…")).toBe(true);
  });
  it("タイトルだけの一致と空検索では先頭を返す", () => {
    expect(searchExcerpt("本文", ["タイトル"])).toBe("本文");
    expect(searchExcerpt("本文", [])).toBe("本文");
  });
  it("複数語・記号・大小文字を正規表現やHTMLとして解釈せず強調する", () => {
    const text = "APIとa+b、<img onerror=x>";
    const parts = highlightParts(text, "api a+b <img");
    expect(parts.filter((p) => p.match).map((p) => p.text)).toEqual(["API", "a+b", "<img"]);
    expect(parts.map((p) => p.text).join("")).toBe(text);
  });
});
