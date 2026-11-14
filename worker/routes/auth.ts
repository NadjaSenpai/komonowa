import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { getDummyHash, hashPassword, safeStringEqual, sha256, verifyPassword } from "../crypto";
import { verifyCurrentPassword } from "../reauth";
import type { AppEnv } from "../env";
import { email, fail, password, readJson, str } from "../http";
import { isBlocked, removeAccount } from "../accounts";
import { clearAttempts, purgeAttempts, takeAttempt } from "../attempts";
import { mailer } from "../mail";
import { emailChangedNotice } from "../mailTemplates";
import { SESSION_COOKIE, clearSessionCookie, createSession, requireAuth, revokeUserSessions } from "../session";
import { EMAIL_BLOCKED, EMAIL_TAKEN } from "./profile";

const LOCK_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const LOGIN_ATTEMPTS = { table: "login_failures", column: "email" } as const;

export const auth = new Hono<AppEnv>();

async function hasUsers(db: D1Database): Promise<boolean> {
  return (await db.prepare("SELECT 1 FROM users LIMIT 1").first()) !== null;
}

auth.get("/setup", async (c) => c.json({ needsSetup: !(await hasUsers(c.env.DB)) }));

/** 初期管理者（所有者）の作成。SETUP_TOKEN が必要で、利用者が 1 人でもいれば拒否する */
auth.post("/setup", async (c) => {
  const expected = c.env.SETUP_TOKEN;
  if (!expected || expected.length < 32) fail(503, "SETUP_TOKEN（32文字以上）が設定されていません");
  const body = await readJson(c);
  const token = typeof body.token === "string" ? body.token : "";
  if (!(await safeStringEqual(token, expected))) fail(403, "セットアップトークンが正しくありません");
  const addr = email(body);
  const name = str(body, "name", { max: 50, label: "表示名" });
  const hash = await hashPassword(password(body));
  const now = Date.now();
  const id = crypto.randomUUID();
  const result = await c.env.DB.prepare(
    `INSERT INTO users (id, email, name, password_hash, role, status, is_owner, created_at, updated_at)
     SELECT ?, ?, ?, ?, 'admin', 'active', 1, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)`,
  )
    .bind(id, addr, name, hash, now, now)
    .run();
  if (result.meta.changes === 0) fail(409, "初期設定はすでに完了しています");
  await createSession(c, id);
  return c.json({ user: { id, email: addr, name, role: "admin", avatar_id: null } }, 201);
});

auth.post("/login", async (c) => {
  const body = await readJson(c);
  const addr = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const pass = typeof body.password === "string" ? body.password : "";
  if (!addr || !pass) fail(400, "メールアドレスとパスワードを入力してください");
  // 先に試しを記録する（失敗として残り、成功したら消す）。同時に送られても MAX_FAILURES 回までしか確かめない
  const attempt = await takeAttempt(c.env.DB, LOGIN_ATTEMPTS, addr, LOCK_WINDOW_MS, MAX_FAILURES);
  if (attempt === null) fail(429, "ログイン失敗が続いたため一時的にロックしています。15分ほど待ってください");

  const user = await c.env.DB.prepare("SELECT id, email, name, role, status, password_hash, avatar_id FROM users WHERE email = ?")
    .bind(addr)
    .first<{ id: string; email: string; name: string; role: string; status: string; password_hash: string; avatar_id: string | null }>();
  const ok = await verifyPassword(pass, user?.password_hash ?? (await getDummyHash()));
  if (!user || !ok || user.status !== "active") {
    await purgeAttempts(c.env.DB, LOGIN_ATTEMPTS, LOCK_WINDOW_MS).run();
    fail(401, "メールアドレスまたはパスワードが正しくありません");
  }
  await clearAttempts(c.env.DB, LOGIN_ATTEMPTS, addr);
  await createSession(c, user.id);
  return c.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, avatar_id: user.avatar_id } });
});

auth.post("/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?")
      .bind(await sha256(token))
      .run();
  }
  clearSessionCookie(c);
  return c.json({ ok: true });
});

auth.get("/me", requireAuth, (c) => c.json({ user: c.var.user }));

