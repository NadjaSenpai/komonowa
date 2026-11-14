import { Hono } from "hono";
import { randomToken, sha256 } from "../crypto";
import type { AppEnv } from "../env";
import { email, fail, readJson, str } from "../http";
import { requireAdmin, requireAuth, revokeUserSessions } from "../session";
import { sendOrFail } from "../mail";
import { inviteMail, resetMail } from "../mailTemplates";
import { assertTitleFree } from "./articles";
import { deleteObjects } from "./attachments";
import { isBlocked, removeAccount } from "../accounts";
import { EMAIL_BLOCKED } from "./profile";

const HOUR = 60 * 60 * 1000;
const RESTORE_CLASH = "同じタイトルの記事がすでにあります。どちらかのタイトルを変えてから戻してください";
export const admin = new Hono<AppEnv>();
admin.use("*", requireAuth, requireAdmin);

// ---- 利用者 ----

admin.get("/users", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, email, name, role, status, is_owner, avatar_id, created_at FROM users WHERE deleted_at IS NULL ORDER BY created_at",
  ).all();
  return c.json({ users: results });
});

admin.patch("/users/:id", async (c) => {
  const id = c.req.param("id");
  const body = await readJson(c);
  const target = await c.env.DB.prepare("SELECT id, role, status, is_owner FROM users WHERE id = ? AND deleted_at IS NULL").bind(id).first<{
    id: string;
    role: string;
    status: string;
    is_owner: number;
  }>();
  if (!target) fail(404, "利用者が見つかりません");
  // 所有者はほかの管理者に締め出されない（所有者本人も下の「自分自身」の条件で変更できない）
  if (target.is_owner && id !== c.var.user.id) fail(403, "所有者の権限変更や無効化はできません");

  const role = body.role === undefined ? target.role : body.role;
  const status = body.status === undefined ? target.status : body.status;
  if (role !== "admin" && role !== "member") fail(400, "権限が正しくありません");
  if (status !== "active" && status !== "disabled") fail(400, "状態が正しくありません");
  if (id === c.var.user.id && (role !== "admin" || status !== "active")) {
    fail(400, "自分自身の権限変更や無効化はできません");
  }
  // 有効な管理者が 0 人にならないよう、条件付き UPDATE で守る
  const res = await c.env.DB.prepare(
    `UPDATE users SET role = ?1, status = ?2, updated_at = ?3
      WHERE id = ?4
        AND (( ?1 = 'admin' AND ?2 = 'active')
             OR (SELECT COUNT(*) FROM users WHERE role = 'admin' AND status = 'active' AND id <> ?4) > 0)`,
  )
    .bind(role, status, Date.now(), id)
    .run();
  if (res.meta.changes === 0) fail(409, "有効な管理者が1人以上必要です");
  // 招待できなくなった人（無効化・降格）が送った、まだ使われていない招待は取り消す（自分宛ての管理者招待で戻ってこられないように）
  if (role !== "admin" || status !== "active") {
    await c.env.DB.prepare("UPDATE auth_tokens SET revoked_at = ? WHERE kind = 'invite' AND created_by = ? AND used_at IS NULL AND revoked_at IS NULL")
      .bind(Date.now(), id)
      .run();
  }
  if (status === "disabled") {
    await revokeUserSessions(c.env.DB, id);
    await c.env.DB.prepare("UPDATE auth_tokens SET revoked_at = ? WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL").bind(Date.now(), id).run();
    // この人が始めた共有は止める（強制退会と同じ。再有効化しても戻らず、始め直すと新しい URL になる）
    await c.env.DB.prepare("DELETE FROM article_shares WHERE created_by = ?").bind(id).run();
  }
  return c.json({ ok: true });
});

/**
 * 強制退会。名前・メールアドレス・アイコン・パスワードを消し、同じアドレスを招待にもメールアドレスの変更先にも使えなくする。
 * 記事と履歴は「（削除されたユーザー）」として残る
 */
