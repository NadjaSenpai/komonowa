import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../markdown";
import { HELP_SECTIONS, HelpContent, MARKDOWN_EXAMPLES } from "../pages/HelpPage";

function render(admin: boolean) {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(HelpContent, { admin })));
  return root;
}

describe("ヘルプページ", () => {
  it("各節の見出しとページ内リンク用の id がそろう", () => {
    const root = render(false);
    for (const s of HELP_SECTIONS.filter((s) => !s.admin)) {
      const heading = root.querySelector(`#${s.id}`);
      expect(heading?.textContent).toBe(s.title);
      expect(root.querySelector(`a[href="#${s.id}"]`)).not.toBeNull();
    }
    expect(root.querySelector("#markdown")).not.toBeNull();
  });

  it("「Cosense から引っ越す」は管理者にだけ出る", () => {
    expect(render(false).querySelector("#cosense")).toBeNull();
    expect(render(true).querySelector("#cosense")).not.toBeNull();
    expect(render(true).querySelector('a[href="#cosense"]')).not.toBeNull();
  });

  it("「管理者の方へ」は管理者にだけ出る", () => {
    expect(render(false).textContent).not.toContain("管理者の方へ");
    expect(render(true).textContent).toContain("管理者の方へ");
    expect(render(true).querySelector('a[href="#admin"]')).not.toBeNull();
  });

  it("記法の例は記事と同じ表示で描く", () => {
    const html = render(false).innerHTML;
    // 画像だけは実物を置けないので、表示側を言葉で説明する
    for (const ex of MARKDOWN_EXAMPLES.filter((e) => !e.preview)) expect(html).toContain(renderMarkdown(ex.source));
    expect(MARKDOWN_EXAMPLES.filter((e) => e.preview).map((e) => e.label)).toEqual(["画像"]);
  });

  it("記法の例に主な書き方がそろう", () => {
    expect(MARKDOWN_EXAMPLES.map((e) => e.label)).toEqual([
      "見出し",
      "太字",
      "取り消し線",
      "リンク",
      "記事リンク",
      "箇条書き",
      "番号付きリスト",
      "チェックリスト",
      "引用",
      "コード",
      "コードブロック",
      "表",
      "画像",
    ]);
  });
});