interface TokenRow {
  token_hash: string;
  email: string | null;
  role: "admin" | "member" | null;
  user_id: string | null;
}

async function findToken(db: D1Database, kind: "invite" | "reset", token: unknown): Promise<TokenRow> {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) fail(400, "リンクが正しくありません");
  const row = await db
    .prepare(
      `SELECT token_hash, email, role, user_id FROM auth_tokens
        WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
    )
    .bind(await sha256(token), kind, Date.now())
    .first<TokenRow>();
  if (!row) fail(410, "リンクが無効か期限切れです。管理者に再発行を依頼してください");
  return row;
}

/** トークンを一度だけ消費する。同時に使われた場合は片方だけ成功する */
async function consumeToken(db: D1Database, tokenHash: string): Promise<void> {
  const res = await db
    .prepare("UPDATE auth_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?")
    .bind(Date.now(), tokenHash, Date.now())
    .run();
  if (res.meta.changes === 0) fail(410, "リンクが無効か期限切れです。管理者に再発行を依頼してください");
}

auth.post("/invite/check", async (c) => {
  const body = await readJson(c);
  const row = await findToken(c.env.DB, "invite", body.token);
  return c.json({ email: row.email });
});

auth.post("/invite/accept", async (c) => {
  const body = await readJson(c);
  const row = await findToken(c.env.DB, "invite", body.token);
  const name = str(body, "name", { max: 50, label: "表示名" });
  const hash = await hashPassword(password(body));
  if (await c.env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(row.email).first()) {
    fail(409, "このメールアドレスはすでに登録されています");
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  // 利用者の作成とトークンの消費を 1 つのトランザクションで行う（作成に失敗したのにトークンだけ使えなくなる、を防ぐ）。
  // トークンがまだ有効なときだけ作るので、同時に使われた場合は片方だけ成功する
  let created: D1Result[];
  try {
    created = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO users (id, email, name, password_hash, role, status, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, 'active', ?, ?
          WHERE EXISTS (SELECT 1 FROM auth_tokens WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?)`,
      ).bind(id, row.email, name, hash, row.role ?? "member", now, now, row.token_hash, now),
      c.env.DB.prepare("UPDATE auth_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?").bind(
        now,
        row.token_hash,
        now,
      ),
    ]);
  } catch (err) {
    // 確かめた直後にほかの人が同じアドレスで登録した
    if (err instanceof Error && err.message.includes("UNIQUE")) fail(409, "このメールアドレスはすでに登録されています");
    throw err;
  }
  if (created[0]!.meta.changes === 0) fail(410, "リンクが無効か期限切れです。管理者に再発行を依頼してください");
  await createSession(c, id);
  return c.json({ user: { id, email: row.email, name, role: row.role ?? "member", avatar_id: null } }, 201);
});

auth.post("/reset/check", async (c) => {
  const body = await readJson(c);
  const row = await findToken(c.env.DB, "reset", body.token);
  const user = await c.env.DB.prepare("SELECT email FROM users WHERE id = ? AND status = 'active'").bind(row.user_id).first<{ email: string }>();
  if (!user) fail(410, "リンクが無効か期限切れです。管理者に再発行を依頼してください");
  return c.json({ email: user.email });
});

auth.post("/reset/accept", async (c) => {
  const body = await readJson(c);
  const row = await findToken(c.env.DB, "reset", body.token);
  const hash = await hashPassword(password(body));
  const user = await c.env.DB.prepare("SELECT id FROM users WHERE id = ? AND status = 'active'").bind(row.user_id).first<{ id: string }>();
  if (!user) fail(410, "リンクが無効か期限切れです。管理者に再発行を依頼してください");
  await consumeToken(c.env.DB, row.token_hash);
  await c.env.DB.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").bind(hash, Date.now(), user.id).run();
  await revokeUserSessions(c.env.DB, user.id);
  return c.json({ ok: true });
});

const EMAIL_LINK_GONE = "リンクが無効か期限切れです。もう一度アカウント画面から申し込んでください";

