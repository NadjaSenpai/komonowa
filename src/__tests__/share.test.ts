import { describe, expect, it } from "vitest";
import { cleanPasscode, sharedHtml } from "../share";

const TOKEN = "tok_ABCdef0123456789-xyz";
const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

function mount(body: string) {
  const root = document.createElement("div");
  root.innerHTML = sharedHtml(body, TOKEN);
  return root;
}

describe("共有ページの本文", () => {
  it("添付の画像とリンクを共有用の URL に読み替える", () => {
    const root = mount(`![図](/api/attachments/${ID})\n\n[資料](/api/attachments/${ID})`);
    expect(root.querySelector("img")?.getAttribute("src")).toBe(`/api/share/${TOKEN}/attachments/${ID}`);
    expect(root.querySelector("a")?.getAttribute("href")).toBe(`/api/share/${TOKEN}/attachments/${ID}`);
    expect(root.innerHTML).not.toContain("/api/attachments/");
  });

  it("記事リンクはただの文字にする", () => {
    const root = mount("前に [[ほかの記事]] を読む");
    expect(root.querySelector("a")).toBeNull();
    expect(root.textContent).toContain("ほかの記事");
    expect(root.innerHTML).not.toContain("/wiki/");
  });

  it("人へのリンクもただの文字にする（外の人にユーザーページの場所を渡さない）", () => {
    const root = mount(`担当は [@なかの](/users/${ID}) です`);
    expect(root.querySelector("a")).toBeNull();
    expect(root.textContent).toContain("@なかの");
    expect(root.innerHTML).not.toContain("/users/");
  });

  it("外部リンクはそのまま", () => {
    const root = mount("[外](https://example.com/a)");
    expect(root.querySelector("a")?.getAttribute("href")).toBe("https://example.com/a");
  });
});

describe("パスワードの入力", () => {
  it("数字だけを 6 桁まで残す", () => {
    expect(cleanPasscode("12 34-56")).toBe("123456");
    // 日本語入力の全角数字も受け付ける
    expect(cleanPasscode("０１２abc3456789")).toBe("012345");
    expect(cleanPasscode("D1d2")).toBe("12");
  });
});
