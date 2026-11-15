import { YOUTUBE_ID, youtubeVideo } from "../shared/youtube";
import { openLightbox } from "./lightbox";

export { youtubeVideo };

/** YouTube のサムネイル。mqdefault（320×180）と hqdefault（480×360）はどの動画にもあり、maxresdefault（1280×720）は無い動画がある */
export function thumbnailUrl(id: string, size: "maxresdefault" | "hqdefault" | "mqdefault"): string {
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

/** URL の末尾の拡張子から、画像の URL かを見分ける。CSP で https の画像しか読めないので https だけ */
export function isImageUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === "https:" && /\.(png|jpe?g|gif|webp)$/i.test(u.pathname);
}

/**
 * 描画した本文のうち、URL だけの段落を、中身に合わせて置き換える。
 * - YouTube の動画：サムネイルと再生ボタンの枠。この時点で読むのはサムネイル画像だけで、
 *   プレーヤー（iframe）は再生ボタンを押したときに playVideo が出す
 * - 画像（末尾が .png .jpg .jpeg .gif .webp）：その画像。![説明](URL) と書いたときと同じ
 * 文中の URL や [文字](URL) の形のリンクは、ふつうのリンクのまま
 */
export function embedLinks(html: string): string {
  if (!html.includes(`href="http`)) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  let changed = false;
  for (const p of doc.body.querySelectorAll("p")) {
    const a = p.firstElementChild;
    if (a?.tagName !== "A" || p.children.length !== 1) continue;
    const href = a.getAttribute("href") ?? "";
    // URL をそのまま書いた行だけ（リンクの文字が URL と同じ）
    if ((p.textContent ?? "").trim() !== (a.textContent ?? "").trim() || a.textContent !== href) continue;
    if (isImageUrl(href)) {
      const img = doc.createElement("img");
      img.src = href;
      img.alt = "";
      a.replaceWith(img);
      changed = true;
      continue;
    }
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

/**
 * 再生ボタンが押されたら、画面いっぱいの枠（lightbox.ts）にプレーヤーを出す。押すまで YouTube のプレーヤーは読み込まない。
 * 本文の中の小さい枠で再生すると YouTube が低い画質を選ぶので、大きく出す。閉じるとプレーヤーごと消えて、再生も止まる
 */
export function playVideo(target: EventTarget | null): boolean {
  const play = target instanceof Element ? target.closest(".video-play") : null;
  const box = play?.closest<HTMLElement>(".video-embed");
  const id = box?.dataset.youtube;
  if (!play || !box || !id || !YOUTUBE_ID.test(id)) return false;
  const frame = box.ownerDocument.createElement("iframe");
  const start = Number(box.dataset.start) > 0 ? `&start=${Number(box.dataset.start)}` : "";
  // 画質は URL では指定できない（vq=hd1080 は試したが効かなかった）。プレーヤーが枠の大きさと回線から決める
  frame.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1${start}`;
  frame.title = "YouTube の動画";
  frame.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture; fullscreen");
  frame.setAttribute("allowfullscreen", "");
  // YouTube のプレーヤーは埋め込み元がわからないと再生を断るので、ここだけサイトのオリジン（ページの URL ではない）を渡す
  frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  openLightbox(frame, "YouTube の動画");
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
