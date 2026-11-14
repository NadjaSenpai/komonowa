import { describe, expect, it } from "vitest";
import { markdownToText, renderMarkdown } from "../markdown";

describe("renderMarkdown", () => {
  it("Markdown を HTML にする", () => {
    const html = renderMarkdown("# 見出し\n\n- 項目\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("<h1>見出し</h1>");
    expect(html).toContain("<li>項目</li>");
    expect(html).toContain("<table>");
  });

  it("スクリプトやイベント属性を取り除く", () => {
    const html = renderMarkdown(
      '<script>alert(1)</script><img src=x onerror="alert(2)"><a href="javascript:alert(3)">x</a><iframe src="https://evil.example"></iframe><style>body{}</style>',
    );
    expect(html).not.toMatch(/<script|onerror|javascript:|<iframe|<style/i);
  });

  it("Markdown のリンク記法でも javascript: を許さない", () => {
    expect(renderMarkdown("[x](javascript:alert(1))")).not.toContain("javascript:");
  });

  it("外部リンクは新しいタブ・参照元なしで開く", () => {
    const html = renderMarkdown("[外部](https://example.com) [内部](/articles/1)");
    expect(html).toContain('href="https://example.com" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('<a href="/articles/1">内部</a>');
  });

  it("添付画像の参照は残す", () => {
    expect(renderMarkdown("![図](/api/attachments/abc)")).toContain('<img src="/api/attachments/abc" alt="図">');
  });
});

describe("markdownToText", () => {
  it("見出しを除き、記号を残したまま本文テキストにする", () => {
    const text = markdownToText("## 概要\n\n困ったら **#dev-help** で聞いてね。\n\n- Node.js 22 以上\n- `npm install`");
    expect(text).toBe("困ったら #dev-help で聞いてね。 Node.js 22 以上 npm install");
  });

  it("途中で切れた Markdown でも崩れない", () => {
    expect(markdownToText("本文です。\n\n```bash\nnpm run d")).toBe("本文です。 npm run d");
  });

  it("HTML タグは文字として出さない", () => {
    expect(markdownToText("<b>太字</b>と<script>alert(1)</script>本文")).toBe("太字と本文");
  });
});

describe("[[タイトル]]", () => {
  it("[[ ]] をアプリ内リンクにする", () => {
    expect(renderMarkdown("[[a/b?c]]")).toContain('<a href="/wiki/a%2Fb%3Fc" class="wikilink">a/b?c</a>');
  });

  it("リンク文字列の HTML はエスケープする", () => {
    const html = renderMarkdown("[[<img src=x onerror=alert(1)>]]");
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector("img")).toBeNull();
    expect(doc.querySelector("a.wikilink")?.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("コードの中は描画しない", () => {
    expect(renderMarkdown("`[[a]]`")).not.toContain("wikilink");
  });
});

describe("チェックリスト", () => {
  it("- [ ] と - [x] をチェックの印で表示する", () => {
    const doc = new DOMParser().parseFromString(renderMarkdown("- [ ] 未完了\n- [x] 完了"), "text/html");
    const boxes = [...doc.querySelectorAll("li > .task-box")];
    expect(boxes.map((b) => b.textContent)).toEqual(["☐", "☑"]);
    expect(boxes.map((b) => b.getAttribute("aria-label"))).toEqual(["未完了", "完了"]);
  });

  it("本文に直接書いた input タグは今までどおり取り除く", () => {
    expect(renderMarkdown('<input type="checkbox"> <input type="text" value="x">')).not.toContain("<input");
  });
});
