-- 共有のパスワード（6 桁の数字の合言葉）。NULL ならパスワードなし。メンバーが見直せるようそのまま持つ（自動で作るので使い回しはない）
ALTER TABLE article_shares ADD COLUMN passcode TEXT;
-- 共有ページでパスワードを間違えた記録（総当たり対策。15 分に 5 回まで）
CREATE TABLE share_passcode_failures (
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX share_passcode_failures_article ON share_passcode_failures(article_id, created_at);
