import { describe, expect, it } from "vitest";
import { firstVideoLine } from "./youtube";

const ID = "jNQXAC9IVRw";
const URL = `https://youtu.be/${ID}`;

describe("firstVideoLine", () => {
  it("YouTube の URL だけの行（前後が空行）を見つけ、本文での位置を返す", () => {
    expect(firstVideoLine(URL)).toEqual({ id: ID, index: 0 });
    expect(firstVideoLine(`前の文\n\n${URL}?t=90\n\n後の文`)).toEqual({ id: ID, index: 5 });
    expect(firstVideoLine(`前の文\r\n\r\n${URL}\r\n\r\n後の文`)).toEqual({ id: ID, index: 7 });
  });

  it("最初の1つを返す", () => {
    expect(firstVideoLine(`https://www.youtube.com/watch?v=aaaaaaaaaaa\n\n${URL}`)?.id).toBe("aaaaaaaaaaa");
  });

  it("文中・続きの行・箇条書き・コードブロックの中・ほかのサイトは数えない", () => {
    for (const body of [
      `この動画 ${URL} を見て`,
      `${URL}\n続きの行`,
      `前の行\n${URL}`,
      `- ${URL}`,
      `[動画](${URL})`,
      `\`\`\`\n\n${URL}\n\n\`\`\``,
      `~~~text\n\n${URL}\n\n~~~`,
      "https://example.com/watch?v=jNQXAC9IVRw",
      "https://www.youtube.com/playlist?list=PL123",
      "",
    ]) {
      expect(firstVideoLine(body), body).toBeNull();
    }
  });

  it("コードブロックが閉じたあとの行は数える", () => {
    expect(firstVideoLine(`\`\`\`\ncode\n\`\`\`\n\n${URL}`)?.id).toBe(ID);
  });
});
