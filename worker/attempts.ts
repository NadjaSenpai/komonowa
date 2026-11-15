/**
 * 回数制限つきの試し（ログイン、共有パスワード、再認証）。
 * 先に試しを記録してから数える。D1 は batch を順に処理するので、同時に来ても limit を超えた分は確かめずに断れる
 * （「数える → 確かめる → 記録する」だと、同時に送られると数え終わる前に何回も試せてしまう）
 */
type AttemptTable =
  | { table: "login_failures"; column: "email" }
  | { table: "share_passcode_failures"; column: "article_id" }
  | { table: "reauth_failures"; column: "user_id" };

/** どの記録を、どの期間に、何回まで許すか */
export type AttemptPolicy = AttemptTable & { windowMs: number; limit: number };

export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

/** 試してよければ記録の rowid を、limit を超えていれば null を返す（そのときは記録を残さない） */
export async function takeAttempt(db: D1Database, policy: AttemptPolicy, key: string): Promise<number | null> {
  const now = Date.now();
  const [inserted, counted] = await db.batch<{ id?: number; n?: number }>([
    db.prepare(`INSERT INTO ${policy.table} (${policy.column}, created_at) VALUES (?, ?) RETURNING rowid AS id`).bind(key, now),
    db.prepare(`SELECT COUNT(*) AS n FROM ${policy.table} WHERE ${policy.column} = ? AND created_at > ?`).bind(key, now - policy.windowMs),
  ]);
  const id = inserted!.results[0]!.id!;
  if (counted!.results[0]!.n! > policy.limit) {
    // 止めた試しは数に入れない（攻撃が続く間、制限が延々と延びないように）
    await db.prepare(`DELETE FROM ${policy.table} WHERE rowid = ?`).bind(id).run();
    return null;
  }
  return id;
}

/** 成功したら、その相手の記録を消す */
export async function clearAttempts(db: D1Database, policy: AttemptPolicy, key: string): Promise<void> {
  await db.prepare(`DELETE FROM ${policy.table} WHERE ${policy.column} = ?`).bind(key).run();
}

/** 失敗したついでに、古い記録を消す */
export async function purgeAttempts(db: D1Database, policy: AttemptPolicy): Promise<void> {
  await db
    .prepare(`DELETE FROM ${policy.table} WHERE created_at < ?`)
    .bind(Date.now() - policy.windowMs)
    .run();
}
