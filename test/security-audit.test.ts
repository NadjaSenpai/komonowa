import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { adminClient, Client, createArticle, json, memberClient } from "./helpers";

describe("ローカルセキュリティ監査：認証・権限・入力", () => {
  it("未認証・メンバーでは管理機能を使えない", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    for (const path of ["/api/admin/users", "/api/admin/invites", "/api/admin/trash", "/api/admin/shares"]) {
      expect((await new Client().get(path)).status, path).toBe(401);
      expect((await client.get(path)).status, path).toBe(403);
      expect((await admin.get(path)).status, path).toBe(200);
    }
  });

  it("プロフィールの余分な role/status/id では権限や他人を変更できない", async () => {
    const admin = await adminClient();
    const { client, user } = await memberClient(admin);
    const owner = (await json(await admin.get("/api/auth/me"))).user;
    expect((await client.patch("/api/auth/profile", { name: "監査用", role: "admin", status: "disabled", id: owner.id })).status).toBe(200);
    const me = (await json(await client.get("/api/auth/me"))).user;
    expect(me.id).toBe(user.id);
    expect(me.role).toBe("member");
    expect((await json(await admin.get("/api/auth/me"))).user.name).toBe(owner.name);
    expect((await client.get("/api/admin/users")).status).toBe(403);
  });

  it("期限切れ・改ざん・ログアウト済みセッションは拒否する", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    const old = client.cookie;
    const forged = new Client();
    forged.cookie = old + "tampered";
    expect((await forged.get("/api/articles")).status).toBe(401);
    await client.post("/api/auth/logout");
    forged.cookie = old;
    expect((await forged.get("/api/articles")).status).toBe(401);
    await env.DB.prepare("UPDATE sessions SET expires_at = ?")
      .bind(Date.now() - 1)
      .run();
    expect((await admin.get("/api/articles")).status).toBe(401);
  });

  it.each(["text/plain", "application/x-www-form-urlencoded"])("他サイトの %s POST で記事を作成できない", async (contentType) => {
    const admin = await adminClient();
    const res = await admin.request("/api/articles", {
      method: "POST",
      headers: { origin: "https://attacker.invalid", "sec-fetch-site": "cross-site", "content-type": contentType },
      body: JSON.stringify({ title: "csrf", body: "attack", tags: [] }),
    });
    expect(res.status).toBe(403);
    expect((await json(await admin.get("/api/articles"))).articles).toHaveLength(0);
  });

  it("SQLインジェクションを検索語・IDとして渡しても他の記事やDB情報を返さない", async () => {
    const admin = await adminClient();
    await createArticle(admin, { title: "監査用の記事" });
    const payload = "' OR 1=1 --";
    expect((await json(await admin.get(`/api/articles?q=${encodeURIComponent(payload)}`))).articles).toHaveLength(0);
    const res = await admin.get(`/api/articles/${encodeURIComponent(payload)}`);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toMatch(/SQLITE|SELECT |stack|password_hash/i);
  });

  it("不正JSON・配列・nullは400で、内部エラーの情報を返さない", async () => {
    const admin = await adminClient();
    for (const body of ["{", "[]", "null"]) {
      const res = await admin.request("/api/articles", { method: "POST", headers: { "content-type": "application/json" }, body });
      expect(res.status).toBe(400);
      expect(await res.text()).not.toMatch(/SQLITE|stack|node_modules|password_hash/i);
    }
  });

  it("共有トークンで別記事の添付や会員用APIを取得できない", async () => {
    const admin = await adminClient();
    const shared = await createArticle(admin);
    const privateArticle = await createArticle(admin);
    const form = new FormData();
    form.append("file", new File(["private audit file"], "audit.txt"));
    const { attachment } = await json(await admin.request(`/api/articles/${privateArticle.id}/attachments`, { method: "POST", body: form }));
    const { share } = await json(await admin.post(`/api/articles/${shared.id}/share`));
    const token = share.url.split("/s/")[1];
    const publicClient = new Client();
    expect((await publicClient.get(`/api/share/${token}`)).status).toBe(200);
    expect((await publicClient.get(`/api/share/${token}/attachments/${attachment.id}`)).status).toBe(404);
    expect((await publicClient.get(attachment.url)).status).toBe(401);
    const response = await json(await publicClient.get(`/api/share/${token}`));
    expect(Object.keys(response.article).sort()).toEqual(["body", "title", "updated_at"]);
    await admin.del(`/api/articles/${shared.id}/share`);
    expect((await publicClient.get(`/api/share/${token}`)).status).toBe(404);
  });
});

