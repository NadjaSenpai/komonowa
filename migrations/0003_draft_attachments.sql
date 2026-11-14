-- 記事の保存前に本文へ差し込んだ画像・ファイルを置けるよう、article_id を NULL 可にする。
-- NULL の行は「下書き添付」で、アップロードした本人だけが参照できる。記事の作成時にひもづけ、
-- 1日たっても使われなかったものは API が削除する。SQLite は列の制約を変えられないので作り直す。
PRAGMA defer_foreign_keys = true;

CREATE TABLE attachments_new (
  id TEXT PRIMARY KEY,
  article_id TEXT REFERENCES articles(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);

INSERT INTO attachments_new (id, article_id, r2_key, filename, content_type, size, uploaded_by, created_at)
  SELECT id, article_id, r2_key, filename, content_type, size, uploaded_by, created_at FROM attachments;

DROP TABLE attachments;
ALTER TABLE attachments_new RENAME TO attachments;

CREATE INDEX attachments_article ON attachments(article_id);
CREATE INDEX attachments_drafts ON attachments(created_at) WHERE article_id IS NULL;

PRAGMA defer_foreign_keys = false;
