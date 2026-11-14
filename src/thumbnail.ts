/** 記事一覧に出す、添付画像の小さい版（docs/superpowers/specs/2026-11-14-list-thumbnails-design.md） */
export const THUMB_MAX = 400;
/** サーバーの上限（worker/routes/attachments.ts の MAX_THUMB_BYTES）と同じ */
export const MAX_THUMB_BYTES = 200 * 1024;

/** 長辺を THUMB_MAX に収めた大きさ。小さい画像は拡大しない */
export function thumbSize(width: number, height: number) {
  const scale = Math.min(1, THUMB_MAX / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** 画像なら小さい版を作る。作れなかったら null（添付そのものは止めない） */
export async function makeThumbnail(file: File): Promise<Blob | null> {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type) && !/\.(png|jpe?g|gif|webp)$/i.test(file.name)) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const size = thumbSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // WebP を作れないブラウザ（iPhone の Safari など）は JPEG にするので、透明な部分は白にする
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close();
    const toBlob = (type: string, quality?: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    const webp = await toBlob("image/webp", 0.8);
    const blob = webp?.type === "image/webp" ? webp : await toBlob("image/jpeg", 0.82);
    return blob && blob.size <= MAX_THUMB_BYTES ? blob : null;
  } catch {
    return null;
  }
}
