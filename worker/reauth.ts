import { clearAttempts, purgeAttempts, takeAttempt } from "./attempts";
import { verifyPassword } from "./crypto";
import { fail } from "./http";

const WINDOW_MS = 15 * 60 * 1000;
const LIMIT = 10;
const ATTEMPTS = { table: "reauth_failures", column: "user_id" } as const;

/** 操作・セッションを変えても共通の制限。先に試行枠を確保して並列試行も制限する */
export async function verifyCurrentPassword(db: D1Database, userId: string, given: string, stored: string | undefined): Promise<void> {
  const attempt = await takeAttempt(db, ATTEMPTS, userId, WINDOW_MS, LIMIT);
  if (attempt === null) fail(429, "パスワードの確認に失敗し続けたため、15分ほど待ってからもう一度試してください");
  if (!stored || !(await verifyPassword(given, stored))) {
    await purgeAttempts(db, ATTEMPTS, WINDOW_MS).run();
    fail(403, "現在のパスワードが正しくありません");
  }
  await clearAttempts(db, ATTEMPTS, userId);
}
