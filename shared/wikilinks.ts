import { Marked, type TokenizerAndRendererExtension, type Tokens } from "marked";

/** リンク先として扱うタイトルの最大長（記事タイトルの上限と同じ） */
const MAX_TITLE = 200;

/**
 * 「同じタイトル」を判定するキー。前後の空白を除き、NFKC で全角・半角をそろえ、
 * 連続する空白を1つにまとめて小文字にする（記事タイトルの重複判定と [[ ]] のリンク先で共通）
 */
export function titleKey(title: string): string {
  return title.trim().normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
}

/** [[タイトル]] の行き先。タイトルに / や ? が入っても壊れないよう符号化する */
export function wikiPath(title: string): string {
  return `/wiki/${encodeURIComponent(title)}`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

interface WikiLinkToken extends Tokens.Generic {
  type: "wikilink";
  text: string;
}

/** marked の拡張：[[タイトル]] を記事間リンクにする。コードの中は marked が先に拾うので対象外 */
export const wikiLinkExtension: TokenizerAndRendererExtension = {
  name: "wikilink",
  level: "inline",
  start(src) {
    const at = src.indexOf("[[");
    return at < 0 ? undefined : at;
  },
  tokenizer(src) {
    const match = /^\[\[([^[\]\n]+)\]\]/.exec(src);
    if (!match) return undefined;
    const text = match[1]!.trim();
    if (!text || text.length > MAX_TITLE) return undefined;
    return { type: "wikilink", raw: match[0], text } satisfies WikiLinkToken;
  },
  renderer(token) {
    const text = (token as WikiLinkToken).text;
    return `<a href="${escapeHtml(wikiPath(text))}" class="wikilink">${escapeHtml(text)}</a>`;
  },
};

const parser = new Marked({ gfm: true, extensions: [wikiLinkExtension] });

/** 本文中の [[タイトル]] を出現順に返す。キーが同じものは最初の表記だけ残す */
export function extractWikiLinks(markdown: string): string[] {
  const found = new Map<string, string>();
  parser.walkTokens(parser.lexer(markdown), (token) => {
    if (token.type !== "wikilink") return;
    const text = (token as WikiLinkToken).text;
    const key = titleKey(text);
    if (key && !found.has(key)) found.set(key, text);
  });
  return [...found.values()];
}
