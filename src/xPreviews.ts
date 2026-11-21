import DOMPurify from "dompurify";
import { xPostUrl, type XPostPreview } from "../shared/x-posts";
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
  const pending = new Map<string, Promise<(Omit<XPostPreview, "html"> & { text: string }) | null>>();
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
    let preview = pending.get(url);
    if (!preview) {
      if (pending.size >= 10) continue;
      preview = api
        .get<XPostPreview>(`/x-preview?url=${encodeURIComponent(url)}`)
        .then(({ html, ...author }) => ({ ...author, text: postText(html) }))
        .catch(() => null);
      pending.set(url, preview);
    }
    void preview.then((post) => {
      if (!active || !post?.text || paragraph.parentNode !== root) return;
      const quote = document.createElement("blockquote");
      quote.cite = url;
      if (post.authorName || post.authorHandle) {
        const author = document.createElement("p");
        author.className = "small";
        if (post.authorName) {
          const name = document.createElement("strong");
          name.textContent = post.authorName;
          author.append(name);
        }
        if (post.authorHandle) {
          const handle = document.createElement("span");
          handle.className = "muted";
          handle.textContent = `@${post.authorHandle}`;
          if (post.authorName) author.append(" ");
          author.append(handle);
        }
        quote.append(author);
      }
      const body = document.createElement("p");
      body.className = "x-post-text";
      body.textContent = post.text;
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
