-- メールアドレスの変更（docs/superpowers/specs/2026-11-14-email-change-design.md）
-- 本人が申し込み、新しいアドレスに届いたリンク（トークンは SHA-256 ハッシュのみ保存）で確定する
CREATE TABLE email_changes (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  new_email TEXT NOT NULL COLLATE NOCASE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX email_changes_user ON email_changes(user_id);
