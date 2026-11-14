#!/usr/bin/env node
// D1 と R2 の手動バックアップ。
//   node scripts/backup.mjs --remote        # 本番（Cloudflare 上）
//   node scripts/backup.mjs --local         # wrangler dev のローカルデータ
// 出力: backups/<日時>/d1.sql, manifest.json, r2/<key>（添付とアイコン画像）
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DB_NAME, BUCKET, modeFlag, wrangler } from "./wrangler.mjs";

const mode = modeFlag(process.argv);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.resolve(process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? path.join("backups", stamp));
mkdirSync(path.join(outDir, "r2"), { recursive: true });

console.log(`[1/3] D1 をエクスポート → ${path.join(outDir, "d1.sql")}`);
wrangler(["d1", "export", DB_NAME, mode, "--output", path.join(outDir, "d1.sql")]);

console.log("[2/3] 添付ファイルとアイコン画像の一覧を取得");
const out = wrangler(["d1", "execute", DB_NAME, mode, "--json", "--command", "SELECT r2_key, content_type, size FROM attachments UNION ALL SELECT 'avatars/' || id || '/' || avatar_id, avatar_type, NULL FROM users WHERE avatar_id IS NOT NULL ORDER BY 1"], {
  capture: true,
});
const files = JSON.parse(out)[0].results;

console.log(`[3/3] R2 から ${files.length} 件をダウンロード`);
for (const [i, f] of files.entries()) {
  if (!/^(attachments|avatars)\/[0-9a-f-]+\/[0-9a-f-]+$/.test(f.r2_key)) throw new Error(`想定外のキー: ${f.r2_key}`);
  const dest = path.join(outDir, "r2", ...f.r2_key.split("/"));
  mkdirSync(path.dirname(dest), { recursive: true });
  wrangler(["r2", "object", "get", `${BUCKET}/${f.r2_key}`, mode, "--file", dest], { quiet: true });
  process.stdout.write(`  ${i + 1}/${files.length}\r`);
}

writeFileSync(
  path.join(outDir, "manifest.json"),
  JSON.stringify({ createdAt: new Date().toISOString(), source: mode, database: DB_NAME, bucket: BUCKET, files }, null, 2),
);
console.log(`\n完了: ${outDir}`);
console.log("このフォルダーには全記事と添付が含まれます。暗号化された安全な場所に保管してください。");
