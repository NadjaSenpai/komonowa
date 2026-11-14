import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { Client, adminClient, createArticle, json, memberClient } from "./helpers";

const shareOf = async (c: Client, id: string) => (await json(await c.get(`/api/articles/${id}`))).share;
const rowCount = async (id: string) => (await env.DB.prepare("SELECT COUNT(*) AS n FROM article_shares WHERE article_id = ?").bind(id).first<number>("n")) ?? 0;

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
      { article_id: article.id, title: "共有する手順書", created_at: expect.any(Number), created_by_name: member.user.name, has_passcode: false },
    ]);
    expect((await admin.del(`/api/admin/shares/${article.id}`)).status).toBe(200);
    expect((await json(await admin.get("/api/admin/shares"))).shares).toEqual([]);
    expect((await admin.del(`/api/admin/shares/${article.id}`)).status).toBe(404);
  });
});

describe("共有ページ（ログイン不要）", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 3, 3]);
  const GONE = "共有が見つかりません。共有が止められたか、URL が違います";

  function upload(c: Client, path: string, name = "図.png") {
    const form = new FormData();
    form.append("file", new File([PNG], name));
    return c.request(path, { method: "POST", body: form });
  }
  async function start(c: Client, id: string) {
    const { share } = await json(await c.post(`/api/articles/${id}/share`));
    return share.url.split("/s/")[1] as string;
  }
  const anon = () => new Client();

  it("ログインなしで、タイトル・本文・更新日だけを読める", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    const article = await createArticle(client, { title: "手順書", body: "# 手順\n1. する", tags: ["ひみつ"] });
    const token = await start(client, article.id);
    const res = await anon().get(`/api/share/${token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive, noai, noimageai");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await json(res);
    expect(Object.keys(body.article).sort()).toEqual(["body", "title", "updated_at"]);
    expect(body.article.title).toBe("手順書");
  });

  it("止めた・ごみ箱・でたらめなトークンは、どれも同じ 404", async () => {
    const admin = await adminClient();
    const article = await createArticle(admin);
    const token = await start(admin, article.id);
    await admin.del(`/api/articles/${article.id}/share`);
    for (const t of [token, "x".repeat(43), "a".repeat(500)]) {
      const res = await anon().get(`/api/share/${t}`);
      expect(res.status).toBe(404);
      expect((await json(res)).error).toBe(GONE);
      expect(res.headers.get("x-robots-tag")).toContain("noindex");
    }
    const other = await createArticle(admin);
    const otherToken = await start(admin, other.id);
    await admin.del(`/api/articles/${other.id}`);
    expect((await anon().get(`/api/share/${otherToken}`)).status).toBe(404);
  });

  it("その記事の添付だけを読める", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    const article = await createArticle(client);
    const mine = (await json(await upload(client, `/api/articles/${article.id}/attachments`))).attachment;
    const otherArticle = await createArticle(client);
    const others = (await json(await upload(client, `/api/articles/${otherArticle.id}/attachments`))).attachment;
    const draft = (await json(await upload(client, "/api/attachments"))).attachment;
    const token = await start(client, article.id);

    const ok = await anon().get(`/api/share/${token}/attachments/${mine.id}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(ok.headers.get("x-robots-tag")).toContain("noai");
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(PNG);

    for (const id of [others.id, draft.id, "00000000-0000-0000-0000-000000000000"]) {
      expect((await anon().get(`/api/share/${token}/attachments/${id}`)).status).toBe(404);
    }
    await client.del(`/api/articles/${article.id}/share`);
    expect((await anon().get(`/api/share/${token}/attachments/${mine.id}`)).status).toBe(404);
  });
});
