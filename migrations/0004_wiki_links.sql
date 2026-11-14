-- ページ間リンク（docs/superpowers/specs/2026-11-14-wiki-links-design.md）
-- title_key はタイトルの正規化キー（trim → NFKC → 空白をまとめる → 小文字。計算は API 側）。
-- ごみ箱の記事はタイトルを確保しないので、一意性は deleted_at IS NULL の行だけで見る。
-- 既存の行は lower(trim(title)) で埋める（適用時点で記事はなく、念のための初期値）。
ALTER TABLE articles ADD COLUMN title_key TEXT NOT NULL DEFAULT '';
UPDATE articles SET title_key = lower(trim(title));
CREATE UNIQUE INDEX articles_title_key ON articles(title_key) WHERE deleted_at IS NULL;

-- 本文中の [[タイトル]] のリンク先（正規化キー）。保存のたびに書き直す
CREATE TABLE article_links (
  source_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  target_key TEXT NOT NULL,
  PRIMARY KEY (source_id, target_key)
);
CREATE INDEX article_links_target ON article_links(target_key);
