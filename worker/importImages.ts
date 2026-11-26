// Cosense からの取り込みで、本文の画像を取ってくる（routes/import.ts）。
// サーバーを任意の URL の踏み台にしないよう、最初に取りに行く URL は Cosense と Gyazo の画像だけに限る。
import { MAX_FILE_BYTES, contentMatches } from "./routes/attachments";

const IMAGE_EXTS = ["png", "jpg", "gif", "webp"];
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;

function parse(url: string): URL | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/** Gyazo の画像ページ（https://gyazo.com/<id>） */
function isGyazoPage(u: URL) {
  return u.hostname === "gyazo.com" && /^\/[0-9a-f]+$/i.test(u.pathname);
}

/** 取りに行ってよい画像の URL か */
export function isImportableImageUrl(url: string): boolean {
  const u = parse(url);
  if (!u) return false;
  return (u.hostname === "scrapbox.io" && u.pathname.startsWith("/files/")) || u.hostname === "i.gyazo.com" || isGyazoPage(u);
}

/** 転送は手でたどる（Workers は redirect: "error" を受け付けない）。転送先は https だけ */
async function fetchFollowing(url: string): Promise<Response | null> {
  let current = url;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const res = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status < 300 || res.status >= 400) return res.ok ? res : null;
    const next = parse(new URL(res.headers.get("location") ?? "", current).toString());
    if (!next) return null;
    current = next.toString();
  }
  return null;
}

/** Gyazo の画像ページから、画像そのものの URL を oEmbed で得る */
async function gyazoImageUrl(page: string): Promise<string | null> {
  const res = await fetchFollowing(`https://api.gyazo.com/api/oembed?url=${encodeURIComponent(page)}`);
  if (!res) return null;
  const data = (await res.json().catch(() => null)) as { url?: unknown } | null;
  const url = typeof data?.url === "string" ? parse(data.url) : null;
  return url && url.hostname === "i.gyazo.com" ? url.toString() : null;
}

/** 画像を取ってくる。許可リストの外・取れない・画像でない・10MB 超なら null */
export async function fetchImportImage(url: string): Promise<{ bytes: Uint8Array; ext: string } | null> {
  if (!isImportableImageUrl(url)) return null;
  try {
    const target = isGyazoPage(new URL(url)) ? await gyazoImageUrl(url) : url;
    if (!target) return null;
    const res = await fetchFollowing(target);
    if (!res) return null;
    if (Number(res.headers.get("content-length") ?? 0) > MAX_FILE_BYTES) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_FILE_BYTES) return null;
    const ext = IMAGE_EXTS.find((e) => contentMatches(e, bytes));
    return ext ? { bytes, ext } : null;
  } catch {
    return null;
  }
}
