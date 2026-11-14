-- 一覧に出す画像（本文で最初に出てくる、その記事の画像添付）。保存のたびに API が選び直す。なければ NULL。
-- 一覧のたびに全記事の本文を読んで探すのをやめるため、列に持つ
ALTER TABLE articles ADD COLUMN cover_id TEXT;

-- 既存の記事。SQL では ![...]( の形まで確かめられないので、「](添付の URL)」が最初に出てくる画像添付を選ぶ
-- （画像をリンクとして書いた場合も拾うが、次に保存したときに API の判定で直る）
UPDATE articles SET cover_id = (
  SELECT f.id FROM attachments f
   WHERE f.article_id = articles.id AND f.content_type LIKE 'image/%'
     AND instr(articles.body, '](/api/attachments/' || f.id || ')') > 0
   ORDER BY instr(articles.body, '](/api/attachments/' || f.id || ')') LIMIT 1
);