admin.post("/users/:id/remove", async (c) => {
  const id = c.req.param("id");
  if (id === c.var.user.id) fail(400, "自分は強制退会できません。退会はアカウント画面から行ってください");
  const target = await c.env.DB.prepare("SELECT is_owner FROM users WHERE id = ? AND deleted_at IS NULL").bind(id).first<{ is_owner: number }>();
  if (!target) fail(404, "利用者が見つかりません");
  if (target.is_owner) fail(403, "所有者は強制退会できません");
  await removeAccount(c.env, id, { block: true });
  return c.json({ ok: true });
});

/** パスワード再設定リンクを本人の登録アドレスにメールで送る。送れたら、以前の未使用リンクは無効にする */
admin.post("/users/:id/reset-link", async (c) => {
  const id = c.req.param("id");
  const user = await c.env.DB.prepare("SELECT id, email FROM users WHERE id = ? AND status = 'active'").bind(id).first<{
    id: string;
    email: string;
  }>();
  if (!user) fail(404, "有効な利用者が見つかりません");
  const token = randomToken();
  const now = Date.now();
  const expires = now + 24 * HOUR;
  await sendOrFail(c.env, resetMail({ to: user.email, sender: c.var.user.name, url: `${new URL(c.req.url).origin}/reset#${token}`, expiresAt: expires }));
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE auth_tokens SET revoked_at = ? WHERE kind = 'reset' AND user_id = ? AND used_at IS NULL AND revoked_at IS NULL").bind(now, id),
    c.env.DB.prepare("INSERT INTO auth_tokens (token_hash, kind, user_id, created_by, expires_at, created_at) VALUES (?, 'reset', ?, ?, ?, ?)").bind(
      await sha256(token),
      id,
      c.var.user.id,
      expires,
      now,
    ),
  ]);
  return c.json({ expiresAt: expires }, 201);
});

// ---- 招待 ----

admin.get("/invites", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT t.token_hash AS id, t.email, t.role, t.expires_at, t.used_at, t.revoked_at, t.created_at, u.name AS created_by_name
       FROM auth_tokens t JOIN users u ON u.id = t.created_by
      WHERE t.kind = 'invite' ORDER BY t.created_at DESC LIMIT 100`,
  ).all();
  return c.json({ invites: results });
});

admin.post("/invites", async (c) => {
  const body = await readJson(c);
  const addr = email(body);
  const role = body.role ?? "member";
  if (role !== "admin" && role !== "member") fail(400, "権限が正しくありません");
  const hours = body.expiresInHours ?? 72;
  if (typeof hours !== "number" || !Number.isInteger(hours) || hours < 1 || hours > 24 * 14) {
    fail(400, "有効期限は1〜336時間で指定してください");
  }
  if (await isBlocked(c.env.DB, addr)) fail(409, EMAIL_BLOCKED);
  if (await c.env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(addr).first()) {
    fail(409, "このメールアドレスはすでに登録されています");
  }
  const token = randomToken();
  const now = Date.now();
  const expires = now + hours * HOUR;
  // 先に送り、送れたときだけ記録する（失敗しても前の招待はそのまま使える）
  await sendOrFail(c.env, inviteMail({ to: addr, inviter: c.var.user.name, role, url: `${new URL(c.req.url).origin}/invite#${token}`, expiresAt: expires }));
  await c.env.DB.batch([
    // 同じアドレスへの未使用の招待は置き換える
    c.env.DB.prepare("UPDATE auth_tokens SET revoked_at = ? WHERE kind = 'invite' AND email = ? AND used_at IS NULL AND revoked_at IS NULL").bind(now, addr),
    c.env.DB.prepare("INSERT INTO auth_tokens (token_hash, kind, email, role, created_by, expires_at, created_at) VALUES (?, 'invite', ?, ?, ?, ?, ?)").bind(
      await sha256(token),
      addr,
      role,
      c.var.user.id,
      expires,
      now,
    ),
  ]);
  return c.json({ expiresAt: expires }, 201);
});

admin.delete("/invites/:id", async (c) => {
  const res = await c.env.DB.prepare(
    "UPDATE auth_tokens SET revoked_at = ? WHERE token_hash = ? AND kind = 'invite' AND used_at IS NULL AND revoked_at IS NULL",
  )
    .bind(Date.now(), c.req.param("id"))
    .run();
  if (res.meta.changes === 0) fail(404, "取り消せる招待が見つかりません");
  return c.json({ ok: true });
});

