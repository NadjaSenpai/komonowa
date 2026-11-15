import { describe, expect, it } from "vitest";
import { Client, adminClient, createArticle, json, memberClient } from "./helpers";

async function listTitles(c: Client, query = "") {
  const { articles } = await json(await c.get(`/api/articles${query}`));
  return articles.map((a: { title: string; pinned: boolean }) => `${a.pinned ? "*" : ""}${a.title}`);
}

describe("ピン留め", () => {
  it("未ログインでは付け外しできない", async () => {
    const admin = await adminClient();
    const article = await createArticle(admin);
    const anon = new Client();
    expect((await anon.post(`/api/articles/${article.id}/pin`)).status).toBe(401);
    expect((await anon.del(`/api/articles/${article.id}/pin`)).status).toBe(401);
  });

  it("メンバーも管理者も付け外しでき、一覧の先頭に新しく付けた順で出る。版と更新日時は変わらない", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    const a = await createArticle(client, { title: "A" });
    const b = await createArticle(client, { title: "B" });
    await createArticle(client, { title: "C" });
    expect(await listTitles(client)).toEqual(["C", "B", "A"]);

    expect((await client.post(`/api/articles/${a.id}/pin`)).status).toBe(200);
    expect((await admin.post(`/api/articles/${b.id}/pin`)).status).toBe(200);
    expect(await listTitles(client)).toEqual(["*B", "*A", "C"]);

    const view = (await json(await client.get(`/api/articles/${a.id}`))).article;
    expect(view.pinned_at).toEqual(expect.any(Number));
    expect(view).toMatchObject({ version: 1, updated_at: a.updated_at });

    // もう一度付けても順番は変わらない
    await client.post(`/api/articles/${a.id}/pin`);
    expect(await listTitles(client)).toEqual(["*B", "*A", "C"]);

    expect((await admin.del(`/api/articles/${b.id}/pin`)).status).toBe(200);
    expect(await listTitles(client)).toEqual(["*A", "C", "B"]);
  });

  it("検索やタグで絞り込んだときは、更新の新しい順のまま", async () => {
    const admin = await adminClient();
    const old = await createArticle(admin, { title: "古い手順", tags: ["手順"] });
    await createArticle(admin, { title: "新しい手順", tags: ["手順"] });
    await admin.post(`/api/articles/${old.id}/pin`);
    expect(await listTitles(admin)).toEqual(["*古い手順", "新しい手順"]);
    expect(await listTitles(admin, "?q=手順")).toEqual(["新しい手順", "*古い手順"]);
    expect(await listTitles(admin, `?tag=${encodeURIComponent("手順")}`)).toEqual(["新しい手順", "*古い手順"]);
  });

  it("ない記事とごみ箱の記事は 404。ごみ箱に入れるとピン留めは外れ、戻しても付かない", async () => {
    const admin = await adminClient();
    const article = await createArticle(admin, { title: "捨てる" });
    expect((await admin.post(`/api/articles/${crypto.randomUUID()}/pin`)).status).toBe(404);
    await admin.post(`/api/articles/${article.id}/pin`);
    await admin.del(`/api/articles/${article.id}`);
    expect((await admin.post(`/api/articles/${article.id}/pin`)).status).toBe(404);
    expect((await admin.del(`/api/articles/${article.id}/pin`)).status).toBe(404);
    await admin.post(`/api/admin/trash/${article.id}/restore`);
    expect(await listTitles(admin)).toEqual(["捨てる"]);
  });
});
