import { describe, expect, it } from "vitest";
import { THUMB_MAX, thumbSize } from "../thumbnail";

describe("小さい版の大きさ", () => {
  it("長辺を 400px に収め、縦横比を保つ", () => {
    expect(THUMB_MAX).toBe(400);
    expect(thumbSize(4000, 3000)).toEqual({ width: 400, height: 300 });
    expect(thumbSize(300, 1200)).toEqual({ width: 100, height: 400 });
  });

  it("小さい画像は拡大しない", () => {
    expect(thumbSize(200, 100)).toEqual({ width: 200, height: 100 });
  });

  it("極端に細長くても 1px は残す", () => {
    expect(thumbSize(4000, 1)).toEqual({ width: 400, height: 1 });
  });
});
