import { renderMarkdown } from "./markdown";

/**
 * 共有ページ（/s/:token）の本文 HTML。
 * 添付は共有用の URL（その記事の添付だけ取れる）に読み替え、記事リンク [[ ]] はただの文字にする
 * （外の人が押してもログイン画面になるだけで、ほかの記事のタイトルの手がかりも渡さないため）
 */
export function sharedHtml(body: string, token: string): string {
  const doc = new DOMParser().parseFromString(renderMarkdown(body), "text/html");
  const prefix = `/api/share/${encodeURIComponent(token)}/attachments/`;
  for (const el of doc.body.querySelectorAll<HTMLElement>("img[src^='/api/attachments/'], a[href^='/api/attachments/']")) {
    const attr = el.tagName === "IMG" ? "src" : "href";
    el.setAttribute(attr, prefix + el.getAttribute(attr)!.slice("/api/attachments/".length));
  }
  for (const a of doc.body.querySelectorAll("a[href^='/wiki/']")) {
    const span = doc.createElement("span");
    span.textContent = a.textContent;
    a.replaceWith(span);
  }
  return doc.body.innerHTML;
}
