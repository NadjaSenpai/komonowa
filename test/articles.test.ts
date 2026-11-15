import { describe, expect, it } from "vitest";
import { adminClient, createArticle, json, memberClient } from "./helpers";

describe("記事", () => {
  it("検索語が本文の後ろでも一致箇所の抜粋を返す", async () => {
    const admin = await adminClient();
    await createArticle(admin, { title: "監査", body: "前".repeat(500) + "検索目印" + "後".repeat(500) });
    const { articles } = await json(await admin.get(`/api/articles?q=${encodeURIComponent("検索目印")}`));
    expect(articles).toHaveLength(1);
    expect(articles[0].excerpt).toContain("検索目印");
    expect(articles[0].excerpt.length).toBeLessThanOrEqual(162);
  });
  it("作成・取得・編集で版が進み、履歴が残る", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    const article = await createArticle(client, { title: "手順書", body: "# 見出し", tags: ["運用", "手順", "運用"] });
    expect(article.version).toBe(1);
    expect(article.tags).toEqual(["手順", "運用"]);

    const res = await client.put(`/api/articles/${article.id}`, { title: "手順書 v2", body: "更新", tags: ["運用"], baseVersion: 1 });
    expect(res.status).toBe(200);
    const updated = (await json(res)).article;
    expect(updated.version).toBe(2);
    expect(updated.tags).toEqual(["運用"]);

    const { revisions } = await json(await client.get(`/api/articles/${article.id}/revisions`));
    expect(revisions.map((r: any) => [r.version, r.action])).toEqual([
      [2, "edit"],
      [1, "create"],
    ]);
    const v1 = (await json(await client.get(`/api/articles/${article.id}/revisions/1`))).revision;
    expect(v1).toMatchObject({ title: "手順書", body: "# 見出し", tags: ["運用", "手順"] });
  });

  it("古い版を元に保存すると競合として拒否し、何も書き込まない", async () => {
    const admin = await adminClient();
    const a = await memberClient(admin);
    const b = await memberClient(admin);
    const article = await createArticle(a.client, { title: "共有", tags: ["x"] });
    expect((await a.client.put(`/api/articles/${article.id}`, { title: "A の編集", body: "a", tags: ["a"], baseVersion: 1 })).status).toBe(200);

    const conflict = await b.client.put(`/api/articles/${article.id}`, { title: "B の編集", body: "b", tags: ["b"], baseVersion: 1 });
    expect(conflict.status).toBe(409);
    const body = await json(conflict);
    expect(body.current).toMatchObject({ title: "A の編集", version: 2, tags: ["a"] });

    const { revisions } = await json(await b.client.get(`/api/articles/${article.id}/revisions`));
    expect(revisions).toHaveLength(2);
    const { tags } = await json(await b.client.get("/api/articles/tags"));
    expect(tags.find((t: any) => t.name === "b")).toBeUndefined();
  });

  it("同時に保存しても片方だけ成功する", async () => {
    const admin = await adminClient();
    const article = await createArticle(admin);
    const results = await Promise.all(
      [1, 2, 3].map((n) => admin.put(`/api/articles/${article.id}`, { title: `同時${n}`, body: "", tags: [], baseVersion: 1 })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
  });

  it("過去の版を復元すると新しい版として記録する", async () => {
    const admin = await adminClient();
    const article = await createArticle(admin, { title: "初版", body: "one", tags: ["t1"] });
    await admin.put(`/api/articles/${article.id}`, { title: "第二版", body: "two", tags: ["t2"], baseVersion: 1 });
    const res = await admin.post(`/api/articles/${article.id}/revisions/1/restore`, { baseVersion: 2 });
    expect(res.status).toBe(200);
    expect((await json(res)).article).toMatchObject({ title: "初版", body: "one", tags: ["t1"], version: 3 });
    expect((await admin.post(`/api/articles/${article.id}/revisions/1/restore`, { baseVersion: 2 })).status).toBe(409);
    const { revisions } = await json(await admin.get(`/api/articles/${article.id}/revisions`));
    expect(revisions[0]).toMatchObject({ version: 3, action: "restore" });
  });

  it("入力を検証する", async () => {
    const admin = await adminClient();
    expect((await admin.post("/api/articles", { title: "", body: "x" })).status).toBe(400);
    expect((await admin.post("/api/articles", { title: "x", body: 1 })).status).toBe(400);
    expect((await admin.post("/api/articles", { title: "x", body: "", tags: ["a,b"] })).status).toBe(400);
    expect((await admin.post("/api/articles", { title: "x", body: "", tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })).status).toBe(400);
    const article = await createArticle(admin);
    expect((await admin.put(`/api/articles/${article.id}`, { title: "x", body: "" })).status).toBe(400);
  });

  it("タイトルに半角の [ ] は使えない（[[ ]] でリンクできなくなるため）。全角の［］は使える", async () => {
    const admin = await adminClient();
    const message = "タイトルに [ ] は使えません。［ ］（全角）なら使えます";
    for (const title of ["[重要] 手順", "配列a]", "a[b"]) {
      const res = await admin.post("/api/articles", { title, body: "", tags: [] });
      expect(res.status).toBe(400);
      expect((await json(res)).error).toBe(message);
    }
    const article = await createArticle(admin, { title: "［重要］ 手順" });
    const res = await admin.put(`/api/articles/${article.id}`, { title: "[重要] 手順", body: "", tags: [], baseVersion: 1 });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe(message);
  });
});

describe("検索とタグ", () => {
  it("キーワードは AND、タグは複数指定で AND 絞り込み", async () => {
    const admin = await adminClient();
    await createArticle(admin, { title: "VPN 接続手順", body: "社外から接続する方法", tags: ["ネットワーク", "手順"] });
    await createArticle(admin, { title: "プリンター設定", body: "ネットワークプリンターの手順", tags: ["手順"] });
    await createArticle(admin, { title: "100% 完了の定義", body: "a_b", tags: ["ネットワーク"] });

    const titles = async (qs: string) => (await json(await admin.get(`/api/articles?${qs}`))).articles.map((a: any) => a.title).sort();

    expect(await titles(`q=${encodeURIComponent("手順")}`)).toEqual(["VPN 接続手順", "プリンター設定"]);
    expect(await titles(`q=${encodeURIComponent("接続 社外")}`)).toEqual(["VPN 接続手順"]);
    expect(await titles(`tag=${encodeURIComponent("手順")}`)).toEqual(["VPN 接続手順", "プリンター設定"]);
    expect(await titles(`tag=${encodeURIComponent("手順")}&tag=${encodeURIComponent("ネットワーク")}`)).toEqual(["VPN 接続手順"]);
    expect(await titles(`q=${encodeURIComponent("プリンター")}&tag=${encodeURIComponent("ネットワーク")}`)).toEqual([]);
    // LIKE のワイルドカードは文字どおりに扱う
    expect(await titles(`q=${encodeURIComponent("%")}`)).toEqual(["100% 完了の定義"]);
    expect(await titles(`q=${encodeURIComponent("_")}`)).toEqual(["100% 完了の定義"]);
  });

  it("管理者はタグを改名・削除でき、メンバーはできない", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    const article = await createArticle(client, { tags: ["旧名", "別"] });
    const { tags } = await json(await client.get("/api/articles/tags"));
    const old = tags.find((t: any) => t.name === "旧名");
    expect(old.count).toBe(1);

    expect((await client.patch(`/api/admin/tags/${old.id}`, { name: "新名" })).status).toBe(403);
    expect((await admin.patch(`/api/admin/tags/${old.id}`, { name: "別" })).status).toBe(409);
    expect((await admin.patch(`/api/admin/tags/${old.id}`, { name: "新名" })).status).toBe(200);
    expect((await json(await client.get(`/api/articles/${article.id}`))).article.tags).toEqual(["別", "新名"]);

    expect((await client.del(`/api/admin/tags/${old.id}`)).status).toBe(403);
    expect((await admin.del(`/api/admin/tags/${old.id}`)).status).toBe(200);
    expect((await json(await client.get(`/api/articles/${article.id}`))).article.tags).toEqual(["別"]);
  });
});

