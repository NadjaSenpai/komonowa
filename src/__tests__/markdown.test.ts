import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../markdown";

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
