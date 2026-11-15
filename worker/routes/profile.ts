import { Hono } from "hono";
import type { AppEnv } from "../env";
import { randomToken, sha256 } from "../crypto";
import { verifyCurrentPassword } from "../reauth";
import { email, fail, origin, readJson, str, text } from "../http";
import { EMAIL_BLOCKED, EMAIL_TAKEN, avatarKey, isBlocked } from "../accounts";
import { sendOrFail } from "../mail";
import { emailChangeMail } from "../mailTemplates";
import { requireAuth } from "../session";
import { BIO_MAX } from "../../shared/accounts";
import { revokeEmailChanges } from "../tokens";
import { contentMatches, imageResponse } from "./attachments";

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

/** 本人が自分の表示名・自己紹介・アイコンを変える（/api/auth 配下） */
export const profile = new Hono<AppEnv>();
profile.use("*", requireAuth);

profile.patch("/profile", async (c) => {
  const body = await readJson(c);
  const name = str(body, "name", { max: 50, label: "表示名" });
  // 自己紹介（Markdown。ユーザーページ routes/users.ts に出る）は、送られたときだけ変える（名前だけ変える呼び出しで消えないように）
  const bio = body.bio === undefined ? null : str(body, "bio", { min: 0, max: BIO_MAX, label: "自己紹介" });
  const row = await c.env.DB.prepare("UPDATE users SET name = ?1, bio = COALESCE(?2, bio), updated_at = ?3 WHERE id = ?4 RETURNING bio")
    .bind(name, bio, Date.now(), c.var.user.id)
    .first<{ bio: string }>();
  return c.json({ user: { ...c.var.user, name }, bio: row?.bio ?? "" });
});

/**
 * メールアドレスの変更を申し込む。新しいアドレスに確認メールを送り、リンク（/email#トークン）で確定する（auth.ts）。
 * 管理者がほかの人のアドレスを変える手段は作らない（所有者の再設定メールを横取りできてしまうため）
 */
profile.post("/email", async (c) => {
  const body = await readJson(c);
  const next = email(body);
  const userId = c.var.user.id;
  const row = await c.env.DB.prepare("SELECT email, password_hash FROM users WHERE id = ?").bind(userId).first<{ email: string; password_hash: string }>();
  await verifyCurrentPassword(c.env.DB, userId, text(body, "currentPassword"), row?.password_hash);
  if (!row) fail(403, "現在のパスワードが正しくありません");
  if (row.email.toLowerCase() === next) fail(400, "今のメールアドレスと同じです");
  if (await isBlocked(c.env.DB, next)) fail(409, EMAIL_BLOCKED);
  if (await c.env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(next).first()) fail(409, EMAIL_TAKEN);

  const token = randomToken();
  const now = Date.now();
  const expires = now + 24 * 60 * 60 * 1000;
  // 先に送り、送れたときだけ記録する（失敗しても前の申し込みのリンクはそのまま使える）
  await sendOrFail(c.env, emailChangeMail({ to: next, url: `${origin(c)}/email#${token}`, expiresAt: expires }));
  await c.env.DB.batch([
    revokeEmailChanges(c.env.DB, userId, now),
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
    await c.env.DB.prepare("UPDATE users SET avatar_id = ?, avatar_type = ?, updated_at = ? WHERE id = ?").bind(avatarId, type, Date.now(), userId).run();
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
  const row = await c.env.DB.prepare("SELECT id, avatar_type FROM users WHERE avatar_id = ?").bind(avatarId).first<{ id: string; avatar_type: string }>();
  if (!row) fail(404, "画像が見つかりません");
  const object = await c.env.FILES.get(avatarKey(row.id, avatarId));
  if (!object) fail(404, "画像が見つかりません");
  return imageResponse(object, row.avatar_type, "private, max-age=31536000, immutable");
});
