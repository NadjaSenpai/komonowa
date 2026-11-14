import { describe, expect, it } from "vitest";
import { AVATAR_TONES, avatarInitial, avatarTone } from "../userAvatar";

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
