-- 利用者のアイコン画像（未設定なら NULL。R2 キーは avatars/<利用者ID>/<avatar_id>）
ALTER TABLE users ADD COLUMN avatar_id TEXT;
ALTER TABLE users ADD COLUMN avatar_type TEXT;
