import { describe, expect, it } from "vitest";
import { Client, adminClient, createArticle, json, memberClient } from "./helpers";

describe("タイトルの候補", () => {
  it("未ログインでは取れない", async () => {
    await adminClient();
    expect((await new Client().get("/api/articles/titles?q=a")).status).toBe(401);
  });

  it("タイトルに含む記事を更新の新しい順に返す。全角半角・大文字小文字は区別せず、ごみ箱の記事は出さない", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    await createArticle(admin, { title: "API 設計メモ" });
    await createArticle(admin, { title: "ａｐｉの使い方" });
    await createArticle(admin, { title: "100%の話" });
    const trashed = await createArticle(admin, { title: "api 古いメモ" });
    await admin.del(`/api/articles/${trashed.id}`);

    expect((await json(await client.get("/api/articles/titles?q=api"))).titles).toEqual(["ａｐｉの使い方", "API 設計メモ"]);
    expect((await json(await client.get(`/api/articles/titles?q=${encodeURIComponent("%")}`))).titles).toEqual(["100%の話"]);
    expect((await json(await client.get("/api/articles/titles"))).titles).toEqual(["100%の話", "ａｐｉの使い方", "API 設計メモ"]);
  });

  it("8件まで", async () => {
    const admin = await adminClient();
    for (let i = 0; i < 10; i++) await createArticle(admin, { title: `候補 ${i}` });
    expect((await json(await admin.get("/api/articles/titles?q=候補"))).titles).toHaveLength(8);
  });
});
