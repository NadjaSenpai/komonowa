import DOMPurify from "dompurify";
import { marked } from "marked";
import { wikiLinkExtension } from "../shared/wikilinks";
import { embedLinks } from "./embeds";

marked.setOptions({ gfm: true, breaks: true });
// [[タイトル]] を記事間リンクにする（shared/wikilinks.ts。保存時のリンク解析と同じ判定）
marked.use({ extensions: [wikiLinkExtension] });
// チェックリスト（- [ ] / - [x]）。サニタイズで input を禁止しているので、チェックボックスではなく印で表示する
marked.use({
  renderer: {
    checkbox({ checked }) {
      return `<span class="task-box" role="img" aria-label="${checked ? "完了" : "未完了"}">${checked ? "☑" : "☐"}</span>`;
    },
  },
});

// 外部リンクは新しいタブで開き、参照元を渡さない
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    const href = node.getAttribute("href") ?? "";
    if (/^https?:\/\//i.test(href)) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  }
});

/** Markdown を HTML にし、スクリプトなど危険な要素を取り除く。URL だけの行は、YouTube なら再生ボタン付きの枠に、画像なら画像にする（embeds.ts） */
export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false });
  // iframe はサニタイズで落とす。動画の枠はそのあとに自分で組み立て、プレーヤーは再生ボタンを押したときにだけ入れる
  return embedLinks(DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ["style", "form", "input"] }));
}

/** 一覧の抜粋用。Markdown を描画してから文字だけを取り出す（見出しと動画の枠は除く） */
export function markdownToText(source: string): string {
  const doc = new DOMParser().parseFromString(renderMarkdown(source), "text/html");
  doc.body.querySelectorAll("h1, h2, h3, h4, h5, h6, .video-embed").forEach((h) => h.remove());
  doc.body.querySelectorAll("p, li, pre, blockquote, td, th, br").forEach((el) => el.append(" "));
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}
