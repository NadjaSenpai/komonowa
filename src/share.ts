import { renderMarkdown } from "./markdown";

/**
 * 共有ページ（/s/:token）の本文 HTML。
 * 添付は共有用の URL（その記事の添付だけ取れる）に読み替え、記事リンク [[ ]] と人へのリンク（/users/…）はただの文字にする
 * （外の人が押してもログイン画面になるだけで、ほかの記事のタイトルの手がかりも渡さないため）
 */
export function sharedHtml(body: string, token: string): string {
  const doc = new DOMParser().parseFromString(renderMarkdown(body), "text/html");
  const prefix = `/api/share/${encodeURIComponent(token)}/attachments/`;
  for (const el of doc.body.querySelectorAll<HTMLElement>("img[src^='/api/attachments/'], a[href^='/api/attachments/']")) {
    const attr = el.tagName === "IMG" ? "src" : "href";
    el.setAttribute(attr, prefix + el.getAttribute(attr)!.slice("/api/attachments/".length));
  }
  for (const a of doc.body.querySelectorAll("a[href^='/wiki/'], a[href^='/users/']")) {
    const span = doc.createElement("span");
    span.textContent = a.textContent;
    a.replaceWith(span);
  }
  return doc.body.innerHTML;
}

/** パスワード欄の入力。全角数字を半角にして、数字だけを 6 桁まで残す */
export function cleanPasscode(value: string): string {
  return value.normalize("NFKC").replace(/\D/g, "").slice(0, 6);
}
