import { describe, expect, it } from "vitest";
import { Client, adminClient, createArticle, json, memberClient } from "./helpers";

type Link = { key: string; id: string | null };

async function view(c: Client, id: string) {
  return json<{ links: Link[]; backlinks: { id: string; title: string; updated_at: number }[] }>(
    await c.get(`/api/articles/${id}`),
  );
}

const byKey = (links: Link[]) => [...links].sort((a, b) => a.key.localeCompare(b.key));

describe("ページ間リンク", () => {
  it("本文のリンク先の有無を返す", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    const target = await createArticle(client, { title: "手順書" });
    const b = await createArticle(client, { body: "[[手順書]] [[まだない]] `[[コード]]`" });
    expect(byKey((await view(client, b.id)).links)).toEqual(
      byKey([
        { key: "まだない", id: null },
        { key: "手順書", id: target.id },
      ]),
    );
  });

  it("被リンクは自分とごみ箱を除き、更新の新しい順", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    const t = await createArticle(client, { title: "目的地", body: "[[目的地]]" });
    const a = await createArticle(client, { body: "[[ 目的地 ]]" });
    const c = await createArticle(client, { body: "[[目的地]]" });
    const b = await createArticle(client, { body: "[[目的地]]" });
    expect((await client.del(`/api/articles/${c.id}`)).status).toBe(200);
    expect((await view(client, t.id)).backlinks.map((x) => x.id)).toEqual([b.id, a.id]);
  });

  it("編集でリンクを外すと被リンクから消え、版の復元で戻る", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    const t = await createArticle(client, { title: "行き先" });
    const a = await createArticle(client, { title: "出発", body: "[[行き先]]" });
    expect((await view(client, t.id)).backlinks.map((x) => x.id)).toEqual([a.id]);
    expect((await client.put(`/api/articles/${a.id}`, { title: "出発", body: "外した", tags: [], baseVersion: 1 })).status).toBe(200);
    expect((await view(client, t.id)).backlinks).toEqual([]);
    expect((await client.post(`/api/articles/${a.id}/revisions/1/restore`, { baseVersion: 2 })).status).toBe(200);
    expect((await view(client, t.id)).backlinks.map((x) => x.id)).toEqual([a.id]);
  });

  it("タイトルを変えると、旧タイトルへのリンクは未作成になる", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    const t = await createArticle(client, { title: "旧" });
    const b = await createArticle(client, { body: "[[旧]]" });
    expect((await client.put(`/api/articles/${t.id}`, { title: "新", body: "", tags: [], baseVersion: 1 })).status).toBe(200);
    expect((await view(client, b.id)).links).toEqual([{ key: "旧", id: null }]);
  });

  it("本文にリンクがたくさんあっても保存できる", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    const body = Array.from({ length: 300 }, (_, i) => `[[ページ${i}]]`).join(" ");
    const a = await createArticle(client, { body });
    expect((await view(client, a.id)).links).toHaveLength(300);
  });
});

describe("タイトルで記事を引く", () => {
  it("by-title は正規化して引け、ごみ箱やない記事は 404", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    const a = await createArticle(client, { title: "a/b?c#d%" });
    const res = await client.get(`/api/articles/by-title/${encodeURIComponent("Ａ/B?c#d%")}`);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ id: a.id });
    expect((await client.get(`/api/articles/by-title/${encodeURIComponent("ない")}`)).status).toBe(404);
    expect((await client.del(`/api/articles/${a.id}`)).status).toBe(200);
    expect((await client.get(`/api/articles/by-title/${encodeURIComponent("a/b?c#d%")}`)).status).toBe(404);
  });

  it("by-title の認可", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    await createArticle(client, { title: "公開" });
    const path = `/api/articles/by-title/${encodeURIComponent("公開")}`;
    expect((await new Client().get(path)).status).toBe(401);
    expect((await client.get(path)).status).toBe(200);
    expect((await admin.get(path)).status).toBe(200);
  });
});
