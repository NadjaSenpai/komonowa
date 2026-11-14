#!/usr/bin/env node
// backup.mjs で取得した添付ファイルとアイコン画像を R2 に書き戻す。
//   node scripts/restore-r2.mjs backups/<日時> --remote
// D1 の復元は docs/operations.md を参照（先に D1 を戻してから実行する）。
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { BUCKET, modeFlag, wrangler } from "./wrangler.mjs";

const mode = modeFlag(process.argv);
const dir = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!dir) {
  console.error("使い方: node scripts/restore-r2.mjs <バックアップのフォルダー> --local|--remote");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
console.log(`${manifest.files.length} 件を ${BUCKET}（${mode}）へ書き戻します`);
for (const [i, f] of manifest.files.entries()) {
  if (!/^(attachments|avatars)\/[0-9a-f-]+\/[0-9a-f-]+$/.test(f.r2_key)) throw new Error(`想定外のキー: ${f.r2_key}`);
  const src = path.join(dir, "r2", ...f.r2_key.split("/"));
  if (!existsSync(src)) throw new Error(`ファイルがありません: ${src}`);
  wrangler(["r2", "object", "put", `${BUCKET}/${f.r2_key}`, mode, "--file", src, "--content-type", f.content_type], { quiet: true });
  process.stdout.write(`  ${i + 1}/${manifest.files.length}\r`);
}
console.log("\n完了");
