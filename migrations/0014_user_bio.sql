-- 自己紹介（Markdown）。ユーザーページ（/users/<id>）に出す。退会・強制退会で消す
ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT '';
