-- 退会・強制退会。利用者の行は記事や履歴から参照されているので消さず、名前・メールアドレス・アイコン・パスワードを消す（匿名化）
ALTER TABLE users ADD COLUMN deleted_at INTEGER;
-- 強制退会したメールアドレス（小文字にしてからの SHA-256 だけ。アドレスそのものは残さない）。招待とメールアドレスの変更先に使えない
CREATE TABLE blocked_emails (
  email_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
