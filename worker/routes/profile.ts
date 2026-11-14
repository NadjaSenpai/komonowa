import { Hono } from "hono";
import type { AppEnv } from "../env";
import { randomToken, sha256, verifyPassword } from "../crypto";
import { email, fail, readJson, str } from "../http";
import { sendOrFail } from "../mail";
import { emailChangeMail } from "../mailTemplates";
import { requireAuth } from "../session";
import { contentMatches } from "./attachments";

/** アイコン画像の上限。UI は 256px に縮小してから送るので通常は数十 KB */
export const MAX_AVATAR_BYTES = 1024 * 1024;

/** 受け付ける画像形式。Content-Type は申告ではなく中身から決める（SVG は XSS になるので不可） */
const AVATAR_TYPES = [
  { ext: "png", mime: "image/png" },
  { ext: "jpg", mime: "image/jpeg" },
  { ext: "webp", mime: "image/webp" },
] as const;

function detectAvatarType(bytes: Uint8Array) {
  return AVATAR_TYPES.find((t) => contentMatches(t.ext, bytes))?.mime ?? null;
}

function avatarKey(userId: string, avatarId: string) {
  return `avatars/${userId}/${avatarId}`;
}

/** 本人が自分の表示名とアイコンを変える（/api/auth 配下） */
export const profile = new Hono<AppEnv>();
profile.use("*", requireAuth);

profile.patch("/profile", async (c) => {
  const body = await readJson(c);
  const name = str(body, "name", { max: 50, label: "表示名" });
  await c.env.DB.prepare("UPDATE users SET name = ?, updated_at = ? WHERE id = ?").bind(name, Date.now(), c.var.user.id).run();
  return c.json({ user: { ...c.var.user, name } });
});

export const EMAIL_TAKEN = "このメールアドレスはすでに使われています";

/**
 * メールアドレスの変更を申し込む。新しいアドレスに確認メールを送り、リンク（/email#トークン）で確定する（auth.ts）。
 * 管理者がほかの人のアドレスを変える手段は作らない（所有者の再設定メールを横取りできてしまうため）
 */
profile.post("/email", async (c) => {
  const body = await readJson(c);
  const next = email(body);
  const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const userId = c.var.user.id;
  const row = await c.env.DB.prepare("SELECT email, password_hash FROM users WHERE id = ?").bind(userId).first<{ email: string; password_hash: string }>();
  if (!row || !(await verifyPassword(current, row.password_hash))) fail(403, "現在のパスワードが正しくありません");
  if (row.email.toLowerCase() === next) fail(400, "今のメールアドレスと同じです");
  if (await c.env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(next).first()) fail(409, EMAIL_TAKEN);

  const token = randomToken();
  const now = Date.now();
  const expires = now + 24 * 60 * 60 * 1000;
  // 先に送り、送れたときだけ記録する（失敗しても前の申し込みのリンクはそのまま使える）
  await sendOrFail(c.env, emailChangeMail({ to: next, url: `${new URL(c.req.url).origin}/email#${token}`, expiresAt: expires }));
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE email_changes SET revoked_at = ? WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL").bind(now, userId),
    c.env.DB.prepare("INSERT INTO email_changes (token_hash, user_id, new_email, expires_at, created_at) VALUES (?, ?, ?, ?, ?)").bind(
      await sha256(token),
      userId,
      next,
      expires,
      now,
    ),
  ]);
  return c.json({ expiresAt: expires }, 201);
});

profile.put("/avatar", async (c) => {
  const declared = Number(c.req.header("content-length"));
  if (Number.isFinite(declared) && declared > MAX_AVATAR_BYTES + 64 * 1024) fail(413, "アイコン画像は1MBまでです");
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    fail(400, "画像を送信してください");
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) fail(400, "画像を送信してください");
  if (file.size > MAX_AVATAR_BYTES) fail(413, "アイコン画像は1MBまでです");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectAvatarType(bytes);
  if (!type) fail(415, "アイコンに使えるのは PNG・JPEG・WebP の画像です");

  const userId = c.var.user.id;
  const previous = c.var.user.avatar_id;
  const avatarId = crypto.randomUUID();
  await c.env.FILES.put(avatarKey(userId, avatarId), bytes, { httpMetadata: { contentType: type } });
  try {
    await c.env.DB.prepare("UPDATE users SET avatar_id = ?, avatar_type = ?, updated_at = ? WHERE id = ?")
      .bind(avatarId, type, Date.now(), userId)
      .run();
  } catch (err) {
    await c.env.FILES.delete(avatarKey(userId, avatarId));
    throw err;
  }
  if (previous) await c.env.FILES.delete(avatarKey(userId, previous));
  return c.json({ user: { ...c.var.user, avatar_id: avatarId } });
});

profile.delete("/avatar", async (c) => {
  const userId = c.var.user.id;
  const previous = c.var.user.avatar_id;
  await c.env.DB.prepare("UPDATE users SET avatar_id = NULL, avatar_type = NULL, updated_at = ? WHERE id = ?").bind(Date.now(), userId).run();
  if (previous) await c.env.FILES.delete(avatarKey(userId, previous));
  return c.json({ user: { ...c.var.user, avatar_id: null } });
});

/** アイコンの配信（/api/avatars 配下）。ID は差し替えのたびに変わるので長くキャッシュしてよい */
export const avatars = new Hono<AppEnv>();
avatars.use("*", requireAuth);

avatars.get("/:id", async (c) => {
  const avatarId = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT id, avatar_type FROM users WHERE avatar_id = ?")
    .bind(avatarId)
    .first<{ id: string; avatar_type: string }>();
  if (!row) fail(404, "画像が見つかりません");
  const object = await c.env.FILES.get(avatarKey(row.id, avatarId));
  if (!object) fail(404, "画像が見つかりません");
  return new Response(object.body, {
    headers: {
      "content-type": row.avatar_type,
      "content-length": String(object.size),
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=31536000, immutable",
      "cross-origin-resource-policy": "same-origin",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
});
