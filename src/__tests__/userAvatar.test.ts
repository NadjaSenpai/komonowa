import { describe, expect, it } from "vitest";
import { AVATAR_TONES, avatarInitial, avatarTone, clampOffset, cropRect } from "../userAvatar";

describe("avatarInitial", () => {
  it("先頭の1文字を返し、英字は大文字にする", () => {
    expect(avatarInitial("山田 太郎")).toBe("山");
    expect(avatarInitial("nadja")).toBe("N");
    expect(avatarInitial("  ふか")).toBe("ふ");
  });

  it("結合文字や絵文字も1文字として扱う", () => {
    expect(avatarInitial("👩‍💻 dev")).toBe("👩‍💻");
    expect(avatarInitial("がき")).toBe("が");
  });

  it("空の名前は ? にする", () => {
    expect(avatarInitial("   ")).toBe("?");
  });
});

describe("avatarTone", () => {
  it("同じ ID なら同じ色、範囲は 1〜AVATAR_TONES", () => {
    const id = "a48ea13e-d43b-450a-813a-08dbe1c1258a";
    expect(avatarTone(id)).toBe(avatarTone(id));
    const tones = new Set(Array.from({ length: 200 }, (_, i) => avatarTone(`user-${i}`)));
    expect([...tones].every((t) => t >= 1 && t <= AVATAR_TONES)).toBe(true);
    expect(tones.size).toBe(AVATAR_TONES);
  });
});

describe("clampOffset / cropRect", () => {
  const landscape = { width: 400, height: 200, view: 100, zoom: 1 };

  it("拡大なし・ずらしなしなら短辺いっぱいの中央を切り抜く", () => {
    expect(cropRect(landscape, { x: 0, y: 0 })).toEqual({ x: 100, y: 0, size: 200 });
  });

  it("はみ出している方向にだけずらせて、枠に余白は出ない", () => {
    // 表示上の画像は 200x100、枠は 100 なので横は ±50px、縦は 0
    expect(clampOffset(landscape, { x: 80, y: 30 })).toEqual({ x: 50, y: 0 });
    expect(cropRect(landscape, { x: 50, y: 0 })).toEqual({ x: 0, y: 0, size: 200 });
    expect(cropRect(landscape, { x: -50, y: 0 })).toEqual({ x: 200, y: 0, size: 200 });
  });

  it("2倍に拡大すると半分の範囲を切り抜き、縦にも動かせる", () => {
    const zoomed = { ...landscape, zoom: 2 };
    expect(cropRect(zoomed, { x: 0, y: 0 })).toEqual({ x: 150, y: 50, size: 100 });
    expect(clampOffset(zoomed, { x: 999, y: -999 })).toEqual({ x: 150, y: -50 });
    expect(cropRect(zoomed, { x: 150, y: -50 })).toEqual({ x: 0, y: 100, size: 100 });
  });
});
