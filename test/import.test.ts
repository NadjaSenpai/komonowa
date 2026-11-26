import { afterEach, describe, expect, it, vi } from "vitest";
import { Client, adminClient, createArticle, json, memberClient } from "./helpers";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const page = (data: Record<string, unknown> = {}) => ({
  title: `取り込み-${crypto.randomUUID().slice(0, 8)}`,
  body: "本文",
  tags: [],
  created: Date.UTC(2024, 0, 1),
  updated: Date.UTC(2024, 5, 1),
  ...data,
});

afterEach(() => vi.restoreAllMocks());

describe("Cosense の取り込み（1 ページ）", () => {
  it("ログインしていなければ 401", async () => {
    expect((await new Client().post("/api/import/cosense/pages", page())).status).toBe(401);
  });

  it("メンバーと管理者が取り込め、日付を引き継ぐ", async () => {
    const admin = await adminClient();
    const { client: member } = await memberClient(admin);
    for (const client of [admin, member]) {
      const res = await client.post("/api/import/cosense/pages", page({ tags: ["メモ"] }));
      expect(res.status).toBe(201);
      const { article, images } = await json(res);
      expect(images).toEqual({ saved: 0, failed: 0 });
      const loaded = (await json(await client.get(`/api/articles/${article.id}`))).article;
      expect(loaded.created_at).toBe(Date.UTC(2024, 0, 1));
      expect(loaded.updated_at).toBe(Date.UTC(2024, 5, 1));
      expect(loaded.tags).toEqual(["メモ"]);
      const { revisions } = await json(await client.get(`/api/articles/${article.id}/revisions`));
      expect(revisions.map((r: any) => [r.action, r.created_at])).toEqual([["create", Date.UTC(2024, 5, 1)]]);
    }
  });

  it("範囲外の日付は現在時刻にする", async () => {
    const admin = await adminClient();
    const before = Date.now();
    const { article } = await json(await admin.post("/api/import/cosense/pages", page({ created: Date.UTC(1999, 0, 1), updated: Date.now() + 86_400_000 })));
    const loaded = (await json(await admin.get(`/api/articles/${article.id}`))).article;
    expect(loaded.created_at).toBeGreaterThanOrEqual(before);
    expect(loaded.updated_at).toBeGreaterThanOrEqual(before);
  });

  it("許可リストの画像を添付として保存し、本文の URL を書き換える", async () => {
    const admin = await adminClient();
    const fetchImage = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(PNG));
    const res = await admin.post("/api/import/cosense/pages", page({ body: "前\n![](https://scrapbox.io/files/abc.png)\n後" }));
    expect(res.status).toBe(201);
    const { article, images } = await json(res);
    expect(images).toEqual({ saved: 1, failed: 0 });
    expect(String(fetchImage.mock.calls[0]![0])).toBe("https://scrapbox.io/files/abc.png");
    const loaded = (await json(await admin.get(`/api/articles/${article.id}`))).article;
    const m = /!\[\]\(\/api\/attachments\/([0-9a-f-]{36})\)/.exec(loaded.body);
    expect(m).not.toBeNull();
    expect(loaded.body.startsWith("前\n")).toBe(true);
    const { articles } = await json(await admin.get("/api/articles"));
    expect(articles.find((a: any) => a.id === article.id).cover).toBe(m![1]);
  });

  it("許可リスト外の URL は取りに行かず、そのまま残す", async () => {
    const admin = await adminClient();
    const fetchImage = vi.spyOn(globalThis, "fetch");
    const body = "![](https://evil.example/x.png)";
    const { article, images } = await json(await admin.post("/api/import/cosense/pages", page({ body })));
    expect(fetchImage).not.toHaveBeenCalled();
    expect(images).toEqual({ saved: 0, failed: 0 });
    expect((await json(await admin.get(`/api/articles/${article.id}`))).article.body).toBe(body);
  });

  it("取れない画像は URL のまま残し、失敗に数える", async () => {
    const admin = await adminClient();
    const responses = [new Response("no", { status: 404 }), new Response("<html>", { status: 200 }), new Response(new Uint8Array(10 * 1024 * 1024 + 1))];
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => responses.shift()!);
    const body = ["![](https://scrapbox.io/files/a.png)", "![](https://scrapbox.io/files/b.png)", "![](https://scrapbox.io/files/c.png)"].join("\n");
    const res = await admin.post("/api/import/cosense/pages", page({ body }));
    expect(res.status).toBe(201);
    const { article, images } = await json(res);
    expect(images).toEqual({ saved: 0, failed: 3 });
    expect((await json(await admin.get(`/api/articles/${article.id}`))).article.body).toBe(body);
  });

  it("Gyazo のページ URL は oEmbed で画像の URL を得る", async () => {
    const admin = await adminClient();
    const fetchImage = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://api.gyazo.com/api/oembed")) return Response.json({ url: "https://i.gyazo.com/abc.png" });
      if (url === "https://i.gyazo.com/abc.png") return new Response(PNG);
      return new Response("no", { status: 404 });
    });
    const { images } = await json(await admin.post("/api/import/cosense/pages", page({ body: "![](https://gyazo.com/abc)" })));
    expect(images).toEqual({ saved: 1, failed: 0 });
    expect(new URL(String(fetchImage.mock.calls[0]![0])).searchParams.get("url")).toBe("https://gyazo.com/abc");
  });

  it("同じタイトルの記事があれば 409 で、既存の記事は変わらない", async () => {
    const admin = await adminClient();
    const existing = await createArticle(admin, { title: "手順書", body: "元の本文" });
    const res = await admin.post("/api/import/cosense/pages", page({ title: "手順書", body: "上書き" }));
    expect(res.status).toBe(409);
    const loaded = (await json(await admin.get(`/api/articles/${existing.id}`))).article;
    expect(loaded.body).toBe("元の本文");
    expect(loaded.version).toBe(1);
  });
});
