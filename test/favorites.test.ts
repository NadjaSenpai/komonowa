import { describe, expect, it } from "vitest";
import { adminClient, Client, createArticle, json, memberClient } from "./helpers";

describe("自分用のお気に入り", () => {
  it("未認証では追加・解除できない", async () => {
    const article = await createArticle(await adminClient());
    expect((await new Client().post(`/api/articles/${article.id}/favorite`)).status).toBe(401);
    expect((await new Client().del(`/api/articles/${article.id}/favorite`)).status).toBe(401);
  });
  it.each(["member", "admin"] as const)("%s のお気に入りは個人別で冪等、絞り込みにも反映", async (role) => {
    const admin = await adminClient();
    const a = await memberClient(admin, role),
      b = await memberClient(admin);
    const article = await createArticle(admin, { title: "検索できる手順", tags: ["運用"] });
    await createArticle(admin);
    for (let i = 0; i < 2; i++) expect((await a.client.post(`/api/articles/${article.id}/favorite`)).status).toBe(200);
    const own = await json(await a.client.get("/api/articles?favorite=1&q=手順&tag=運用"));
    expect(own.articles).toHaveLength(1);
    expect(own.articles[0]).toMatchObject({ id: article.id, favorite: true });
    expect((await json(await a.client.get(`/api/articles/${article.id}`))).favorite).toBe(true);
    expect((await json(await b.client.get("/api/articles?favorite=1"))).articles).toHaveLength(0);
    expect((await json(await b.client.get(`/api/articles/${article.id}`))).favorite).toBe(false);
    await b.client.del(`/api/articles/${article.id}/favorite`);
    expect((await json(await a.client.get("/api/articles?favorite=1"))).articles).toHaveLength(1);
    for (let i = 0; i < 2; i++) expect((await a.client.del(`/api/articles/${article.id}/favorite`)).status).toBe(200);
    expect((await json(await a.client.get("/api/articles?favorite=1"))).articles).toHaveLength(0);
  });
  it("削除済み記事を追加・表示しない", async () => {
    const admin = await adminClient(),
      article = await createArticle(admin);
    await admin.post(`/api/articles/${article.id}/favorite`);
    await admin.del(`/api/articles/${article.id}`);
    expect((await admin.post(`/api/articles/${article.id}/favorite`)).status).toBe(404);
    expect((await json(await admin.get("/api/articles?favorite=1"))).articles).toHaveLength(0);
    expect((await admin.post("/api/articles/not-existing/favorite")).status).toBe(404);
  });
});