describe("削除と復元", () => {
  it("メンバーは削除でき、復元・完全削除は管理者のみ", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    const article = await createArticle(client, { title: "消す記事" });
    expect((await client.del(`/api/articles/${article.id}`)).status).toBe(200);
    expect((await client.get(`/api/articles/${article.id}`)).status).toBe(404);
    expect((await json(await client.get("/api/articles"))).articles).toHaveLength(0);
    expect((await client.put(`/api/articles/${article.id}`, { title: "x", body: "", baseVersion: 1 })).status).toBe(404);
    expect((await client.get(`/api/articles/${article.id}/revisions`)).status).toBe(404);

    expect((await client.get("/api/admin/trash")).status).toBe(403);
    expect((await client.post(`/api/admin/trash/${article.id}/restore`)).status).toBe(403);
    expect((await json(await admin.get("/api/admin/trash"))).articles.map((a: any) => a.title)).toEqual(["消す記事"]);
    expect((await admin.post(`/api/admin/trash/${article.id}/restore`)).status).toBe(200);
    expect((await client.get(`/api/articles/${article.id}`)).status).toBe(200);

    await client.del(`/api/articles/${article.id}`);
    expect((await client.del(`/api/admin/trash/${article.id}`)).status).toBe(403);
    expect((await admin.del(`/api/admin/trash/${article.id}`)).status).toBe(200);
    expect((await admin.post(`/api/admin/trash/${article.id}/restore`)).status).toBe(404);
  });

  it("ごみ箱にない記事は完全削除できない", async () => {
    const admin = await adminClient();
    const article = await createArticle(admin);
    expect((await admin.del(`/api/admin/trash/${article.id}`)).status).toBe(404);
  });

  it("無効化したメンバーの記事と履歴は残る", async () => {
    const admin = await adminClient();
    const member = await memberClient(admin);
    const article = await createArticle(member.client, { title: "退会者の記事" });
    await admin.patch(`/api/admin/users/${member.user.id}`, { status: "disabled" });
    const got = await json(await admin.get(`/api/articles/${article.id}`));
    expect(got.article).toMatchObject({ title: "退会者の記事", created_by_name: member.user.name });
    expect((await json(await admin.get(`/api/articles/${article.id}/revisions`))).revisions).toHaveLength(1);
  });
});

