-- ピン留め。付けた時刻を持ち、NULL ならピン留めなし。一覧の先頭に、新しく付けた順で出す
ALTER TABLE articles ADD COLUMN pinned_at INTEGER;
