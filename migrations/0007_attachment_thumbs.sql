-- 一覧に出す添付画像の小さい版（ブラウザがアップロード時に作る）。R2 のキーは元のキー + ".thumb"。古い添付は NULL
ALTER TABLE attachments ADD COLUMN thumb_key TEXT;
