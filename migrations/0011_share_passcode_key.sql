-- 共有パスワードを入れた人に渡す鍵。パスワードを付けるたびにサーバーが乱数で作る（URL とパスワードから計算できないように）。
-- 既にパスワードの付いた共有にも新しい鍵を作る（前に入れた人は入れ直しになる）
ALTER TABLE article_shares ADD COLUMN passcode_key TEXT;
UPDATE article_shares SET passcode_key = lower(hex(randomblob(32))) WHERE passcode IS NOT NULL;
