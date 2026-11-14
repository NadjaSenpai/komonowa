import { describe, expect, it } from "vitest";
import { attachmentMarkdown, namePastedFile, referencedIds } from "../upload";

describe("attachmentMarkdown", () => {
  it("画像は埋め込み、それ以外はリンク。名前の角かっこは除く", () => {
    expect(attachmentMarkdown({ id: "a1", filename: "図[1].png", content_type: "image/png" })).toBe("![図1.png](/api/attachments/a1)");
    expect(attachmentMarkdown({ id: "z9", filename: "資料.zip", content_type: "application/zip" })).toBe("[資料.zip](/api/attachments/z9)");
  });
});

describe("namePastedFile", () => {
  it("貼り付けの既定名 image.png は日時の名前にする", () => {
    const file = new File(["x"], "image.png", { type: "image/png" });
    const renamed = namePastedFile(file, new Date(2026, 10, 14, 9, 5, 7));
    expect(renamed.name).toBe("貼り付け-20261114-090507.png");
    expect(renamed.type).toBe("image/png");
  });

  it("名前のあるファイルはそのまま", () => {
    const file = new File(["x"], "旅行.jpg", { type: "image/jpeg" });
    expect(namePastedFile(file)).toBe(file);
  });
});

describe("referencedIds", () => {
  it("本文に残っている添付だけを返す", () => {
    const body = "はじめ\n![a](/api/attachments/id-1)\n終わり";
    expect(referencedIds(body, ["id-1", "id-2"])).toEqual(["id-1"]);
  });
});
