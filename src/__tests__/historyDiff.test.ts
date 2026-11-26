import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HistoryDiff, type RevisionContent } from "../HistoryDiff";

const rev = (data: Partial<RevisionContent> = {}): RevisionContent => ({ version: 1, title: "手順書", body: "本文", tags: [], ...data });
const render = (before: RevisionContent, after: RevisionContent) => {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(createElement(HistoryDiff, { before, after }));
  return root;
};

describe("HistoryDiff", () => {
  it("タイトルの変更を出す", () => {
    expect(render(rev(), rev({ version: 2, title: "作業手順書" })).textContent).toContain("タイトル：手順書 → 作業手順書");
  });

  it("タグの追加と削除を出す", () => {
    const text = render(rev({ tags: ["古い", "残る"] }), rev({ version: 2, tags: ["残る", "新しい"] })).textContent;
    expect(text).toContain("+新しい");
    expect(text).toContain("−古い");
    expect(text).not.toContain("残る");
  });

  it("本文の HTML は文字として出す", () => {
    const root = render(rev(), rev({ version: 2, body: "本文\n<script>alert(1)</script>" }));
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector("ins, .diff-add")?.textContent).toContain("<script>alert(1)</script>");
  });

  it("本文が同じなら変更なしと出す", () => {
    expect(render(rev(), rev({ version: 2, title: "別" })).textContent).toContain("本文の変更はありません");
  });
});
