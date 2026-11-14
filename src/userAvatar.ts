import { DELETED_NAME } from "../shared/accounts";
/** アイコン未設定のときに表示する1文字（先頭の書記素。英字は大文字） */
export function avatarInitial(name: string): string {
  // 退会した人は無地にする
  if (name === DELETED_NAME) return "";
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

export const MAX_ZOOM = 4;

/**
 * クロッパーの表示状態。枠（一辺 view px）いっぱいに画像の短辺を合わせた倍率を 1 とし、
 * zoom で拡大、offset で画像の中心を枠の中心からずらす（px、右・下が正）。
 */
export interface CropView {
  width: number;
  height: number;
  view: number;
  zoom: number;
}

function scaleOf({ width, height, view, zoom }: CropView) {
  return (view / Math.min(width, height)) * zoom;
}

/** 枠に余白ができないよう、ずらし量を画像がはみ出している範囲に収める */
export function clampOffset(v: CropView, offset: { x: number; y: number }) {
  const s = scaleOf(v);
  const maxX = Math.max(0, (v.width * s - v.view) / 2);
  const maxY = Math.max(0, (v.height * s - v.view) / 2);
  const clamp = (n: number, max: number) => Math.min(max, Math.max(-max, n)) || 0;
  return { x: clamp(offset.x, maxX), y: clamp(offset.y, maxY) };
}

/** 枠に見えている範囲を、元画像の座標（px）の正方形で返す */
export function cropRect(v: CropView, offset: { x: number; y: number }) {
  const s = scaleOf(v);
  const size = v.view / s;
  return { x: (v.width - size) / 2 - offset.x / s, y: (v.height - size) / 2 - offset.y / s, size };
}

/** 画像の指定範囲を 256px の正方形に描いて返す。WebP に対応しないブラウザでは PNG */
export async function renderAvatar(image: CanvasImageSource, rect: { x: number; y: number; size: number }): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像を処理できませんでした");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, rect.x, rect.y, rect.size, rect.size, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  const toBlob = (type: string, quality?: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  const webp = await toBlob("image/webp", 0.86);
  const blob = webp?.type === "image/webp" ? webp : await toBlob("image/png");
  if (!blob) throw new Error("画像を処理できませんでした");
  return blob;
}
