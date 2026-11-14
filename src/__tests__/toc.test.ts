import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../markdown";
import { buildToc } from "../toc";

describe("buildToc", () => {
  it("見出しに h-1 から順に id を付け、目次を返す", () => {
    const { html, toc } = buildToc(renderMarkdown("# A\n\n## B\n\n### C"));
    expect(toc).toEqual([
      { id: "h-1", text: "A", level: 1 },
      { id: "h-2", text: "B", level: 2 },
      { id: "h-3", text: "C", level: 3 },
    ]);
    expect(html).toContain('<h2 id="h-2">');
  });

  it("#### 以下は目次に入れない", () => {
    expect(buildToc(renderMarkdown("## A\n\n#### D")).toc).toHaveLength(1);
  });

  it("同じ文言の見出しも別の id", () => {
    expect(buildToc(renderMarkdown("## 同じ\n\n## 同じ")).toc.map((t) => t.id)).toEqual(["h-1", "h-2"]);
  });

  it("見出しの中のリンクや強調は文字だけ", () => {
    expect(buildToc(renderMarkdown("## [[手順書]] の **注意**")).toc[0]!.text).toBe("手順書 の 注意");
  });
});
