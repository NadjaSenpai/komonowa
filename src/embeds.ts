const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
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

function thumbnailUrl(id: string, size: "maxresdefault" | "hqdefault"): string {
  return `https://i.ytimg.com/vi/${id}/${size}.jpg`;
}

/**
 * 大きいサムネイルが無い動画では、YouTube は 404 と一緒に 120×90 の灰色の画像を返す（読み込み自体は成功する）。
 * そのときは、どの動画にもある小さい版（480×360）に替える。替えたら true
 */
export function fallbackThumbnail(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLImageElement) || !target.closest(".video-play")) return false;
  const id = target.closest<HTMLElement>(".video-embed")?.dataset.youtube;
  if (!id || !YOUTUBE_ID.test(id) || target.src !== thumbnailUrl(id, "maxresdefault")) return false;
  if (target.naturalWidth > 120) return false;
  target.src = thumbnailUrl(id, "hqdefault");
  return true;
}

/**
 * 描画した本文のうち、YouTube の URL だけの段落を、サムネイルと再生ボタンの枠に置き換える。
 * この時点で読むのはサムネイル画像だけ。プレーヤー（iframe）は再生ボタンを押したときに playVideo が入れる。
 * 文中の URL や [文字](URL) の形のリンクは、ふつうのリンクのまま
 */
export function embedVideos(html: string): string {
  if (!html.includes("youtu")) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  let changed = false;
  for (const p of doc.body.querySelectorAll("p")) {
    const a = p.firstElementChild;
    if (a?.tagName !== "A" || p.children.length !== 1) continue;
    const href = a.getAttribute("href") ?? "";
    // URL をそのまま書いた行だけ（リンクの文字が URL と同じ）
    if ((p.textContent ?? "").trim() !== (a.textContent ?? "").trim() || a.textContent !== href) continue;
    const video = youtubeVideo(href);
    if (!video) continue;

    const box = doc.createElement("div");
    box.className = "video-embed";
    box.dataset.youtube = video.id;
    if (video.start > 0) box.dataset.start = String(video.start);
    const play = doc.createElement("button");
    play.type = "button";
    play.className = "video-play";
    play.setAttribute("aria-label", "YouTube の動画を再生");
    const thumb = doc.createElement("img");
    // まず大きい版（1280×720）。古い動画などで無いときは、読み込んだあと fallbackThumbnail が小さい版に替える
    thumb.src = thumbnailUrl(video.id, "maxresdefault");
    thumb.alt = "";
    thumb.setAttribute("loading", "lazy");
    thumb.setAttribute("decoding", "async");
    const mark = doc.createElement("span");
    mark.className = "video-play-mark";
    mark.setAttribute("aria-hidden", "true");
    play.append(thumb, mark);
    a.classList.add("video-link");
    a.textContent = "YouTube で開く";
    box.append(play, a);
    p.replaceWith(box);
    changed = true;
  }
  return changed ? doc.body.innerHTML : html;
}

/** 再生ボタンが押されたら、その枠をプレーヤーに置き換える。押すまで YouTube のプレーヤーは読み込まない */
export function playVideo(target: EventTarget | null): boolean {
  const play = target instanceof Element ? target.closest(".video-play") : null;
  const box = play?.closest<HTMLElement>(".video-embed");
  const id = box?.dataset.youtube;
  if (!play || !box || !id || !YOUTUBE_ID.test(id)) return false;
  const frame = box.ownerDocument.createElement("iframe");
  const start = Number(box.dataset.start) > 0 ? `&start=${Number(box.dataset.start)}` : "";
  frame.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1${start}`;
  frame.title = "YouTube の動画";
  frame.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture; fullscreen");
  frame.setAttribute("allowfullscreen", "");
  // YouTube のプレーヤーは埋め込み元がわからないと再生を断るので、ここだけサイトのオリジン（ページの URL ではない）を渡す
  frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  play.replaceWith(frame);
  return true;
}

/** 本文をどの画面で描いていても再生ボタンが効くよう、ページ全体で一度だけ待ち受ける */
export function watchVideoEmbeds(root: Document = document): void {
  root.addEventListener("click", (e) => {
    if (playVideo(e.target)) e.preventDefault();
  });
  // load と error は親に伝わらないので、キャプチャで受ける
  root.addEventListener("load", (e) => fallbackThumbnail(e.target), true);
  root.addEventListener("error", (e) => fallbackThumbnail(e.target), true);
}