// ---- ごみ箱 ----

admin.get("/trash", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.title, a.deleted_at, u.name AS deleted_by_name
       FROM articles a LEFT JOIN users u ON u.id = a.deleted_by
      WHERE a.deleted_at IS NOT NULL ORDER BY a.deleted_at DESC`,
  ).all();
  return c.json({ articles: results });
});

admin.post("/trash/:id/restore", async (c) => {
  const id = c.req.param("id");
  const trashed = await c.env.DB.prepare("SELECT title_key FROM articles WHERE id = ? AND deleted_at IS NOT NULL").bind(id).first<{ title_key: string }>();
  if (!trashed) fail(404, "ごみ箱に記事が見つかりません");
  // ごみ箱の記事はタイトルを確保していないので、その間に同じタイトルの記事ができていることがある
  await assertTitleFree(c.env.DB, trashed.title_key, id, RESTORE_CLASH);
  let res: D1Result;
  try {
    res = await c.env.DB.prepare("UPDATE articles SET deleted_at = NULL, deleted_by = NULL WHERE id = ? AND deleted_at IS NOT NULL").bind(id).run();
  } catch (err) {
    if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) fail(409, RESTORE_CLASH);
    throw err;
  }
  if (res.meta.changes === 0) fail(404, "ごみ箱に記事が見つかりません");
  return c.json({ ok: true });
});

/** 完全削除。履歴・タグの関連・添付（R2 本体を含む）も消す */
admin.delete("/trash/:id", async (c) => {
  const id = c.req.param("id");
  const article = await c.env.DB.prepare("SELECT id FROM articles WHERE id = ? AND deleted_at IS NOT NULL").bind(id).first();
  if (!article) fail(404, "ごみ箱に記事が見つかりません");
  const { results } = await c.env.DB.prepare("SELECT r2_key, thumb_key FROM attachments WHERE article_id = ?")
    .bind(id)
    .all<{ r2_key: string; thumb_key: string | null }>();
  // 先に D1 から消す。R2 が後で失敗しても、参照されないファイルが残るだけで済む（逆だと、添付の消えた記事が残る）
  await c.env.DB.prepare("DELETE FROM articles WHERE id = ? AND deleted_at IS NOT NULL").bind(id).run();
  await deleteObjects(c.env, results);
  return c.json({ ok: true });
});

// ---- タグ ----

/** 共有中の記事。管理者はほかの人の共有も止められる */
admin.get("/shares", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.article_id, a.title, s.created_at, u.name AS created_by_name, s.passcode IS NOT NULL AS has_passcode
       FROM article_shares s JOIN articles a ON a.id = s.article_id JOIN users u ON u.id = s.created_by
      ORDER BY s.created_at DESC`,
  ).all<{ has_passcode: number }>();
  return c.json({ shares: results.map((r) => ({ ...r, has_passcode: r.has_passcode === 1 })) });
});

admin.delete("/shares/:articleId", async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM article_shares WHERE article_id = ?").bind(c.req.param("articleId")).run();
  if (res.meta.changes === 0) fail(404, "共有されていません");
  return c.json({ ok: true });
});

admin.patch("/tags/:id", async (c) => {
  const body = await readJson(c);
  const name = str(body, "name", { max: 40, label: "タグ名" }).normalize("NFKC");
  if (name.includes(",")) fail(400, "タグ名にカンマは使えません");
  const id = c.req.param("id");
  const clash = await c.env.DB.prepare("SELECT id FROM tags WHERE name = ? AND id <> ?").bind(name, id).first();
  if (clash) fail(409, "同じ名前のタグがすでにあります");
  const res = await c.env.DB.prepare("UPDATE tags SET name = ? WHERE id = ?").bind(name, id).run();
  if (res.meta.changes === 0) fail(404, "タグが見つかりません");
  return c.json({ ok: true });
});

admin.delete("/tags/:id", async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM tags WHERE id = ?").bind(c.req.param("id")).run();
  if (res.meta.changes === 0) fail(404, "タグが見つかりません");
  return c.json({ ok: true });
});
