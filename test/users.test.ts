import { describe, expect, it } from "vitest";
import { Client, adminClient, createArticle, json, memberClient } from "./helpers";

describe("ユーザーページ", () => {
  it("未ログインでは見られない", async () => {
    const admin = await adminClient();
    const { user } = await memberClient(admin);
    expect((await new Client().get(`/api/users/${user.id}`)).status).toBe(401);
  });

  it("メンバーも管理者も、ほかの人のページを見られる。メールアドレスや権限は出さない", async () => {
    const admin = await adminClient();
    const { client, user } = await memberClient(admin);
    const other = await memberClient(admin);
    await client.patch("/api/auth/profile", { name: user.name, bio: "こんにちは。[[はじめに]] を書きました" });

    for (const viewer of [other.client, admin]) {
      const res = await viewer.get(`/api/users/${user.id}`);
      expect(res.status).toBe(200);
      const page = await json(res);
      expect(page.user).toMatchObject({ id: user.id, name: user.name, avatar_id: null, bio: "こんにちは。[[はじめに]] を書きました" });
      expect(Object.keys(page.user).sort()).toEqual(["avatar_id", "bio", "created_at", "id", "name"]);
    }
  });

  it("その人が作成した記事を更新の新しい順に出し、ほかの人の記事とごみ箱の記事は出さない", async () => {
    const admin = await adminClient();
    const { client, user } = await memberClient(admin);
    const first = await createArticle(client, { title: "一つめ" });
    const second = await createArticle(client, { title: "二つめ" });
    const trashed = await createArticle(client, { title: "捨てる" });
    await createArticle(admin, { title: "管理者の記事" });
    await client.del(`/api/articles/${trashed.id}`);
    // ほかの人が編集しても、作成した人のページに残る（更新されたので先頭に来る）
    await admin.put(`/api/articles/${first.id}`, { title: "一つめ", body: "直した", tags: [], baseVersion: 1 });

    const page = await json(await client.get(`/api/users/${user.id}`));
    expect(page.articles.map((a: { title: string }) => a.title)).toEqual(["一つめ", "二つめ"]);
    expect(page.articles[1]).toMatchObject({ id: second.id, title: "二つめ" });
  });

  it("いない人は 404", async () => {
    const admin = await adminClient();
    expect((await admin.get(`/api/users/${crypto.randomUUID()}`)).status).toBe(404);
  });
});

describe("自己紹介", () => {
  it("保存でき、前後の空白は除く。名前だけ送ったときは消えない", async () => {
    const admin = await adminClient();
    const { client, user } = await memberClient(admin);
    const saved = await client.patch("/api/auth/profile", { name: user.name, bio: "  猫が好き\n\n- 料理\n  " });
    expect(saved.status).toBe(200);
    expect((await json(saved)).bio).toBe("猫が好き\n\n- 料理");

    const renamed = await client.patch("/api/auth/profile", { name: "改名" });
    expect((await json(renamed)).bio).toBe("猫が好き\n\n- 料理");
    expect((await json(await client.get(`/api/users/${user.id}`))).user).toMatchObject({ name: "改名", bio: "猫が好き\n\n- 料理" });
  });

  it("空にでき、長すぎるものや文字列でないものは拒否する", async () => {
    const admin = await adminClient();
    const { client, user } = await memberClient(admin);
    await client.patch("/api/auth/profile", { name: user.name, bio: "消す前" });
    expect((await json(await client.patch("/api/auth/profile", { name: user.name, bio: "" }))).bio).toBe("");
    expect((await client.patch("/api/auth/profile", { name: user.name, bio: "あ".repeat(2001) })).status).toBe(400);
    expect((await client.patch("/api/auth/profile", { name: user.name, bio: 1 })).status).toBe(400);
  });

  it("自分のものだけが変わる", async () => {
    const admin = await adminClient();
    const { client, user } = await memberClient(admin);
    const other = await memberClient(admin);
    await client.patch("/api/auth/profile", { name: user.name, bio: "自分の" });
    expect((await json(await client.get(`/api/users/${other.user.id}`))).user.bio).toBe("");
  });

  it("退会・強制退会で消える。ページと記事は残る", async () => {
    const admin = await adminClient();
    const leaver = await memberClient(admin);
    const removed = await memberClient(admin);
    const article = await createArticle(leaver.client, { title: "残る記事" });
    await leaver.client.patch("/api/auth/profile", { name: leaver.user.name, bio: "退会する人" });
    await removed.client.patch("/api/auth/profile", { name: removed.user.name, bio: "外される人" });

    expect((await leaver.client.post("/api/auth/withdraw", { currentPassword: leaver.password })).status).toBe(200);
    expect((await admin.post(`/api/admin/users/${removed.user.id}/remove`)).status).toBe(200);

    const left = await json(await admin.get(`/api/users/${leaver.user.id}`));
    expect(left.user).toMatchObject({ name: "（削除されたユーザー）", bio: "", avatar_id: null });
    expect(left.articles).toMatchObject([{ id: article.id, title: "残る記事" }]);
    expect((await json(await admin.get(`/api/users/${removed.user.id}`))).user.bio).toBe("");
  });
});
