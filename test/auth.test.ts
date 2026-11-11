import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { sha256 } from "../worker/crypto";
import { ADMIN, Client, SETUP_TOKEN, adminClient, json, memberClient } from "./helpers";

describe("初期管理者の作成", () => {
  it("トークンが違えば拒否し、作成後は二度と使えない", async () => {
    const c = new Client();
    expect(await json(await c.get("/api/auth/setup"))).toEqual({ needsSetup: true });
    expect((await c.post("/api/auth/setup", { token: "wrong", ...ADMIN })).status).toBe(403);
    expect((await c.post("/api/auth/setup", { token: SETUP_TOKEN, ...ADMIN, password: "short" })).status).toBe(400);

    const ok = await c.post("/api/auth/setup", { token: SETUP_TOKEN, ...ADMIN });
    expect(ok.status).toBe(201);
    expect(ok.headers.get("set-cookie")).toMatch(/__Host-wiki_session=.+; .*HttpOnly/i);
    expect((await json(await c.get("/api/auth/me"))).user.role).toBe("admin");

    const again = await new Client().post("/api/auth/setup", { token: SETUP_TOKEN, ...ADMIN, email: "other@example.com" });
    expect(again.status).toBe(409);
    expect(await json(await c.get("/api/auth/setup"))).toEqual({ needsSetup: false });
  });
});

describe("ログインとセッション", () => {
  it("未ログインは API を使えない", async () => {
    const c = new Client();
    expect((await c.get("/api/auth/me")).status).toBe(401);
    expect((await c.get("/api/articles")).status).toBe(401);
    expect((await c.get("/api/admin/users")).status).toBe(401);
    c.cookie = "__Host-wiki_session=forged-token-value";
    expect((await c.get("/api/articles")).status).toBe(401);
  });

  it("誤ったパスワードを拒否し、ログアウトでセッションを破棄する", async () => {
    await adminClient();
    const c = new Client();
    expect((await c.post("/api/auth/login", { email: ADMIN.email, password: "wrong-password-xx" })).status).toBe(401);
    expect((await c.post("/api/auth/login", { email: "nobody@example.com", password: "wrong-password-xx" })).status).toBe(401);
    expect((await c.post("/api/auth/login", { email: ADMIN.email.toUpperCase(), password: ADMIN.password })).status).toBe(200);
    const stolen = c.cookie;
    expect((await c.post("/api/auth/logout")).status).toBe(200);
    const replay = new Client();
    replay.cookie = stolen;
    expect((await replay.get("/api/auth/me")).status).toBe(401);
  });

  it("失敗が続くとロックする", async () => {
    await adminClient();
    const c = new Client();
    for (let i = 0; i < 10; i++) {
      await c.post("/api/auth/login", { email: ADMIN.email, password: `wrong-password-${i}` });
    }
    expect((await c.post("/api/auth/login", { email: ADMIN.email, password: ADMIN.password })).status).toBe(429);
  });

  it("期限切れのセッションは使えない", async () => {
    const admin = await adminClient();
    const token = admin.cookie.split("=")[1] as string;
    await env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE id_hash = ?").bind(Date.now() - 1, await sha256(token)).run();
    expect((await admin.get("/api/auth/me")).status).toBe(401);
  });

  it("他サイトからのフォーム送信を拒否する", async () => {
    const admin = await adminClient();
    const res = await admin.request("/api/auth/logout", {
      method: "POST",
      headers: { origin: "https://evil.example.net", "content-type": "application/x-www-form-urlencoded" },
      body: "",
    });
    expect(res.status).toBe(403);
  });
});

