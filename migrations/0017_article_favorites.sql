CREATE TABLE article_favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, article_id)
);
CREATE INDEX article_favorites_article ON article_favorites(article_id);
