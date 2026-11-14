import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ADMIN, Client, adminClient, createArticle, json, lastMail, memberClient, tokenFrom } from "./helpers";

const DELETED = "（削除されたユーザー）";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

async function withAvatar(c: Client) {
  const form = new FormData();
  form.append("file", new File([PNG], "a.png"));
  return (await json(await c.request("/api/auth/avatar", { method: "PUT", body: form }))).user.avatar_id as string;
}

/** 退会した人の痕跡が残っていないか（名前・アドレス） */
async function traces(userId: string, email: string, name: string) {
  const row = await env.DB.prepare("SELECT name, email, avatar_id, status, deleted_at FROM users WHERE id = ?").bind(userId).first<Record<string, unknown>>();
  const dump = JSON.stringify(
    await env.DB.batch([
      env.DB.prepare("SELECT * FROM auth_tokens"),
      env.DB.prepare("SELECT * FROM login_failures"),
      env.DB.prepare("SELECT * FROM email_changes"),
      env.DB.prepare("SELECT * FROM users"),
    ]),
  );
  return { row, leaksEmail: dump.toLowerCase().includes(`"${email.toLowerCase()}"`), leaksName: dump.includes(`"${name}"`) };
}

describe("退会（本人）", () => {
  it("未ログインでは退会できない", async () => {
    expect((await new Client().post("/api/auth/withdraw", { currentPassword: "x" })).status).toBe(401);
  });

  it("パスワード違い・所有者・最後の管理者は断る", async () => {
    const admin = await adminClient();
    const member = await memberClient(admin);
    const wrong = await member.client.post("/api/auth/withdraw", { currentPassword: "wrong-password-0" });
    expect(wrong.status).toBe(403);
    expect((await json(wrong)).error).toBe("現在のパスワードが正しくありません");

    const owner = await admin.post("/api/auth/withdraw", { currentPassword: ADMIN.password });
    expect(owner.status).toBe(409);
    expect((await json(owner)).error).toBe("所有者は退会できません。先にほかの管理者に所有者を譲ってください（手順は運用手順書の「所有者」）");

    // 所有者が無効（ありえないが）でも、有効な管理者が 0 人になる退会は断る
    const second = await memberClient(admin, "admin");
    await env.DB.prepare("UPDATE users SET status = 'disabled', is_owner = 0 WHERE email = ?").bind(ADMIN.email).run();
    const last = await second.client.post("/api/auth/withdraw", { currentPassword: second.password });
    expect(last.status).toBe(409);
    expect((await json(last)).error).toBe("有効な管理者が1人以上必要です");
  });

  it("退会すると個人情報が消え、記事には（削除されたユーザー）と出て、ログインできない", async () => {
    const admin = await adminClient();
    const member = await memberClient(admin);
    const avatarId = await withAvatar(member.client);
    const article = await createArticle(member.client, { title: "残る記事" });
    await member.client.post(`/api/articles/${article.id}/share`);
    // ログインの失敗の記録にもアドレスが残る
    await new Client().post("/api/auth/login", { email: member.email, password: "wrong-password-0" });

    const res = await member.client.post("/api/auth/withdraw", { currentPassword: member.password });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");

    const { row, leaksEmail, leaksName } = await traces(member.user.id, member.email, member.user.name);
    expect(row).toMatchObject({ name: DELETED, avatar_id: null, status: "disabled" });
    expect(row!.deleted_at).toEqual(expect.any(Number));
    expect(leaksEmail).toBe(false);
    expect(leaksName).toBe(false);
    // ログインを試すと失敗の記録が付くので、痕跡を確かめてから試す
    expect((await member.client.get("/api/auth/me")).status).toBe(401);
    expect((await new Client().post("/api/auth/login", { email: member.email, password: member.password })).status).toBe(401);
    expect(await env.FILES.head(`avatars/${member.user.id}/${avatarId}`)).toBeNull();

    const view = await json(await admin.get(`/api/articles/${article.id}`));
    expect(view.article.created_by_name).toBe(DELETED);
    expect(view.share).toBeNull();
    const users = (await json(await admin.get("/api/admin/users"))).users as { id: string }[];
    expect(users.find((u) => u.id === member.user.id)).toBeUndefined();

    // 自主退会のアドレスは締め出さない
    expect((await admin.post("/api/admin/invites", { email: member.email })).status).toBe(201);
  });
});

describe("強制退会（管理者）", () => {
  it("未ログインとメンバーは使えない", async () => {
    const admin = await adminClient();
    const a = await memberClient(admin);
    const b = await memberClient(admin);
    expect((await new Client().post(`/api/admin/users/${b.user.id}/remove`)).status).toBe(401);
    expect((await a.client.post(`/api/admin/users/${b.user.id}/remove`)).status).toBe(403);
  });

  it("自分・所有者・退会済みは断る", async () => {
    const admin = await adminClient();
    const second = await memberClient(admin, "admin");
    const me = await json(await admin.get("/api/auth/me"));
    const self = await admin.post(`/api/admin/users/${me.user.id}/remove`);
    expect(self.status).toBe(400);
    expect((await json(self)).error).toBe("自分は強制退会できません。退会はアカウント画面から行ってください");
    const owner = await second.client.post(`/api/admin/users/${me.user.id}/remove`);
    expect(owner.status).toBe(403);
    expect((await json(owner)).error).toBe("所有者は強制退会できません");

    const member = await memberClient(admin);
    expect((await admin.post(`/api/admin/users/${member.user.id}/remove`)).status).toBe(200);
    expect((await admin.post(`/api/admin/users/${member.user.id}/remove`)).status).toBe(404);
    expect((await admin.patch(`/api/admin/users/${member.user.id}`, { status: "active" })).status).toBe(404);
    expect((await admin.post(`/api/admin/users/${member.user.id}/reset-link`)).status).toBe(404);
  });

  it("強制退会すると個人情報が消え、同じアドレスは招待にもメール変更にも使えない", async () => {
    const admin = await adminClient();
    const member = await memberClient(admin, "admin");
    // この人が送った、まだ使われていない招待
    await member.client.post("/api/admin/invites", { email: "pending@example.com" });
    const pending = tokenFrom(lastMail());
    await admin.patch(`/api/admin/users/${member.user.id}`, { status: "disabled" });

    expect((await admin.post(`/api/admin/users/${member.user.id}/remove`)).status).toBe(200);
    const { row, leaksEmail, leaksName } = await traces(member.user.id, member.email, member.user.name);
    expect(row).toMatchObject({ name: DELETED, status: "disabled" });
    expect(leaksEmail).toBe(false);
    expect(leaksName).toBe(false);
    expect((await new Client().post("/api/auth/invite/check", { token: pending })).status).toBe(410);

    for (const addr of [member.email, `  ${member.email.toUpperCase()} `]) {
      const res = await admin.post("/api/admin/invites", { email: addr });
      expect(res.status).toBe(409);
      expect((await json(res)).error).toBe("このメールアドレスは使えません");
    }
    const other = await memberClient(admin);
    const change = await other.client.post("/api/auth/email", { email: member.email, currentPassword: other.password });
    expect(change.status).toBe(409);
    expect((await json(change)).error).toBe("このメールアドレスは使えません");
    const stored = await env.DB.prepare("SELECT email_hash FROM blocked_emails").all<{ email_hash: string }>();
    expect(JSON.stringify(stored.results)).not.toContain("@");
  });
});
