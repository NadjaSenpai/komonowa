-- 所有者（docs/superpowers/specs/2026-11-14-owner-design.md）
-- ほかの管理者から権限変更・無効化されない管理者。1人だけ。既存データでは最初に作られた管理者を所有者にする
ALTER TABLE users ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0 CHECK (is_owner IN (0, 1));
UPDATE users SET is_owner = 1
 WHERE id = (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at, rowid LIMIT 1);
CREATE UNIQUE INDEX users_owner ON users(is_owner) WHERE is_owner = 1;
