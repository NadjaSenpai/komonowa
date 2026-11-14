import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { Client, adminClient, createArticle, json, memberClient } from "./helpers";

const shareOf = async (c: Client, id: string) => (await json(await c.get(`/api/articles/${id}`))).share;
const rowCount = async (id: string) =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM article_shares WHERE article_id = ?").bind(id).first<number>("n")) ?? 0;

describe("共有の開始と停止", () => {
  it("未ログインでは共有を始めたり止めたりできない", async () => {
    const admin = await adminClient();
    const article = await createArticle(admin);
    expect((await new Client().post(`/api/articles/${article.id}/share`)).status).toBe(401);
    expect((await new Client().del(`/api/articles/${article.id}/share`)).status).toBe(401);
  });

  it("メンバーが始めると共有 URL ができ、もう一度押しても同じ URL", async () => {
    const admin = await adminClient();
    const member = await memberClient(admin);
    const article = await createArticle(admin);
    const first = await member.client.post(`/api/articles/${article.id}/share`);
    expect(first.status).toBe(201);
    const { share } = await json(first);
    expect(share.url).toMatch(/^https:\/\/wiki\.example\.com\/s\/[A-Za-z0-9_-]{40,}$/);
    expect(share.created_by_name).toBe(member.user.name);
    expect(typeof share.created_at).toBe("number");

    const again = await admin.post(`/api/articles/${article.id}/share`);
    expect(again.status).toBe(200);
    expect((await json(again)).share.url).toBe(share.url);
    expect((await shareOf(member.client, article.id)).url).toBe(share.url);
  });

  it("止めると share は null になり、また始めると別の URL になる", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    const article = await createArticle(client);
    const before = (await json(await client.post(`/api/articles/${article.id}/share`))).share.url;
    expect((await client.del(`/api/articles/${article.id}/share`)).status).toBe(200);
    expect(await shareOf(client, article.id)).toBeNull();
    const after = (await json(await client.post(`/api/articles/${article.id}/share`))).share.url;
    expect(after).not.toBe(before);
  });

  it("ごみ箱の記事は共有できず、ごみ箱に入れると共有が止まり、戻しても止まったまま", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    const article = await createArticle(client);
    await client.post(`/api/articles/${article.id}/share`);
    await client.del(`/api/articles/${article.id}`);
    expect(await rowCount(article.id)).toBe(0);
    expect((await client.post(`/api/articles/${article.id}/share`)).status).toBe(404);
    expect((await admin.post(`/api/admin/trash/${article.id}/restore`)).status).toBe(200);
    expect(await shareOf(client, article.id)).toBeNull();
  });

  it("完全削除で共有の記録も消える", async () => {
    const admin = await adminClient();
    const article = await createArticle(admin);
    await admin.post(`/api/articles/${article.id}/share`);
    await env.DB.prepare("UPDATE articles SET deleted_at = ? WHERE id = ?").bind(Date.now(), article.id).run();
    expect((await admin.del(`/api/admin/trash/${article.id}`)).status).toBe(200);
    expect(await rowCount(article.id)).toBe(0);
  });
});

describe("管理者による共有の一覧と停止", () => {
  it("メンバーは使えない", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    const article = await createArticle(client);
    await client.post(`/api/articles/${article.id}/share`);
    expect((await client.get("/api/admin/shares")).status).toBe(403);
    expect((await client.del(`/api/admin/shares/${article.id}`)).status).toBe(403);
    expect((await new Client().get("/api/admin/shares")).status).toBe(401);
  });

  it("管理者は共有中の記事を一覧で見て止められる", async () => {
    const admin = await adminClient();
    const member = await memberClient(admin);
    const article = await createArticle(member.client, { title: "共有する手順書" });
    await member.client.post(`/api/articles/${article.id}/share`);
    const { shares } = await json(await admin.get("/api/admin/shares"));
    expect(shares).toEqual([
      { article_id: article.id, title: "共有する手順書", created_at: expect.any(Number), created_by_name: member.user.name },
    ]);
    expect((await admin.del(`/api/admin/shares/${article.id}`)).status).toBe(200);
    expect((await json(await admin.get("/api/admin/shares"))).shares).toEqual([]);
    expect((await admin.del(`/api/admin/shares/${article.id}`)).status).toBe(404);
  });
});
