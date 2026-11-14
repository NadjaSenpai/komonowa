// D1/R2 を暗号化して B2 へ保存し、検証後に直近24世代を残す。
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream, mkdtempSync, mkdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BUCKET = "komonowa-backups";
const ENDPOINT = "https://s3.us-west-004.backblazeb2.com";
const PREFIX = "komonowa/";
const ARCHIVE_KEY = /^komonowa\/backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.tar\.gz\.gpg$/;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} が失敗しました: ${result.stderr || "詳細は実行ログを確認してください"}`);
  return result.stdout;
}

export function validatePassphrase(value) {
  if (!value || value.length < 32 || /[\r\n]/.test(value)) throw new Error("BACKUP_PASSPHRASE に32文字以上・改行なしの値を設定してください");
}

export function encryptArchive(source, target, passphrase, homedir) {
  validatePassphrase(passphrase);
  run(
    "gpg",
    [
      "--homedir",
      homedir,
      "--batch",
      "--yes",
      "--no-symkey-cache",
      "--pinentry-mode",
      "loopback",
      "--passphrase-fd",
      "0",
      "--symmetric",
      "--cipher-algo",
      "AES256",
      "--output",
      target,
      source,
    ],
    { input: passphrase },
  );
}

export function obsoleteVersions(versions) {
  const archives = versions.filter((v) => ARCHIVE_KEY.test(v.Key));
  // ID なしの削除は旧バージョンを残すため、削除開始前に全件を検証する。
  if (archives.some((v) => !v.VersionId || v.VersionId === "null")) throw new Error("バックアップの VersionId がありません");
  return archives.sort((a, b) => b.Key.localeCompare(a.Key) || String(b.LastModified).localeCompare(String(a.LastModified))).slice(24);
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export async function backupToB2({ execute = run, env = process.env } = {}) {
  const passphrase = env.BACKUP_PASSPHRASE;
  validatePassphrase(passphrase);
  for (const name of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) {
    if (!env[name]) throw new Error(`${name} が設定されていません`);
  }
  const temp = mkdtempSync(path.join(os.tmpdir(), "komonowa-backup-"));
  const aws = (args) => execute("aws", ["--endpoint-url", ENDPOINT, "--region", "us-west-004", "--output", "json", ...args]);
  try {
    const data = path.join(temp, "data");
    const archive = path.join(temp, "backup.tar.gz");
    const encrypted = `${archive}.gpg`;
    const downloaded = path.join(temp, "verified.gpg");
    const gpgHome = path.join(temp, "gpg");
    mkdirSync(gpgHome, { mode: 0o700 });
    console.log("D1/R2 のバックアップを取得します");
    execute(process.execPath, ["scripts/backup.mjs", "--remote", `--out=${data}`], { stdio: "inherit" });
    execute("tar", ["-czf", archive, "-C", data, "."]);
    encryptArchive(archive, encrypted, passphrase, gpgHome);
    const key = `${PREFIX}backup-${new Date().toISOString().replace(/[:.]/g, "-")}.tar.gz.gpg`;
    console.log(`B2 へ保存します: ${key} (${statSync(encrypted).size} bytes)`);
    aws(["s3", "cp", encrypted, `s3://${BUCKET}/${key}`, "--no-progress"]);
    // 保存した暗号文を取得し直し、通信・保存結果が一致するまで旧世代を削除しない。
    aws(["s3", "cp", `s3://${BUCKET}/${key}`, downloaded, "--no-progress"]);
    if ((await sha256(encrypted)) !== (await sha256(downloaded))) throw new Error("B2 のバックアップの SHA-256 が一致しません");
    // AWS CLI はページを自動取得する。--no-paginate / --max-items を指定しない。
    const listed = JSON.parse(aws(["s3api", "list-object-versions", "--bucket", BUCKET, "--prefix", PREFIX]));
    if (!listed.Versions?.some((v) => v.Key === key && v.IsLatest)) throw new Error("保存したバックアップを一覧で確認できません");
    const obsolete = obsoleteVersions(listed.Versions);
    for (const version of obsolete) {
      aws(["s3api", "delete-object", "--bucket", BUCKET, "--key", version.Key, "--version-id", version.VersionId]);
    }
    console.log(`バックアップを検証しました。旧世代 ${obsolete.length} 件を削除し、直近24世代を保持します`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  backupToB2().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
