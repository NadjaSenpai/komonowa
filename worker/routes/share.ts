import { Hono } from "hono";
import type { AppEnv } from "../env";
import { fail } from "../http";
import { attachmentResponse } from "./attachments";

/**
 * 外部共有された記事（/api/share 配下、ログイン不要）。共有 URL は /s/<token>。
 * 見せるのはタイトル・本文・最終更新日と、その記事の添付だけ。書いた人やタグは出さない。
 * 止めたらすぐ見えなくなるよう、どの応答も保存させない
 */
export const share = new Hono<AppEnv>();

const ROBOTS = "noindex, nofollow, noarchive, noai, noimageai";
const GONE = "共有が見つかりません。共有が止められたか、URL が違います";

share.use("*", async (c, next) => {
  await next();
  c.res.headers.set("x-robots-tag", ROBOTS);
  c.res.headers.set("cache-control", "no-store");
});

/** 共有中で、ごみ箱にない記事。理由を区別せず同じ 404 にする */
async function sharedArticle(db: D1Database, token: string) {
  if (token.length < 20 || token.length > 100) fail(404, GONE);
  const row = await db
    .prepare(
      `SELECT a.id, a.title, a.body, a.updated_at FROM article_shares s JOIN articles a ON a.id = s.article_id
        WHERE s.token = ? AND a.deleted_at IS NULL`,
    )
    .bind(token)
    .first<{ id: string; title: string; body: string; updated_at: number }>();
  if (!row) fail(404, GONE);
  return row;
}

share.get("/:token", async (c) => {
  const { title, body, updated_at } = await sharedArticle(c.env.DB, c.req.param("token"));
  return c.json({ article: { title, body, updated_at } });
});

share.get("/:token/attachments/:id", async (c) => {
  const article = await sharedArticle(c.env.DB, c.req.param("token"));
  const row = await c.env.DB.prepare("SELECT r2_key, filename, content_type FROM attachments WHERE id = ? AND article_id = ?")
    .bind(c.req.param("id"), article.id)
    .first<{ r2_key: string; filename: string; content_type: string }>();
  if (!row) fail(404, "ファイルが見つかりません");
  const object = await c.env.FILES.get(row.r2_key);
  if (!object) fail(404, "ファイルが見つかりません");
  return attachmentResponse(object, row, "no-store");
});
