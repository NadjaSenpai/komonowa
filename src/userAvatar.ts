/** アイコン未設定のときに表示する1文字（先頭の書記素。英字は大文字） */
export function avatarInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const first = new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(trimmed)[Symbol.iterator]().next().value?.segment ?? "?";
  return first.toLocaleUpperCase("en");
}

export const AVATAR_TONES = 6;

/** 利用者 ID から決まる色番号（1〜AVATAR_TONES）。名前を変えても色は変わらない */
export function avatarTone(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % AVATAR_TONES) + 1;
}

export const AVATAR_SIZE = 256;

/** 選んだ画像を中央で正方形に切り抜いて 256px に縮小する。WebP に対応しないブラウザでは PNG */
export async function resizeAvatar(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("この画像は読み込めませんでした。PNG・JPEG・WebP を選んでください");
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像を処理できませんでした");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close();
  const toBlob = (type: string, quality?: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  const webp = await toBlob("image/webp", 0.86);
  const blob = webp?.type === "image/webp" ? webp : await toBlob("image/png");
  if (!blob) throw new Error("画像を処理できませんでした");
  return blob;
}
