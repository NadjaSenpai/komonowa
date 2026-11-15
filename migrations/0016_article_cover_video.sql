-- 一覧に出すサムネイルが YouTube の動画のとき、その動画 ID。本文で、その記事の画像添付より先に動画の行があるときだけ入る。
-- 保存のたびに API が選び直す。入っていれば cover_id より優先して一覧に出す。
-- 既存の記事にはさかのぼって入れない（保存し直すと入る）
ALTER TABLE articles ADD COLUMN cover_video TEXT;
