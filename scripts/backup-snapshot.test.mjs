import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { snapshotFiles } from "./backup-snapshot.mjs";

test("エクスポートしたSQLの添付とアイコンだけを列挙する", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "komonowa-snapshot-test-"));
  try {
    const sql = path.join(dir, "d1.sql");
    writeFileSync(
      sql,
      `
      PRAGMA defer_foreign_keys=TRUE;
      CREATE TABLE attachments(r2_key TEXT, content_type TEXT, size INTEGER);
      CREATE TABLE users(id TEXT, avatar_id TEXT, avatar_type TEXT);
      INSERT INTO attachments VALUES ('attachments/a/b', 'image/png', 42);
      INSERT INTO users VALUES ('user', 'icon', 'image/jpeg'), ('none', NULL, NULL);
    `,
    );
    assert.deepEqual(snapshotFiles(sql), [
      { r2_key: "attachments/a/b", content_type: "image/png", size: 42 },
      { r2_key: "avatars/user/icon", content_type: "image/jpeg", size: null },
    ]);
    writeFileSync(sql, "invalid SQL");
    assert.throws(() => snapshotFiles(sql), /SQL/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
