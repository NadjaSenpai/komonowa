import { fail } from "./http";

/** 招待・再設定のリンク（auth_tokens）が使えないとき */
export const LINK_GONE = "リンクが無効か期限切れです。管理者に再発行を依頼してください";

/** メールのリンクに入っているトークンを取り出す。形がおかしければ 400 */
export function readToken(value: unknown): string {
  if (typeof value !== "string" || value.length < 20 || value.length > 100) fail(400, "リンクが正しくありません");
  return value;
}

/** 本人宛ての、まだ使われていない再設定リンクを無効にする */
export function revokeResetTokens(db: D1Database, userId: string, now: number) {
  return db.prepare("UPDATE auth_tokens SET revoked_at = ? WHERE kind = 'reset' AND user_id = ? AND used_at IS NULL AND revoked_at IS NULL").bind(now, userId);
}

/** この人が送った、まだ使われていない招待を取り消す */
export function revokeInvitesFrom(db: D1Database, userId: string, now: number) {
  return db
    .prepare("UPDATE auth_tokens SET revoked_at = ? WHERE kind = 'invite' AND created_by = ? AND used_at IS NULL AND revoked_at IS NULL")
    .bind(now, userId);
}

/** まだ確定していないメールアドレスの変更を取り消す */
export function revokeEmailChanges(db: D1Database, userId: string, now: number) {
  return db.prepare("UPDATE email_changes SET revoked_at = ? WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL").bind(now, userId);
}
