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
