import { describe, expect, it } from "vitest";
import { sharedHtml } from "../share";

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

  it("外部リンクはそのまま", () => {
    const root = mount("[外](https://example.com/a)");
    expect(root.querySelector("a")?.getAttribute("href")).toBe("https://example.com/a");
  });
});
