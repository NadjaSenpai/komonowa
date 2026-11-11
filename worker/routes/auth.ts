import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { getDummyHash, hashPassword, safeStringEqual, sha256, verifyPassword } from "../crypto";
import type { AppEnv } from "../env";
import { email, fail, password, readJson, str } from "../http";
import { SESSION_COOKIE, clearSessionCookie, createSession, requireAuth, revokeUserSessions } from "../session";

const LOCK_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;

export const auth = new Hono<AppEnv>();

async function hasUsers(db: D1Database): Promise<boolean> {
  return (await db.prepare("SELECT 1 FROM users LIMIT 1").first()) !== null;
}

auth.get("/setup", async (c) => c.json({ needsSetup: !(await hasUsers(c.env.DB)) }));

/** 初期管理者の作成。SETUP_TOKEN が必要で、利用者が 1 人でもいれば拒否する */
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
    `INSERT INTO users (id, email, name, password_hash, role, status, created_at, updated_at)
     SELECT ?, ?, ?, ?, 'admin', 'active', ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)`,
  )
    .bind(id, addr, name, hash, now, now)
    .run();
  if (result.meta.changes === 0) fail(409, "初期設定はすでに完了しています");
  await createSession(c, id);
  return c.json({ user: { id, email: addr, name, role: "admin" } }, 201);
});

auth.post("/login", async (c) => {
  const body = await readJson(c);
  const addr = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const pass = typeof body.password === "string" ? body.password : "";
  if (!addr || !pass) fail(400, "メールアドレスとパスワードを入力してください");
  const now = Date.now();
  const failures = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM login_failures WHERE email = ? AND created_at > ?")
    .bind(addr, now - LOCK_WINDOW_MS)
    .first<number>("n");
  if ((failures ?? 0) >= MAX_FAILURES) fail(429, "ログイン失敗が続いたため一時的にロックしています。15分ほど待ってください");

  const user = await c.env.DB.prepare("SELECT id, email, name, role, status, password_hash FROM users WHERE email = ?")
    .bind(addr)
    .first<{ id: string; email: string; name: string; role: string; status: string; password_hash: string }>();
  const ok = await verifyPassword(pass, user?.password_hash ?? (await getDummyHash()));
  if (!user || !ok || user.status !== "active") {
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO login_failures (email, created_at) VALUES (?, ?)").bind(addr, now),
      c.env.DB.prepare("DELETE FROM login_failures WHERE created_at < ?").bind(now - LOCK_WINDOW_MS),
    ]);
    fail(401, "メールアドレスまたはパスワードが正しくありません");
  }
  await c.env.DB.prepare("DELETE FROM login_failures WHERE email = ?").bind(addr).run();
  await createSession(c, user.id);
  return c.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

auth.post("/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(await sha256(token)).run();
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
  await consumeToken(c.env.DB, row.token_hash);
  const id = crypto.randomUUID();
  const now = Date.now();
  await c.env.DB.prepare(
    "INSERT INTO users (id, email, name, password_hash, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)",
  )
    .bind(id, row.email, name, hash, row.role ?? "member", now, now)
    .run();
  await createSession(c, id);
  return c.json({ user: { id, email: row.email, name, role: row.role ?? "member" } }, 201);
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

/** ログイン中の利用者が自分のパスワードを変える */
auth.post("/password", requireAuth, async (c) => {
  const body = await readJson(c);
  const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const next = password(body, "newPassword");
  const row = await c.env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(c.var.user.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(current, row.password_hash))) fail(403, "現在のパスワードが正しくありません");
  await c.env.DB.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
    .bind(await hashPassword(next), Date.now(), c.var.user.id)
    .run();
  await revokeUserSessions(c.env.DB, c.var.user.id);
  await createSession(c, c.var.user.id);
  return c.json({ ok: true });
});
