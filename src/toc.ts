/** 目次の1項目（docs/superpowers/specs/2026-11-14-article-sidebar-design.md） */
export interface TocItem {
  id: string;
  text: string;
  level: 1 | 2 | 3;
}

/**
 * 描画済み（サニタイズ済み）の本文 HTML の見出し（# 〜 ###）に id="h-1"… を付け、目次を返す。
 * 日本語の見出しでも動くよう番号で付け、h- を付けてブラウザの組み込みの名前とぶつからないようにする
 */
export function buildToc(html: string): { html: string; toc: TocItem[] } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const toc: TocItem[] = [];
  doc.body.querySelectorAll("h1, h2, h3").forEach((heading, i) => {
    const id = `h-${i + 1}`;
    heading.id = id;
    const text = (heading.textContent ?? "").replace(/\s+/g, " ").trim();
    toc.push({ id, text, level: Number(heading.tagName[1]) as TocItem["level"] });
  });
  return { html: doc.body.innerHTML, toc };
}
