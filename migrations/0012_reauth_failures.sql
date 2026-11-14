-- メール変更・パスワード変更・退会で共通の再認証試行制限。通常のログインとは別に数える
CREATE TABLE reauth_failures (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX reauth_failures_user_time ON reauth_failures(user_id, created_at);
