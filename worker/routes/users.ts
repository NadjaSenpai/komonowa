import { Hono } from "hono";
import type { AppEnv } from "../env";
import { fail } from "../http";
import { requireAuth } from "../session";

/** ユーザーページに出す記事の上限 */
const MAX_ARTICLES = 100;

/**
 * ユーザーページ（/api/users 配下）。メンバーなら誰のページでも見られる。
 * 出すのは名前・アイコン・自己紹介と、その人が作成した記事。メールアドレス・権限・状態は出さない。
 * 無効化・退会した人のページも残る（記事の作成者として名前が出ているので、行き先がなくならないように）
 */
export const users = new Hono<AppEnv>();
users.use("*", requireAuth);

/**
 * メンバー一覧。いまログインできる人だけを、登録の古い順に出す（無効化・退会した人は出さないが、個別のページは残る）。
 * 自己紹介は一覧で冒頭を見せる分だけ返す
 */
users.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.avatar_id, substr(u.bio, 1, 300) AS bio,
            (SELECT COUNT(*) FROM articles a WHERE a.created_by = u.id AND a.deleted_at IS NULL) AS article_count
       FROM users u WHERE u.status = 'active' AND u.deleted_at IS NULL
      ORDER BY u.created_at, u.rowid`,
  ).all();
  return c.json({ users: results });
});

users.get("/:id", async (c) => {
  const id = c.req.param("id");
  const [user, articles] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT id, name, avatar_id, bio, created_at FROM users WHERE id = ?").bind(id),
    c.env.DB.prepare(
      `SELECT id, title, updated_at FROM articles WHERE created_by = ? AND deleted_at IS NULL
        ORDER BY updated_at DESC, rowid DESC LIMIT ?`,
    ).bind(id, MAX_ARTICLES),
  ]);
  if (!user!.results[0]) fail(404, "利用者が見つかりません");
  return c.json({ user: user!.results[0], articles: articles!.results });
});
