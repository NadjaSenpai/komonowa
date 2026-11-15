/**
 * 画面いっぱいに重ねて見せる枠（画像の拡大、動画の再生）。
 * Esc・「閉じる」・まわりの暗いところを押すと閉じ、閉じたら中身ごと取り除く（動画はそこで止まる）
 */
export function openLightbox(content: HTMLElement, label: string): HTMLDialogElement {
  const doc = content.ownerDocument;
  doc.querySelector("dialog.lightbox")?.remove();
  const dialog = doc.createElement("dialog");
  dialog.className = "lightbox";
  dialog.setAttribute("aria-label", label);
  const close = doc.createElement("button");
  close.type = "button";
  close.className = "lightbox-close";
  close.setAttribute("aria-label", "閉じる");
  close.textContent = "×";
  dialog.append(content, close);
  dialog.addEventListener("click", (e) => {
    // 中身（動画のプレーヤーなど）を押したときは閉じない。画像は押しても閉じる
    if (e.target !== dialog && e.target !== close && !(e.target instanceof HTMLImageElement)) return;
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else dialog.remove();
  });
  dialog.addEventListener("close", () => dialog.remove());
  doc.body.append(dialog);
  // showModal のない古い環境では、重ねずにその場に開く
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  return dialog;
}

/**
 * 本文の画像が押されたら、大きく表示する。開いたら true。
 * リンクの中の画像（押すとリンク先へ行く）、人のアイコン、動画のサムネイルは対象にしない
 */
export function zoomImage(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLImageElement) || !target.closest(".markdown")) return false;
  if (target.closest("a, button, dialog") || target.classList.contains("avatar")) return false;
  const src = target.getAttribute("src");
  if (!src) return false;
  const img = target.ownerDocument.createElement("img");
  img.src = src;
  img.alt = target.alt;
  openLightbox(img, target.alt || "画像");
  return true;
}

/** 本文をどの画面で描いていても効くよう、ページ全体で一度だけ待ち受ける */
export function watchImages(root: Document = document): void {
  root.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (zoomImage(e.target)) e.preventDefault();
  });
}
