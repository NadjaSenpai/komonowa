// Cosense（旧 Scrapbox）のエクスポート JSON を読み、ページの記法を komonowa の Markdown にする。
// 設計: docs/superpowers/specs/2026-11-26-cosense-import-design.md
import { youtubeVideo } from "./youtube";

export interface CosensePage {
  title: string;
  /** 秒 */
  created: number;
  /** 秒 */
  updated: number;
  /** タイトル行を除いた本文の行 */
  lines: string[];
}

export interface ConvertedPage {
  title: string;
  body: string;
  tags: string[];
  /** ミリ秒 */
  created: number;
  /** ミリ秒 */
  updated: number;
  /** 画像にした数 */
  images: number;
}

const MAX_TITLE = 200;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 40;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;
const GYAZO_HOSTS = new Set(["gyazo.com", "i.gyazo.com"]);

/** エクスポート JSON（メタデータあり・なしの両方）をページの配列にする。形が違えば null */
export function parseCosenseExport(data: unknown): CosensePage[] | null {
  if (!data || typeof data !== "object" || !Array.isArray((data as { pages?: unknown }).pages)) return null;
  const pages: CosensePage[] = [];
  for (const raw of (data as { pages: unknown[] }).pages) {
    if (!raw || typeof raw !== "object") return null;
    const { title, created, updated, lines } = raw as Record<string, unknown>;
    if (typeof title !== "string" || typeof created !== "number" || typeof updated !== "number" || !Array.isArray(lines)) return null;
    const texts: string[] = [];
    for (const line of lines) {
      if (typeof line === "string") texts.push(line);
      else if (line && typeof line === "object" && typeof (line as { text?: unknown }).text === "string") texts.push((line as { text: string }).text);
      else return null;
    }
    // 1 行目はタイトルと同じ
    pages.push({ title, created, updated, lines: texts.slice(1) });
  }
  return pages;
}

/** komonowa のタイトルにする（半角の [ ] は使えないので全角に、200 文字まで） */
export function cosenseTitle(title: string): string {
  return title.trim().replace(/\[/g, "［").replace(/\]/g, "］").slice(0, MAX_TITLE);
}

function isImageUrl(url: URL): boolean {
  // Cosense は URL の末尾に #.png を付けて画像にできる
  return GYAZO_HOSTS.has(url.hostname) || IMAGE_EXT.test(url.pathname) || IMAGE_EXT.test(url.hash);
}

function parseUrl(token: string): URL | null {
  if (!/^https?:\/\//.test(token)) return null;
  try {
    return new URL(token);
  } catch {
    return null;
  }
}

/** s[open] の [ に対応する ] の位置（入れ子を数える）。なければ -1 */
function closeOf(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "[") depth++;
    else if (s[i] === "]" && --depth === 0) return i;
  }
  return -1;
}

