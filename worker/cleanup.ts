const DAY = 24 * 60 * 60 * 1000;

/**
 * 期限切れの記録を消す（毎日の cron。wrangler.jsonc の triggers）。
 * 招待と再設定のトークンは、管理画面の招待一覧に履歴として出すので、期限から 30 日は残す
 */
export async function purgeExpired(db: D1Database): Promise<void> {
  const now = Date.now();
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    db.prepare("DELETE FROM email_changes WHERE expires_at < ?").bind(now),
    db.prepare("DELETE FROM auth_tokens WHERE expires_at < ?").bind(now - 30 * DAY),
    // 失敗の記録は次の失敗のときにも消すが（attempts.ts）、失敗が続かないと残るので、ここでも消す
    db.prepare("DELETE FROM login_failures WHERE created_at < ?").bind(now - DAY),
    db.prepare("DELETE FROM share_passcode_failures WHERE created_at < ?").bind(now - DAY),
    db.prepare("DELETE FROM reauth_failures WHERE created_at < ?").bind(now - DAY),
  ]);
}