describe("再認証の試行制限", () => {
  const payload = (currentPassword: string) => ({ email: "audit-change@example.com", newPassword: "audit-next-password-123", currentPassword });
  it.each(["email", "password", "withdraw"])("%s の失敗は15分間に10回まで", async (route) => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push(
        (
          await client.post(`/api/auth/${route}`, {
            email: "audit-change@example.com",
            newPassword: "audit-next-password-123",
            currentPassword: `wrong-audit-${i}`,
          })
        ).status,
      );
    }
    expect(statuses).toEqual([...Array(10).fill(403), 429, 429]);
  });

  it("ルートやセッションを変えても迂回できず、通常ログインと別利用者には影響しない", async () => {
    const admin = await adminClient();
    const member = await memberClient(admin);
    const routes = ["email", "password", "withdraw"];
    for (let i = 0; i < 10; i++) expect((await member.client.post(`/api/auth/${routes[i % 3]}`, payload("wrong"))).status).toBe(403);
    const session = new Client();
    expect((await session.post("/api/auth/login", { email: member.email, password: member.password })).status).toBe(200);
    for (const route of routes) expect((await session.post(`/api/auth/${route}`, payload(member.password))).status).toBe(429);
    const other = await memberClient(admin);
    expect((await other.client.post("/api/auth/email", payload("wrong"))).status).toBe(403);
  });

  it("同時30回でも照合は10回までで、超過分を記録に残さない", async () => {
    const admin = await adminClient();
    const member = await memberClient(admin);
    const clients = Array.from({ length: 30 }, () => {
      const c = new Client();
      c.cookie = member.client.cookie;
      return c;
    });
    const results = await Promise.all(clients.map((c, i) => c.post(`/api/auth/${["email", "password", "withdraw"][i % 3]}`, payload("wrong"))));
    expect(results.filter((r) => r.status === 403)).toHaveLength(10);
    expect(results.filter((r) => r.status === 429)).toHaveLength(20);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM reauth_failures WHERE user_id = ?").bind(member.user.id).first<number>("n")).toBe(10);
  });

  it("15分経過したら正しいパスワードで再認証できる", async () => {
    const admin = await adminClient();
    const member = await memberClient(admin);
    for (let i = 0; i < 10; i++) await member.client.post("/api/auth/password", payload("wrong"));
    expect((await member.client.post("/api/auth/password", payload(member.password))).status).toBe(429);
    await env.DB.prepare("UPDATE reauth_failures SET created_at = ? WHERE user_id = ?")
      .bind(Date.now() - 15 * 60 * 1000 - 1, member.user.id)
      .run();
    expect((await member.client.post("/api/auth/password", payload(member.password))).status).toBe(200);
  });

  it("成功すると失敗数を解除する", async () => {
    const admin = await adminClient();
    const member = await memberClient(admin);
    for (let i = 0; i < 9; i++) await member.client.post("/api/auth/email", payload("wrong"));
    expect((await member.client.post("/api/auth/email", payload(member.password))).status).toBe(201);
    for (let i = 0; i < 10; i++) expect((await member.client.post("/api/auth/email", payload("wrong"))).status).toBe(403);
    expect((await member.client.post("/api/auth/email", payload("wrong"))).status).toBe(429);
  });
});
