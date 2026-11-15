/** YouTube の動画 ID（11 文字）。URL やファイル名に入れる前に必ずこれで確かめる */
export const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"]);

export interface Video {
  id: string;
  /** 再生を始める位置（秒）。指定がなければ 0 */
  start: number;
}

/** 「90」「90s」「1m30s」「1h2m3s」を秒にする。読めなければ 0 */
function seconds(value: string | null): number {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** YouTube の動画の URL（watch・youtu.be・shorts・live・embed）から動画 ID と開始位置を取り出す。動画でなければ null */
export function youtubeVideo(url: string): Video | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase();
  let id: string | null = null;
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0] ?? null;
  else if (YOUTUBE_HOSTS.has(host)) {
    const [, kind, rest] = u.pathname.split("/");
    if (kind === "watch") id = u.searchParams.get("v");
    else if (kind === "shorts" || kind === "live" || kind === "embed") id = rest ?? null;
  }
  if (!id || !YOUTUBE_ID.test(id)) return null;
  return { id, start: seconds(u.searchParams.get("t") ?? u.searchParams.get("start")) };
}

/**
 * 本文（Markdown）で最初に出てくる、動画の枠になる行（YouTube の URL だけの行で、前後が空行）。
 * 一覧に出すサムネイルを保存のときに選ぶのに使う。index は本文の先頭からの位置。コードブロックの中は数えない。
 * 表示側（src/embeds.ts）は描画した HTML から判定するので、字下げなど細かいところでは食い違うことがある
 */
export function firstVideoLine(body: string): { id: string; index: number } | null {
  const lines = body.split("\n");
  let index = 0;
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.replace(/\r$/, "");
    const at = index;
    index += lines[i]!.length + 1;
    const mark = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (mark?.startsWith(fence)) fence = null;
      continue;
    }
    if (mark) {
      fence = mark;
      continue;
    }
    if (!/^https?:\/\/\S+$/.test(line)) continue;
    const blank = (l: string | undefined) => l === undefined || l.trim() === "";
    if (!blank(lines[i - 1]) || !blank(lines[i + 1])) continue;
    const video = youtubeVideo(line);
    if (video) return { id: video.id, index: at };
  }
  return null;
}
