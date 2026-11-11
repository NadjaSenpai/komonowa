import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

export const DB_NAME = "wiki-db";
export const BUCKET = "wiki-files";

const require = createRequire(import.meta.url);
// package.json の bin を参照（wrangler は bin/ を exports していない）
const pkgPath = require.resolve("wrangler/package.json");
const bin = path.join(path.dirname(pkgPath), require(pkgPath).bin.wrangler);

export function modeFlag(argv) {
  const local = argv.includes("--local");
  const remote = argv.includes("--remote");
  if (local === remote) {
    console.error("--local か --remote のどちらかを指定してください");
    process.exit(1);
  }
  return local ? "--local" : "--remote";
}

/** wrangler を実行する。失敗したら終了する */
export function wrangler(args, { capture = false, quiet = false } = {}) {
  const res = spawnSync(process.execPath, [bin, ...args], {
    encoding: "utf8",
    stdio: capture || quiet ? ["inherit", "pipe", "pipe"] : "inherit",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (res.status !== 0) {
    if (res.stdout) process.stderr.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    console.error(`wrangler ${args.slice(0, 3).join(" ")} が失敗しました`);
    process.exit(res.status ?? 1);
  }
  return res.stdout ?? "";
}
