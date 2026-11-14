import { type Context, Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { safeStringEqual, sha256 } from "../crypto";
import type { AppEnv } from "../env";
import { fail, readJson } from "../http";
import { attachmentResponse } from "./attachments";

/**
 * 外部共有された記事（/api/share 配下、ログイン不要）。共有 URL は /s/<token>。
 * 見せるのはタイトル・本文・最終更新日と、その記事の添付だけ。書いた人やタグは出さない。
 * 止めたらすぐ見えなくなるよう、どの応答も保存させない。
 * パスワード付きの共有は、unlock で受け取った鍵のクッキーがないと 403（401 だとログイン中のメンバーの画面がログアウト扱いになる）
 */
export const share = new Hono<AppEnv>();

const ROBOTS = "noindex, nofollow, noarchive, noai, noimageai";
const GONE = "共有が見つかりません。共有が止められたか、URL が違います";
const KEY_COOKIE = "share_key";
const KEY_MAX_AGE = 30 * 24 * 60 * 60;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

share.use("*", async (c, next) => {
  await next();
  c.res.headers.set("x-robots-tag", ROBOTS);
  c.res.headers.set("cache-control", "no-store");
});

interface SharedRow {
  id: string;
  title: string;
  body: string;
  updated_at: number;
  passcode: string | null;
}

/** 共有中で、ごみ箱にない記事。理由を区別せず同じ 404 にする */
async function sharedArticle(db: D1Database, token: string) {
  if (token.length < 20 || token.length > 100) fail(404, GONE);
  const row = await db
    .prepare(
      `SELECT a.id, a.title, a.body, a.updated_at, s.passcode FROM article_shares s JOIN articles a ON a.id = s.article_id
        WHERE s.token = ? AND a.deleted_at IS NULL`,
    )
    .bind(token)
    .first<SharedRow>();
  if (!row) fail(404, GONE);
  return row;
}

/** 鍵の値。パスワードを作り直すと合わなくなるので、サーバーに覚えておく必要がない */
const keyOf = (token: string, passcode: string) => sha256(`${token}:${passcode}`);

function needsPasscode(c: Context<AppEnv>, error: string) {
  return c.json({ error, needsPasscode: true }, 403);
}

/** パスワード付きなら鍵を確かめる。読んでよい記事を返す */
async function readable(c: Context<AppEnv>) {
  const token = c.req.param("token")!;
  const row = await sharedArticle(c.env.DB, token);
  if (row.passcode === null) return { row };
  const key = getCookie(c, KEY_COOKIE) ?? "";
  if (await safeStringEqual(key, await keyOf(token, row.passcode))) return { row };
  return { denied: needsPasscode(c, "パスワードを入れてください") };
}

share.get("/:token", async (c) => {
  const { row, denied } = await readable(c);
  if (denied) return denied;
  return c.json({ article: { title: row.title, body: row.body, updated_at: row.updated_at } });
});

share.post("/:token/unlock", async (c) => {
  const token = c.req.param("token");
  const row = await sharedArticle(c.env.DB, token);
  if (row.passcode === null) return c.json({ ok: true });
  const body = await readJson(c);
  const given = typeof body.passcode === "string" ? body.passcode.trim() : "";
  const now = Date.now();
  // 当て続けて最後に正解、を防ぐため、正しいパスワードでも先に回数を見る
  const failures = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM share_passcode_failures WHERE article_id = ? AND created_at > ?")
    .bind(row.id, now - FAILURE_WINDOW_MS)
    .first<number>("n");
  if ((failures ?? 0) >= MAX_FAILURES) fail(429, "間違いが続いたため、15分ほど待ってからもう一度試してください");
  if (!(await safeStringEqual(given, row.passcode))) {
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO share_passcode_failures (article_id, created_at) VALUES (?, ?)").bind(row.id, now),
      c.env.DB.prepare("DELETE FROM share_passcode_failures WHERE created_at < ?").bind(now - FAILURE_WINDOW_MS),
    ]);
    return needsPasscode(c, "パスワードが違います");
  }
  await c.env.DB.prepare("DELETE FROM share_passcode_failures WHERE article_id = ?").bind(row.id).run();
  setCookie(c, KEY_COOKIE, await keyOf(token, row.passcode), {
    path: `/api/share/${token}`,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: KEY_MAX_AGE,
  });
  return c.json({ ok: true });
});

share.get("/:token/attachments/:id", async (c) => {
  const { row: article, denied } = await readable(c);
  if (denied) return denied;
  const row = await c.env.DB.prepare("SELECT r2_key, filename, content_type FROM attachments WHERE id = ? AND article_id = ?")
    .bind(c.req.param("id"), article.id)
    .first<{ r2_key: string; filename: string; content_type: string }>();
  if (!row) fail(404, "ファイルが見つかりません");
  const object = await c.env.FILES.get(row.r2_key);
  if (!object) fail(404, "ファイルが見つかりません");
  return attachmentResponse(object, row, "no-store");
});
