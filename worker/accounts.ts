import { randomToken, sha256 } from "./crypto";
import { fail } from "./http";
import { revokeInvitesFrom, revokeResetTokens } from "./tokens";

import { DELETED_EMAIL_DOMAIN, DELETED_NAME } from "../shared/accounts";

/** 招待や登録で、そのアドレスの利用者がもういるとき */
export const EMAIL_REGISTERED = "このメールアドレスはすでに登録されています";
/** メールアドレスの変更先を、ほかの人が使っているとき */
export const EMAIL_TAKEN = "このメールアドレスはすでに使われています";
/** 強制退会したアドレス */
export const EMAIL_BLOCKED = "このメールアドレスは使えません";

/** アイコン画像の R2 キー */
export function avatarKey(userId: string, avatarId: string) {
  return `avatars/${userId}/${avatarId}`;
}

const emailHash = (email: string) => sha256(email.trim().toLowerCase());

/** 強制退会したアドレスか。招待とメールアドレスの変更先で確かめる */
export async function isBlocked(db: D1Database, email: string): Promise<boolean> {
  return (
    (await db
      .prepare("SELECT 1 FROM blocked_emails WHERE email_hash = ?")
      .bind(await emailHash(email))
      .first()) !== null
  );
}

/**
 * 退会・強制退会の共通処理。名前・メールアドレス・アイコン・自己紹介・パスワードを消し、ログインできなくする。
 * 有効な管理者が 0 人になる場合は 409。block なら、元のアドレスを締め出す
 */
export async function removeAccount(env: Env, userId: string, options: { block: boolean }): Promise<void> {
  const user = await env.DB.prepare("SELECT email, avatar_id FROM users WHERE id = ? AND deleted_at IS NULL")
    .bind(userId)
    .first<{ email: string; avatar_id: string | null }>();
  if (!user) fail(404, "利用者が見つかりません");
  const now = Date.now();
  const placeholder = `deleted-${userId}${DELETED_EMAIL_DOMAIN}`;
  // 有効な管理者が 0 人にならないよう、条件付き UPDATE で守る
  const res = await env.DB.prepare(
    `UPDATE users SET name = ?1, email = ?2, password_hash = ?3, avatar_id = NULL, avatar_type = NULL, bio = '',
            status = 'disabled', role = 'member', is_owner = 0, deleted_at = ?4, updated_at = ?4
      WHERE id = ?5 AND deleted_at IS NULL
        AND (role <> 'admin' OR status <> 'active'
             OR (SELECT COUNT(*) FROM users WHERE role = 'admin' AND status = 'active' AND id <> ?5) > 0)`,
  )
    // パスワードのハッシュの形をしていない値なので、どのパスワードとも一致しない
    .bind(DELETED_NAME, placeholder, `removed:${randomToken()}`, now, userId)
    .run();
  if (res.meta.changes === 0) fail(409, "有効な管理者が1人以上必要です");

  const statements = [
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM email_changes WHERE user_id = ?").bind(userId),
    revokeResetTokens(env.DB, userId, now),
    revokeInvitesFrom(env.DB, userId, now),
    // 招待の記録やログイン失敗の記録に残る元のアドレスも消す
    env.DB.prepare("UPDATE auth_tokens SET email = ? WHERE kind = 'invite' AND email = ?").bind(placeholder, user.email),
    env.DB.prepare("DELETE FROM login_failures WHERE email = ?").bind(user.email),
    // この人が始めた共有は止める
    env.DB.prepare("DELETE FROM article_shares WHERE created_by = ?").bind(userId),
  ];
  if (options.block) {
    statements.push(
      env.DB.prepare("INSERT INTO blocked_emails (email_hash, created_at) VALUES (?, ?) ON CONFLICT DO NOTHING").bind(await emailHash(user.email), now),
    );
  }
  await env.DB.batch(statements);
  if (user.avatar_id) await env.FILES.delete(avatarKey(userId, user.avatar_id));
}
