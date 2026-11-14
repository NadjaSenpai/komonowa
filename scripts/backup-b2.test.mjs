import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { backupToB2, encryptArchive, obsoleteVersions, validatePassphrase } from "./backup-b2.mjs";

test("24世代を残し、対象外のファイルは削除しない", () => {
  const versions = Array.from({ length: 26 }, (_, i) => ({
    Key: `komonowa/backup-2026-11-${String(i + 1).padStart(2, "0")}T00-00-00-000Z.tar.gz.gpg`,
    VersionId: `version-${i}`,
  }));
  assert.deepEqual(obsoleteVersions([...versions, { Key: "other/file", VersionId: "other" }]), versions.slice(0, 2).reverse());
  assert.deepEqual(obsoleteVersions(versions.slice(0, 24)), []);
});

test("削除対象にバージョンIDがなければ中止する", () => {
  assert.throws(() => obsoleteVersions([{ Key: "komonowa/backup-2026-11-01T00-00-00-000Z.tar.gz.gpg" }]), /VersionId/);
});

test("パスフレーズの欠落・短すぎる値・改行を拒否する", () => {
  for (const value of [undefined, "short", `${"x".repeat(40)}\n`]) assert.throws(() => validatePassphrase(value));
  assert.doesNotThrow(() => validatePassphrase("x".repeat(44)));
});

test("暗号化ファイルを復号でき、誤った鍵では復号に失敗する", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "komonowa-gpg-test-"));
  try {
    const source = path.join(dir, "source");
    const encrypted = path.join(dir, "encrypted.gpg");
    const restored = path.join(dir, "restored");
    writeFileSync(source, "private wiki backup");
    const passphrase = "test-passphrase-with-at-least-32-characters";
    encryptArchive(source, encrypted, passphrase, dir);
    const decrypt = (password) =>
      spawnSync(
        "gpg",
        ["--homedir", dir, "--batch", "--yes", "--pinentry-mode", "loopback", "--passphrase-fd", "0", "--output", restored, "--decrypt", encrypted],
        { input: password, encoding: "utf8" },
      );
    assert.equal(decrypt(passphrase).status, 0);
    assert.equal(readFileSync(restored, "utf8"), "private wiki backup");
    assert.notEqual(decrypt("incorrect-passphrase").status, 0);
    const damaged = readFileSync(encrypted);
    damaged[damaged.length - 10] ^= 1;
    writeFileSync(encrypted, damaged);
    assert.notEqual(decrypt(passphrase).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("アップロード・再取得・検証の失敗時は旧世代を削除しない", async () => {
  const env = Object.fromEntries(
    ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "BACKUP_PASSPHRASE"].map((name) => [
      name,
      "test-value-with-at-least-32-characters",
    ]),
  );
  for (const failure of ["upload", "download", "corrupt", "none"]) {
    const calls = [];
    let encrypted;
    let uploadedKey;
    const execute = (command, args) => {
      calls.push(args);
      if (command === process.execPath) {
        const dir = args.find((arg) => arg.startsWith("--out=")).slice(6);
        mkdirSync(dir);
        writeFileSync(path.join(dir, "d1.sql"), "test data");
        return "";
      }
      if (command !== "aws") return spawnSync(command, args, { encoding: "utf8" }).stdout;
      const cp = args.indexOf("cp");
      if (cp !== -1) {
        const [source, dest] = args.slice(cp + 1);
        if (source.startsWith("s3://")) {
          if (failure === "download") throw new Error("download failed");
          copyFileSync(encrypted, dest);
          if (failure === "corrupt") writeFileSync(dest, "corrupt");
        } else {
          if (failure === "upload") throw new Error("upload failed");
          encrypted = source;
          uploadedKey = dest.replace("s3://komonowa-backups/", "");
        }
        return "";
      }
      if (args.includes("list-object-versions"))
        return JSON.stringify({
          Versions: [
            { Key: uploadedKey, VersionId: "current", IsLatest: true },
            ...Array.from({ length: 24 }, (_, i) => ({
              Key: `komonowa/backup-2025-01-${String(i + 1).padStart(2, "0")}T00-00-00-000Z.tar.gz.gpg`,
              VersionId: `old-${i}`,
            })),
          ],
        });
      return "{}";
    };
    if (failure === "none") await backupToB2({ execute, env });
    else await assert.rejects(backupToB2({ execute, env }));
    const deletes = calls.filter((args) => args.includes("delete-object"));
    assert.equal(deletes.length, failure === "none" ? 1 : 0);
    if (deletes.length) assert.ok(deletes[0].includes("--version-id"));
  }
});
