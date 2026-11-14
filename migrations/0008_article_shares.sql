-- 記事の外部共有。共有中の記事ごとに 1 行。止めたら行を消す（URL はすぐ無効になる）。
-- token は共有 URL（/s/<token>）の一部。共有中にメンバーが URL を見直せるよう、ハッシュにせずそのまま持つ
CREATE TABLE article_shares (
  article_id TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);