/** 行頭で見出し・番号付きリスト・箇条書きとして読まれる文字を逃がす */
function escapeLineStart(text: string): string {
  return text.replace(/^(#{1,6}|[-*+]) /, "\\$1 ").replace(/^(\d+)\. /, "$1\\. ");
}

class Converter {
  tags = new Map<string, string>();
  images = 0;

  addTag(raw: string) {
    const name = raw.trim().normalize("NFKC");
    if (!name || name.length > MAX_TAG_LENGTH || name.includes(",") || this.tags.size >= MAX_TAGS) return;
    if (!this.tags.has(name.toLowerCase())) this.tags.set(name.toLowerCase(), name);
  }

  /** [ ] の中身 */
  bracket(inner: string): string {
    const math = /^\$ (.*)$/.exec(inner);
    if (math) return `\`${math[1]}\``;
    if (/\.icon(\*\d+)?$/.test(inner)) return "";
    const deco = /^([*/-]+)\s+(.+)$/.exec(inner);
    if (deco) {
      let text = this.inline(deco[2]!);
      if (deco[1]!.includes("/")) text = `*${text}*`;
      if (deco[1]!.includes("*")) text = `**${text}**`;
      if (deco[1]!.includes("-")) text = `~~${text}~~`;
      return text;
    }
    if (inner.startsWith("/")) {
      const path = inner.slice(1).split("/").map(encodeURIComponent).join("/");
      return `[${inner}](https://scrapbox.io/${path})`;
    }
    const tokens = inner.split(/\s+/);
    const only = tokens.length === 1 ? parseUrl(inner) : null;
    if (only) {
      if (isImageUrl(only)) {
        this.images++;
        return `![](${inner})`;
      }
      if (youtubeVideo(inner)) return inner;
      return `<${inner}>`;
    }
    const first = parseUrl(tokens[0]!);
    if (first) return `[${tokens.slice(1).join(" ")}](${tokens[0]})`;
    const last = parseUrl(tokens.at(-1)!);
    if (last) return `[${tokens.slice(0, -1).join(" ")}](${tokens.at(-1)})`;
    return `[[${cosenseTitle(inner)}]]`;
  }

  /** 1 行の中の記法 */
  inline(s: string): string {
    let out = "";
    let i = 0;
    while (i < s.length) {
      const ch = s[i]!;
      if (ch === "`") {
        const end = s.indexOf("`", i + 1);
        if (end > i) {
          out += s.slice(i, end + 1);
          i = end + 1;
          continue;
        }
      }
      if (s.startsWith("[[", i)) {
        const end = s.indexOf("]]", i + 2);
        if (end > i) {
          out += `**${s.slice(i + 2, end)}**`;
          i = end + 2;
          continue;
        }
      }
      if (ch === "<") {
        // 文字の < を HTML のタグとして読ませない（Map<string> や <div> が消えないように）
        out += "\\<";
        i++;
        continue;
      }
      if (ch === "[") {
        const end = closeOf(s, i);
        if (end > i) {
          out += this.bracket(s.slice(i + 1, end));
          i = end + 1;
          continue;
        }
      }
      if (ch === "#" && (i === 0 || /\s/.test(s[i - 1]!))) {
        const m = /^#\[([^\]]+)\]|^#(\S+)/.exec(s.slice(i));
        if (m) {
          this.addTag(m[1] ?? m[2]!);
          out += m[0];
          i += m[0].length;
          continue;
        }
      }
      out += ch;
      i++;
    }
    return out;
  }

  line(text: string): string | null {
    const indent = /^[ \t]*/.exec(text)![0].length;
    const rest = text.slice(indent);
    if (!rest) return "";
    const command = /^[$%] (.*)$/.exec(rest);
    let converted: string;
    if (command) converted = `\`${command[1]}\``;
    else {
      // 行全体が 1 つの [** …]（中にリンクがあってもよい）なら見出し
      const heading = closeOf(rest, 0) === rest.length - 1 ? /^\[(\*{2,})\s+(.*)\]$/.exec(rest) : null;
      const onlyTags = /^(#\[[^\]]+\]|#\S+)(\s+(#\[[^\]]+\]|#\S+))*$/.test(rest);
      converted = heading ? `${heading[1]!.length === 2 ? "###" : "##"} ${this.inline(heading[2]!)}` : escapeLineStart(this.inline(rest));
      if (onlyTags) return null;
      if (!converted.trim()) return null;
    }
    return indent > 0 ? `${"  ".repeat(indent - 1)}- ${converted}` : converted;
  }

  body(lines: string[]): string {
    const out: string[] = [];
    let i = 0;
    const blockLines = (start: number, indent: number) => {
      const rows: string[] = [];
      let j = start;
      while (j < lines.length) {
        const own = /^[ \t]*/.exec(lines[j]!)![0].length;
        if (own <= indent) break;
        rows.push(lines[j]!.slice(indent + 1));
        j++;
      }
      return { rows, next: j };
    };
    while (i < lines.length) {
      const text = lines[i]!;
      const indent = /^[ \t]*/.exec(text)![0].length;
      const rest = text.slice(indent);
      const code = /^code:(.+)$/.exec(rest);
      const table = /^table:(.+)$/.exec(rest);
      if (code) {
        const name = code[1]!.trim();
        const lang = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : name;
        const { rows, next } = blockLines(i + 1, indent);
        out.push(`\`\`\`${lang}`, ...rows, "```");
        i = next;
        continue;
      }
      if (table) {
        const { rows, next } = blockLines(i + 1, indent);
        const cells = rows.map((r) => r.split("\t").map((c) => this.inline(c.trim())));
        const width = Math.max(1, ...cells.map((r) => r.length));
        const row = (r: string[]) => `| ${Array.from({ length: width }, (_, k) => r[k] ?? "").join(" | ")} |`;
        if (cells.length > 0) out.push(row(cells[0]!), row(Array(width).fill("---")), ...cells.slice(1).map(row));
        i = next;
        continue;
      }
      const converted = this.line(text);
      if (converted !== null) out.push(converted);
      i++;
    }
    // 先頭の空行（タイトルの次の空行）と末尾の空白を除く。先頭の行の字下げは残す
    return out.join("\n").replace(/^\n+/, "").replace(/\s+$/, "");
  }
}

export function convertCosensePage(page: CosensePage): ConvertedPage {
  const converter = new Converter();
  const body = converter.body(page.lines);
  return {
    title: cosenseTitle(page.title),
    body,
    tags: [...converter.tags.values()],
    created: page.created * 1000,
    updated: page.updated * 1000,
    images: converter.images,
  };
}
