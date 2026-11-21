import DOMPurify from "dompurify";
import { xPostUrl } from "../shared/x-posts";
import { api } from "./api";

function postText(html: string): string {
  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["blockquote", "p", "br"],
    ALLOWED_ATTR: ["class"],
    RETURN_DOM_FRAGMENT: true,
  });
  const paragraph = fragment.querySelector("blockquote.twitter-tweet > p");
  if (!paragraph) return "";
  for (const br of paragraph.querySelectorAll("br")) br.replaceWith("\n");
  return paragraph.textContent.trim();
}

/** 記事の段落に単独で置かれた投稿リンクを、取れたものから引用に置き換える。 */
export function expandXPreviews(root: HTMLElement) {
  const pending = new Map<string, Promise<string>>();
  const replacements = new Map<HTMLElement, HTMLElement>();
  let active = true;

  for (const paragraph of root.querySelectorAll<HTMLParagraphElement>(":scope > p")) {
    const link = paragraph.firstElementChild;
    if (
      !(link instanceof HTMLAnchorElement) ||
      link.childElementCount ||
      paragraph.childElementCount !== 1 ||
      paragraph.textContent.trim() !== link.textContent.trim()
    ) {
      continue;
    }
    const url = xPostUrl(link.getAttribute("href") ?? "");
    if (!url) continue;
    let text = pending.get(url);
    if (!text) {
      if (pending.size >= 10) continue;
      text = api
        .get<{ html: string }>(`/x-preview?url=${encodeURIComponent(url)}`)
        .then(({ html }) => postText(html))
        .catch(() => "");
      pending.set(url, text);
    }
    void text.then((value) => {
      if (!active || !value || paragraph.parentNode !== root) return;
      const quote = document.createElement("blockquote");
      quote.cite = url;
      const body = document.createElement("p");
      body.className = "x-post-text";
      body.textContent = value;
      const source = link.cloneNode(false) as HTMLAnchorElement;
      source.textContent = "Xで投稿を見る";
      quote.append(body, source);
      paragraph.replaceWith(quote);
      replacements.set(quote, paragraph);
    });
  }

  return () => {
    active = false;
    for (const [quote, paragraph] of replacements) quote.replaceWith(paragraph);
  };
}