describe("タイトルの重複", () => {
  const SAME = "同じタイトルの記事がすでにあります";

  it("正規化して同じになるタイトルは作れない", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    await createArticle(client, { title: "Docker 入門" });
    const res = await client.post("/api/articles", { title: "ｄｏｃｋｅｒ　入門", body: "", tags: [] });
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe(SAME);
  });

  it("編集でほかの記事と同じタイトルにはできないが、自分の大文字小文字は変えられる", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    const a = await createArticle(client, { title: "docker" });
    const b = await createArticle(client, { title: "メモ" });
    const clash = await client.put(`/api/articles/${b.id}`, { title: "DOCKER", body: "", tags: [], baseVersion: 1 });
    expect(clash.status).toBe(409);
    expect((await json(clash)).error).toBe(SAME);
    expect((await client.put(`/api/articles/${a.id}`, { title: "Docker", body: "", tags: [], baseVersion: 1 })).status).toBe(200);
  });

  it("版の復元でほかの記事とぶつかると 409", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    const a = await createArticle(client, { title: "旧名" });
    expect((await client.put(`/api/articles/${a.id}`, { title: "新名", body: "", tags: [], baseVersion: 1 })).status).toBe(200);
    await createArticle(client, { title: "旧名" });
    const res = await client.post(`/api/articles/${a.id}/revisions/1/restore`, { baseVersion: 2 });
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe(SAME);
  });

  it("ごみ箱の記事と同じタイトルは作れ、ごみ箱から戻すときにぶつかれば 409", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    const a = await createArticle(client, { title: "共有" });
    expect((await client.del(`/api/articles/${a.id}`)).status).toBe(200);
    const b = await createArticle(client, { title: "共有" });
    const clash = await admin.post(`/api/admin/trash/${a.id}/restore`);
    expect(clash.status).toBe(409);
    expect((await json(clash)).error).toBe("同じタイトルの記事がすでにあります。どちらかのタイトルを変えてから戻してください");
    expect((await client.put(`/api/articles/${b.id}`, { title: "共有2", body: "", tags: [], baseVersion: 1 })).status).toBe(200);
    expect((await admin.post(`/api/admin/trash/${a.id}/restore`)).status).toBe(200);
  });
});