/**
 * メールアドレスの変更を確定する（申し込みは profile.ts）。新しいアドレスに届いたリンクで来るので、ログインは不要。
 * まだ使っていない再設定リンク（古いアドレスに届いたもの）は無効にし、古いアドレスにお知らせを送る
 */
auth.post("/email/confirm", async (c) => {
  const body = await readJson(c);
  const token = body.token;
  if (typeof token !== "string" || token.length < 20 || token.length > 100) fail(400, "リンクが正しくありません");
  const tokenHash = await sha256(token);
  const now = Date.now();
  const row = await c.env.DB.prepare(
    `SELECT e.user_id, e.new_email, u.email AS old_email FROM email_changes e JOIN users u ON u.id = e.user_id
      WHERE e.token_hash = ? AND e.used_at IS NULL AND e.revoked_at IS NULL AND e.expires_at > ? AND u.status = 'active'`,
  )
    .bind(tokenHash, now)
    .first<{ user_id: string; new_email: string; old_email: string }>();
  if (!row) fail(410, EMAIL_LINK_GONE);
  if (await isBlocked(c.env.DB, row.new_email)) fail(409, EMAIL_BLOCKED);
  if (await c.env.DB.prepare("SELECT 1 FROM users WHERE email = ? AND id <> ?").bind(row.new_email, row.user_id).first()) {
    fail(409, EMAIL_TAKEN);
  }
  // 同時に使われた場合は片方だけ成功する
  const used = await c.env.DB.prepare("UPDATE email_changes SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL")
    .bind(now, tokenHash)
    .run();
  if (used.meta.changes === 0) fail(410, EMAIL_LINK_GONE);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE users SET email = ?, updated_at = ? WHERE id = ?").bind(row.new_email, now, row.user_id),
      c.env.DB.prepare("UPDATE auth_tokens SET revoked_at = ? WHERE kind = 'reset' AND user_id = ? AND used_at IS NULL AND revoked_at IS NULL").bind(
        now,
        row.user_id,
      ),
      c.env.DB.prepare("UPDATE email_changes SET revoked_at = ? WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL").bind(now, row.user_id),
    ]);
  } catch (err) {
    // 確かめた直後にほかの人が同じアドレスで登録した
    if (err instanceof Error && err.message.includes("UNIQUE")) fail(409, EMAIL_TAKEN);
    throw err;
  }
  // お知らせは届かなくても変更は取り消さない
  try {
    await mailer.send(c.env, emailChangedNotice({ to: row.old_email, newEmail: row.new_email }));
  } catch (err) {
    console.error("email change notice failed", (err as { code?: string }).code ?? "", err);
  }
  return c.json({ email: row.new_email });
});

/**
 * 退会。名前・メールアドレス・アイコン・パスワードを消す（記事と履歴は「（削除されたユーザー）」として残る）。
 * アドレスは締め出さないので、あとでまた招待できる
 */
auth.post("/withdraw", requireAuth, async (c) => {
  const body = await readJson(c);
  const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const row = await c.env.DB.prepare("SELECT password_hash, is_owner FROM users WHERE id = ?")
    .bind(c.var.user.id)
    .first<{ password_hash: string; is_owner: number }>();
  await verifyCurrentPassword(c.env.DB, c.var.user.id, current, row?.password_hash);
  if (row?.is_owner) fail(409, "所有者は退会できません。先にほかの管理者に所有者を譲ってください（手順は運用手順書の「所有者」）");
  await removeAccount(c.env, c.var.user.id, { block: false });
  clearSessionCookie(c);
  return c.json({ ok: true });
});

/** ログイン中の利用者が自分のパスワードを変える */
auth.post("/password", requireAuth, async (c) => {
  const body = await readJson(c);
  const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const next = password(body, "newPassword");
  const row = await c.env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(c.var.user.id).first<{ password_hash: string }>();
  await verifyCurrentPassword(c.env.DB, c.var.user.id, current, row?.password_hash);
  await c.env.DB.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
    .bind(await hashPassword(next), Date.now(), c.var.user.id)
    .run();
  await revokeUserSessions(c.env.DB, c.var.user.id);
  await createSession(c, c.var.user.id);
  return c.json({ ok: true });
});