describe("招待", () => {
  it("一回限りで、期限切れ・取り消し済みは使えない", async () => {
    const admin = await adminClient();
    const res = await admin.post("/api/admin/invites", { email: "New@Example.com", role: "member" });
    expect(res.status).toBe(201);
    const { token } = await json(res);

    const guest = new Client();
    expect(await json(await guest.post("/api/auth/invite/check", { token }))).toEqual({ email: "new@example.com" });
    const accepted = await guest.post("/api/auth/invite/accept", { token, name: "新人", password: "new-member-pass-1" });
    expect(accepted.status).toBe(201);
    expect((await json(accepted)).user.role).toBe("member");
    expect((await new Client().post("/api/auth/invite/accept", { token, name: "二回目", password: "new-member-pass-1" })).status).toBe(410);

    // 登録済みアドレスへは招待できない
    expect((await admin.post("/api/admin/invites", { email: "new@example.com" })).status).toBe(409);

    // 期限切れ
    const expired = await json(await admin.post("/api/admin/invites", { email: "late@example.com" }));
    await env.DB.prepare("UPDATE auth_tokens SET expires_at = ? WHERE token_hash = ?").bind(Date.now() - 1, await sha256(expired.token)).run();
    expect((await new Client().post("/api/auth/invite/accept", { token: expired.token, name: "遅刻", password: "late-member-pass" })).status).toBe(410);

    // 取り消し
    const revoked = await json(await admin.post("/api/admin/invites", { email: "revoked@example.com" }));
    expect((await admin.del(`/api/admin/invites/${await sha256(revoked.token)}`)).status).toBe(200);
    expect((await new Client().post("/api/auth/invite/accept", { token: revoked.token, name: "取消", password: "revoked-pass-123" })).status).toBe(410);

    // DB にはトークンの平文を保存しない
    const raw = await env.DB.prepare("SELECT COUNT(*) AS n FROM auth_tokens WHERE token_hash = ?").bind(token).first<number>("n");
    expect(raw).toBe(0);
  });

  it("メンバーは招待できない", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    expect((await client.post("/api/admin/invites", { email: "x@example.com" })).status).toBe(403);
    expect((await client.get("/api/admin/users")).status).toBe(403);
  });
});

describe("パスワード再設定と無効化", () => {
  it("再設定リンクでパスワードを変え、既存セッションを失効させる", async () => {
    const admin = await adminClient();
    const member = await memberClient(admin);
    const { token } = await json(await admin.post(`/api/admin/users/${member.user.id}/reset-link`));
    // 新しいリンクを発行すると古いリンクは無効
    const { token: token2 } = await json(await admin.post(`/api/admin/users/${member.user.id}/reset-link`));
    expect((await new Client().post("/api/auth/reset/accept", { token, password: "brand-new-pass-1" })).status).toBe(410);

    expect((await new Client().post("/api/auth/reset/accept", { token: token2, password: "brand-new-pass-1" })).status).toBe(200);
    expect((await member.client.get("/api/auth/me")).status).toBe(401);
    expect((await new Client().post("/api/auth/reset/accept", { token: token2, password: "brand-new-pass-2" })).status).toBe(410);

    const c = new Client();
    expect((await c.post("/api/auth/login", { email: member.email, password: member.password })).status).toBe(401);
    expect((await c.post("/api/auth/login", { email: member.email, password: "brand-new-pass-1" })).status).toBe(200);
  });

  it("無効化した利用者はログインもセッション利用もできず、再有効化で戻る", async () => {
    const admin = await adminClient();
    const member = await memberClient(admin);
    const reset = await json(await admin.post(`/api/admin/users/${member.user.id}/reset-link`));
    expect((await admin.patch(`/api/admin/users/${member.user.id}`, { status: "disabled" })).status).toBe(200);
    expect((await member.client.get("/api/articles")).status).toBe(401);
    expect((await new Client().post("/api/auth/login", { email: member.email, password: member.password })).status).toBe(401);
    expect((await new Client().post("/api/auth/reset/accept", { token: reset.token, password: "after-disable-1" })).status).toBe(410);

    expect((await admin.patch(`/api/admin/users/${member.user.id}`, { status: "active" })).status).toBe(200);
    expect((await new Client().post("/api/auth/login", { email: member.email, password: member.password })).status).toBe(200);
  });

  it("最後の管理者は降格・無効化できない", async () => {
    const admin = await adminClient();
    const me = (await json(await admin.get("/api/auth/me"))).user;
    expect((await admin.patch(`/api/admin/users/${me.id}`, { status: "disabled" })).status).toBe(400);
    const second = await memberClient(admin, "admin");
    expect((await second.client.patch(`/api/admin/users/${me.id}`, { role: "member" })).status).toBe(200);
    expect((await second.client.patch(`/api/admin/users/${second.user.id}`, { role: "member" })).status).toBe(400);
    // 降格された元管理者は管理 API を使えない
    expect((await admin.get("/api/admin/users")).status).toBe(403);
  });

  it("自分のパスワードを変更できる", async () => {
    const admin = await adminClient();
    const member = await memberClient(admin);
    expect((await member.client.post("/api/auth/password", { currentPassword: "wrong", newPassword: "changed-pass-123" })).status).toBe(403);
    expect((await member.client.post("/api/auth/password", { currentPassword: member.password, newPassword: "changed-pass-123" })).status).toBe(200);
    expect((await member.client.get("/api/auth/me")).status).toBe(200);
  });
});
