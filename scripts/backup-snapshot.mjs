import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

// 本番を再照会せず、バックアップしたSQLと同じ時点のファイル一覧を取得する。
export function snapshotFiles(sqlFile) {
  const query = `SELECT r2_key, content_type, size FROM attachments
    UNION ALL SELECT 'avatars/' || id || '/' || avatar_id, avatar_type, NULL FROM users
    WHERE avatar_id IS NOT NULL ORDER BY 1;`;
  const result = spawnSync("sqlite3", ["-bail", "-json", ":memory:"], {
    input: `${readFileSync(sqlFile, "utf8")}\n${query}\n`,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`バックアップSQLの読み込みに失敗しました: ${result.stderr}`);
  return JSON.parse(result.stdout || "[]");
}
