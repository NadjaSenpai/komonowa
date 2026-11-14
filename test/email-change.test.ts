import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { sha256 } from "../worker/crypto";
import { ADMIN, Client, adminClient, json, lastMail, mailbox, memberClient, tokenFrom } from "./helpers";

const GONE = "リンクが無効か期限切れです。もう一度アカウント画面から申し込んでください";

/** 申し込んで、確認メールのトークンを返す */
async function request(client: Client, email: string, currentPassword: string) {
  const res = await client.post("/api/auth/email", { email, currentPassword });
  if (res.status !== 201) throw new Error(`request failed: ${res.status} ${await res.text()}`);
  return tokenFrom(lastMail());
}

function confirm(token: string) {
  return new Client().post("/api/auth/email/confirm", { token });
}

describe("メールアドレス変更の申し込み", () => {
  it("未ログインでは申し込めない", async () => {
    expect((await new Client().post("/api/auth/email", { email: "a@example.com", currentPassword: "x" })).status).toBe(401);
  });

  it("メンバーが申し込むと、新しいアドレスに確認メールが届く（応答にリンクは含めない）", async () => {
    const admin = await adminClient();
    const member = await memberClient(admin);
    const res = await member.client.post("/api/auth/email", { email: "Next@Example.com", currentPassword: member.password });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body).not.toHaveProperty("token");
    expect(typeof body.expiresAt).toBe("number");
    const mail = lastMail();
    expect(mail.to).toBe("next@example.com");
    expect(mail.subject).toBe("「komonowa」メールアドレスの確認");
    expect(mail.text).toContain("https://wiki.example.com/email#");
    // 確定するまでは変わらない
    expect((await json(await member.client.get("/api/auth/me"))).user.email).toBe(member.email);
  });

  it("管理者も自分のアドレスを申し込める", async () => {
    const admin = await adminClient();
    expect((await admin.post("/api/auth/email", { email: "boss@example.com", currentPassword: ADMIN.password })).status).toBe(201);
  });

  it("パスワード違い・同じアドレス・使用中のアドレスは断る", async () => {
    const admin = await adminClient();
    const member = await memberClient(admin);
    const wrong = await member.client.post("/api/auth/email", { email: "n@example.com", currentPassword: "wrong-password-1" });
    expect(wrong.status).toBe(403);
    expect((await json(wrong)).error).toBe("現在のパスワードが正しくありません");

    const same = await member.client.post("/api/auth/email", { email: member.email.toUpperCase(), currentPassword: member.password });
    expect(same.status).toBe(400);
    expect((await json(same)).error).toBe("今のメールアドレスと同じです");

    const taken = await member.client.post("/api/auth/email", { email: ADMIN.email.toUpperCase(), currentPassword: member.password });
    expect(taken.status).toBe(409);
    expect((await json(taken)).error).toBe("このメールアドレスはすでに使われています");

    const bad = await member.client.post("/api/auth/email", { email: "not-an-email", currentPassword: member.password });
    expect(bad.status).toBe(400);
    expect(mailbox.sent.filter((m) => m.subject.includes("確認"))).toHaveLength(0);
  });

  it("メールを送れなければ記録せず、前の申し込みのリンクがそのまま使える", async () => {
    const admin = await adminClient();
    const member = await memberClient(admin);
    const first = await request(member.client, "first@example.com", member.password);
    mailbox.failNext = true;
    const res = await member.client.post("/api/auth/email", { email: "second@example.com", currentPassword: member.password });
    expect(res.status).toBe(502);
    expect((await confirm(first)).status).toBe(200);
  });
});

describe("メールアドレス変更の確定", () => {
  it("リンクで切り替わり、新しいアドレスでだけログインでき、古いアドレスにお知らせが届く", async () => {
    const admin = await adminClient();
    const member = await memberClient(admin);
    const token = await request(member.client, "Next@Example.com", member.password);

    const res = await confirm(token);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ email: "next@example.com" });

    const notice = lastMail();
    expect(notice.to).toBe(member.email);
    expect(notice.subject).toBe("「komonowa」のメールアドレスが変更されました");
    expect(notice.text).toContain("next@example.com");

    // ログイン中の画面はそのまま使え、アドレスは新しくなる
    expect((await json(await member.client.get("/api/auth/me"))).user.email).toBe("next@example.com");
    expect((await new Client().post("/api/auth/login", { email: member.email, password: member.password })).status).toBe(401);
    expect((await new Client().post("/api/auth/login", { email: "next@example.com", password: member.password })).status).toBe(200);

    // 一回限り
    const again = await confirm(token);
    expect(again.status).toBe(410);
    expect((await json(again)).error).toBe(GONE);
  });

  it("期限切れ・申し込み直した古いリンク・でたらめなリンクは使えない", async () => {
    const admin = await adminClient();
    const member = await memberClient(admin);
    const old = await request(member.client, "old-link@example.com", member.password);
    const latest = await request(member.client, "latest@example.com", member.password);
    expect((await confirm(old)).status).toBe(410);

    await env.DB.prepare("UPDATE email_changes SET expires_at = ? WHERE token_hash = ?")
      .bind(Date.now() - 1, await sha256(latest))
      .run();
    expect((await confirm(latest)).status).toBe(410);
    expect((await confirm("x".repeat(43))).status).toBe(410);
    expect((await confirm("short")).status).toBe(400);
  });

  it("確定までにほかの人がそのアドレスを使い始めていたら断る", async () => {
    const admin = await adminClient();
    const member = await memberClient(admin);
    const token = await request(member.client, "race@example.com", member.password);
    await admin.post("/api/admin/invites", { email: "race@example.com" });
    expect((await new Client().post("/api/auth/invite/accept", { token: tokenFrom(lastMail()), name: "先に登録", password: "race-member-pass" })).status).toBe(
      201,
    );

    const res = await confirm(token);
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("このメールアドレスはすでに使われています");
  });

  it("確定すると、まだ使っていないパスワード再設定リンクは無効になる", async () => {
    const admin = await adminClient();
    const member = await memberClient(admin);
    await admin.post(`/api/admin/users/${member.user.id}/reset-link`);
    const reset = tokenFrom(lastMail());
    const token = await request(member.client, "moved@example.com", member.password);
    expect((await confirm(token)).status).toBe(200);
    expect((await new Client().post("/api/auth/reset/accept", { token: reset, password: "brand-new-pass-1" })).status).toBe(410);
  });

  it("無効化された人のリンクは使えない", async () => {
    const admin = await adminClient();
    const member = await memberClient(admin);
    const token = await request(member.client, "disabled@example.com", member.password);
    await admin.patch(`/api/admin/users/${member.user.id}`, { status: "disabled" });
    expect((await confirm(token)).status).toBe(410);
  });

  it("古いアドレスへのお知らせを送れなくても、変更は済む", async () => {
    const admin = await adminClient();
    const member = await memberClient(admin);
    const token = await request(member.client, "quiet@example.com", member.password);
    mailbox.failNext = true;
    expect((await confirm(token)).status).toBe(200);
    expect((await new Client().post("/api/auth/login", { email: "quiet@example.com", password: member.password })).status).toBe(200);
  });
});
