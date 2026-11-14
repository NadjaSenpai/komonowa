import { Hono } from "hono";
import type { AppEnv } from "../env";
import { randomPasscode, randomToken } from "../crypto";
import { fail, int, readJson, str } from "../http";
import { requireAuth } from "../session";
import { extractWikiLinks, titleKey } from "../../shared/wikilinks";

export const articles = new Hono<AppEnv>();
articles.use("*", requireAuth);

const MAX_TAGS = 20;
const PAGE_SIZE = 30;

export function normalizeTags(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(400, "タグの形式が正しくありません");
  const seen = new Map<string, string>();
  for (const raw of value) {
    if (typeof raw !== "string") fail(400, "タグの形式が正しくありません");
    const name = raw.trim().normalize("NFKC");
    if (!name) continue;
    if (name.length > 40) fail(400, "タグは40文字以内にしてください");
    if (name.includes(",")) fail(400, "タグ名にカンマは使えません");
    if (!seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  }
  if (seen.size > MAX_TAGS) fail(400, `タグは${MAX_TAGS}個までです`);
  return [...seen.values()];
}

function readTitle(body: Record<string, unknown>): string {
  const title = str(body, "title", { max: 200, label: "タイトル" });
  // [[ ]] の中に [ ] を書けないので、半角の [ ] を含むタイトルはリンクできなくなる。全角の［］はリンクできる
  if (/[[\]]/.test(title)) fail(400, "タイトルに [ ] は使えません。［ ］（全角）なら使えます");
  return title;
}

function readArticleInput(body: Record<string, unknown>) {
  return {
    title: readTitle(body),
    body: str(body, "body", { min: 0, max: 200_000, label: "本文" }),
    tags: normalizeTags(body.tags),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 新規作成時にひもづける下書き添付の ID（本人がアップロードした、まだ記事のないものだけが対象） */
function readAttachmentIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50 || !value.every((v) => typeof v === "string" && UUID_RE.test(v))) {
    fail(400, "添付の指定が正しくありません");
  }
  return [...new Set(value as string[])];
}

const DUPLICATE_TITLE = "同じタイトルの記事がすでにあります";

/** ごみ箱にない、ほかの記事が同じタイトルキーを使っていれば 409 */
export async function assertTitleFree(db: D1Database, key: string, exceptId: string, message = DUPLICATE_TITLE) {
  const clash = await db
    .prepare("SELECT 1 FROM articles WHERE title_key = ? AND deleted_at IS NULL AND id <> ?")
    .bind(key, exceptId)
    .first();
  if (clash) fail(409, message);
}

/** 事前の確認と書き込みの間に割り込まれ、一意インデックスに弾かれたときも同じ 409 にする */
async function batchGuardingTitle(db: D1Database, stmts: D1PreparedStatement[]) {
  try {
    return await db.batch(stmts);
  } catch (err) {
    if (err instanceof Error && err.message.includes("UNIQUE constraint failed") && err.message.includes("title_key")) {
      fail(409, DUPLICATE_TITLE);
    }
    throw err;
  }
}

function escapeLike(term: string) {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * 記事本体の更新と、履歴・タグの書き込みを 1 つのトランザクションで行う。
 * 後続の文は「articles.revision_id が今回の版になっていること」を条件にしているので、
 * 先頭の UPDATE が競合で 0 件になった場合は何も書き込まれない。
 */
function writeStatements(
  db: D1Database,
  articleId: string,
  revisionId: string,
  version: number,
  input: { title: string; body: string; tags: string[] },
  action: "create" | "edit" | "restore",
  userId: string,
  now: number,
) {
  const guard = "EXISTS (SELECT 1 FROM articles WHERE id = ? AND revision_id = ?)";
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO revisions (id, article_id, version, title, body, tags, action, edited_by, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard}`,
      )
      .bind(revisionId, articleId, version, input.title, input.body, JSON.stringify(input.tags), action, userId, now, articleId, revisionId),
    db.prepare(`DELETE FROM article_tags WHERE article_id = ? AND ${guard}`).bind(articleId, articleId, revisionId),
    // 本文の [[タイトル]] を書き直す。リンクの数によらず1文で済むよう JSON 配列で渡す
    db.prepare(`DELETE FROM article_links WHERE source_id = ? AND ${guard}`).bind(articleId, articleId, revisionId),
    db
      .prepare(`INSERT OR IGNORE INTO article_links (source_id, target_key) SELECT ?, value FROM json_each(?) WHERE ${guard}`)
      .bind(articleId, JSON.stringify(extractWikiLinks(input.body).map(titleKey)), articleId, revisionId),
  ];
  for (const tag of input.tags) {
    stmts.push(
      db.prepare(`INSERT OR IGNORE INTO tags (id, name) SELECT ?, ? WHERE ${guard}`).bind(crypto.randomUUID(), tag, articleId, revisionId),
      db
        .prepare(`INSERT OR IGNORE INTO article_tags (article_id, tag_id) SELECT ?, id FROM tags WHERE name = ? AND ${guard}`)
        .bind(articleId, tag, articleId, revisionId),
    );
  }
  return stmts;
}

const TAGS_JSON = `(SELECT json_group_array(t.name) FROM article_tags at JOIN tags t ON t.id = at.tag_id WHERE at.article_id = a.id)`;

interface ArticleRow {
  id: string;
  title: string;
  body: string;
  version: number;
  tags: string;
  created_at: number;
  updated_at: number;
  created_by: string;
  created_by_name: string;
  created_by_avatar: string | null;
  updated_by: string;
  updated_by_name: string;
  updated_by_avatar: string | null;
}

async function loadArticle(db: D1Database, id: string) {
  const row = await db
    .prepare(
      `SELECT a.id, a.title, a.body, a.version, a.created_at, a.updated_at,
              a.created_by, cu.name AS created_by_name, cu.avatar_id AS created_by_avatar,
              a.updated_by, uu.name AS updated_by_name, uu.avatar_id AS updated_by_avatar, ${TAGS_JSON} AS tags
         FROM articles a JOIN users cu ON cu.id = a.created_by JOIN users uu ON uu.id = a.updated_by
        WHERE a.id = ? AND a.deleted_at IS NULL`,
    )
    .bind(id)
    .first<ArticleRow>();
  if (!row) return null;
  return { ...row, tags: (JSON.parse(row.tags) as string[]).sort() };
}

// 一覧・検索。q は空白区切りの AND 検索、tags は複数指定で AND 絞り込み
articles.get("/", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 200);
  const tags = normalizeTags(c.req.queries("tag") ?? []);
  const page = Math.max(1, Math.min(1000, Number(c.req.query("page")) || 1));
  const where = ["a.deleted_at IS NULL"];
  const params: unknown[] = [];
  for (const term of q.split(/\s+/).filter(Boolean).slice(0, 10)) {
    where.push("(a.title LIKE ? ESCAPE '\\' OR a.body LIKE ? ESCAPE '\\')");
    const like = `%${escapeLike(term)}%`;
    params.push(like, like);
  }
  if (tags.length > 0) {
    where.push(
      `a.id IN (SELECT at.article_id FROM article_tags at JOIN tags t ON t.id = at.tag_id
                 WHERE t.name IN (${tags.map(() => "?").join(", ")})
                 GROUP BY at.article_id HAVING COUNT(DISTINCT t.id) = ?)`,
    );
    params.push(...tags, tags.length);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.title, substr(a.body, 1, 160) AS excerpt, a.body, a.updated_at, a.updated_by, uu.name AS updated_by_name, uu.avatar_id AS updated_by_avatar,
            ${TAGS_JSON} AS tags
       FROM articles a JOIN users uu ON uu.id = a.updated_by
      WHERE ${where.join(" AND ")}
      ORDER BY a.updated_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...params, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE)
    .all<{ id: string; body: string; tags: string }>();
  const shown = results.slice(0, PAGE_SIZE);
  const covers = await findCovers(c.env.DB, shown);
  return c.json({
    articles: shown.map(({ body: _body, ...r }) => ({ ...r, tags: JSON.parse(r.tags) as string[], cover: covers.get(r.id) ?? null })),
    hasMore: results.length > PAGE_SIZE,
    page,
  });
});

const IMAGE_ATTACHMENT = /!\[[^\]]*\]\(\/api\/attachments\/([0-9a-f-]{36})\)/g;

/**
 * 一覧に出す画像。本文で最初に出てくる、その記事に添付された画像。
 * 保存時に決めておくと、編集・復元・添付の削除のたびに直す必要があるので、一覧を返すときに本文から探す
 */
async function findCovers(db: D1Database, rows: { id: string; body: string }[]) {
  const candidates = new Map(rows.map((r) => [r.id, [...r.body.matchAll(IMAGE_ATTACHMENT)].map((m) => m[1]!)]));
  const ids = [...new Set([...candidates.values()].flat())];
  const covers = new Map<string, string>();
  if (ids.length === 0) return covers;
  const { results } = await db
    .prepare(`SELECT id, article_id FROM attachments WHERE content_type LIKE 'image/%' AND id IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(ids))
    .all<{ id: string; article_id: string | null }>();
  const owner = new Map(results.map((r) => [r.id, r.article_id]));
  for (const [articleId, list] of candidates) {
    const first = list.find((id) => owner.get(id) === articleId);
    if (first) covers.set(articleId, first);
  }
  return covers;
}

articles.get("/tags", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.name, COUNT(a.id) AS count
       FROM tags t
       LEFT JOIN article_tags at ON at.tag_id = t.id
       LEFT JOIN articles a ON a.id = at.article_id AND a.deleted_at IS NULL
      GROUP BY t.id ORDER BY t.name`,
  ).all();
  return c.json({ tags: results });
});

articles.post("/", async (c) => {
  const body = await readJson(c);
  const input = readArticleInput(body);
  const attachmentIds = readAttachmentIds(body.attachmentIds);
  const id = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const now = Date.now();
  const userId = c.var.user.id;
  const key = titleKey(input.title);
  await assertTitleFree(c.env.DB, key, id);
  await batchGuardingTitle(c.env.DB, [
    c.env.DB.prepare(
      `INSERT INTO articles (id, title, title_key, body, version, revision_id, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    ).bind(id, input.title, key, input.body, revisionId, userId, userId, now, now),
    ...writeStatements(c.env.DB, id, revisionId, 1, input, "create", userId, now),
    ...(attachmentIds.length > 0
      ? [
          c.env.DB.prepare(
            `UPDATE attachments SET article_id = ?
              WHERE article_id IS NULL AND uploaded_by = ? AND id IN (${attachmentIds.map(() => "?").join(", ")})`,
          ).bind(id, userId, ...attachmentIds),
        ]
      : []),
  ]);
  return c.json({ article: await loadArticle(c.env.DB, id) }, 201);
});

// [[タイトル]] の行き先。/:id より前に登録する
articles.get("/by-title/:title", async (c) => {
  const row = await c.env.DB.prepare("SELECT id FROM articles WHERE title_key = ? AND deleted_at IS NULL")
    .bind(titleKey(c.req.param("title")))
    .first<{ id: string }>();
  if (!row) fail(404, "記事が見つかりません");
  return c.json({ id: row.id });
});

articles.get("/:id", async (c) => {
  const article = await loadArticle(c.env.DB, c.req.param("id"));
  if (!article) fail(404, "記事が見つかりません");
  const [attachments, links, backlinks] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT f.id, f.filename, f.content_type, f.size, f.created_at, u.name AS uploaded_by_name, f.uploaded_by
         FROM attachments f JOIN users u ON u.id = f.uploaded_by WHERE f.article_id = ? ORDER BY f.created_at`,
    ).bind(article.id),
    // 本文のリンク先と、その記事があれば ID（なければ null で「まだない記事」）
    c.env.DB.prepare(
      `SELECT l.target_key AS key, a.id FROM article_links l
         LEFT JOIN articles a ON a.title_key = l.target_key AND a.deleted_at IS NULL
        WHERE l.source_id = ?`,
    ).bind(article.id),
    // この記事にリンクしている記事（自分とごみ箱を除く）
    c.env.DB.prepare(
      `SELECT a.id, a.title, a.updated_at FROM article_links l JOIN articles a ON a.id = l.source_id
        WHERE l.target_key = (SELECT title_key FROM articles WHERE id = ?) AND a.deleted_at IS NULL AND a.id <> ?
        ORDER BY a.updated_at DESC, a.rowid DESC`,
    ).bind(article.id, article.id),
  ]);
  return c.json({
    article,
    attachments: attachments!.results,
    links: links!.results,
    backlinks: backlinks!.results,
    share: await findShare(c.env.DB, article.id, new URL(c.req.url).origin),
  });
});

async function update(
  c: import("hono").Context<AppEnv>,
  id: string,
  baseVersion: number,
  input: { title: string; body: string; tags: string[] },
  action: "edit" | "restore",
) {
  const revisionId = crypto.randomUUID();
  const now = Date.now();
  const userId = c.var.user.id;
  const key = titleKey(input.title);
  await assertTitleFree(c.env.DB, key, id);
  const results = await batchGuardingTitle(c.env.DB, [
    c.env.DB.prepare(
      `UPDATE articles SET title = ?, title_key = ?, body = ?, version = version + 1, revision_id = ?, updated_by = ?, updated_at = ?
        WHERE id = ? AND version = ? AND deleted_at IS NULL`,
    ).bind(input.title, key, input.body, revisionId, userId, now, id, baseVersion),
    ...writeStatements(c.env.DB, id, revisionId, baseVersion + 1, input, action, userId, now),
  ]);
  if (!results[0]?.meta.changes) {
    const current = await loadArticle(c.env.DB, id);
    if (!current) fail(404, "記事が見つかりません");
    fail(409, "ほかの人が先にこの記事を更新しました。最新の内容を確認してから保存し直してください", { current });
  }
  return c.json({ article: await loadArticle(c.env.DB, id) });
}

articles.put("/:id", async (c) => {
  const body = await readJson(c);
  const input = readArticleInput(body);
  return update(c, c.req.param("id"), int(body, "baseVersion", "版番号"), input, "edit");
});

articles.delete("/:id", async (c) => {
  const id = c.req.param("id");
  // ごみ箱に入れたら共有も止める（戻したときに、忘れていた共有が勝手に再開しないように）
  const [res] = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE articles SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL").bind(Date.now(), c.var.user.id, id),
    c.env.DB.prepare("DELETE FROM article_shares WHERE article_id = ? AND EXISTS (SELECT 1 FROM articles WHERE id = ? AND deleted_at IS NOT NULL)").bind(id, id),
  ]);
  if (res!.meta.changes === 0) fail(404, "記事が見つかりません");
  return c.json({ ok: true });
});

/** 共有中なら共有 URL と始めた人。共有ページは /s/<token>（worker/routes/share.ts） */
async function findShare(db: D1Database, articleId: string, origin: string) {
  const row = await db
    .prepare(
      `SELECT s.token, s.passcode, s.created_at, u.name AS created_by_name FROM article_shares s JOIN users u ON u.id = s.created_by WHERE s.article_id = ?`,
    )
    .bind(articleId)
    .first<{ token: string; passcode: string | null; created_at: number; created_by_name: string }>();
  return row
    ? { url: `${origin}/s/${row.token}`, passcode: row.passcode, created_at: row.created_at, created_by_name: row.created_by_name }
    : null;
}

/** 共有を始める。メンバーなら誰でも、どの記事でも。すでに共有中ならその共有を返す */
articles.post("/:id/share", async (c) => {
  const id = c.req.param("id");
  const res = await c.env.DB.prepare(
    `INSERT INTO article_shares (article_id, token, created_by, created_at)
     SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM articles WHERE id = ? AND deleted_at IS NULL)
     ON CONFLICT (article_id) DO NOTHING`,
  )
    .bind(id, randomToken(), c.var.user.id, Date.now(), id)
    .run();
  const share = await findShare(c.env.DB, id, new URL(c.req.url).origin);
  if (!share || !(await c.env.DB.prepare("SELECT 1 FROM articles WHERE id = ? AND deleted_at IS NULL").bind(id).first())) {
    fail(404, "記事が見つかりません");
  }
  return c.json({ share }, res.meta.changes > 0 ? 201 : 200);
});

/** 共有のパスワード（6 桁）を付ける・作り直す。前に入れた人も入れ直しになり、間違いの記録も消す */
articles.post("/:id/share/passcode", async (c) => {
  const id = c.req.param("id");
  const [res] = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE article_shares SET passcode = ? WHERE article_id = ?").bind(randomPasscode(), id),
    c.env.DB.prepare("DELETE FROM share_passcode_failures WHERE article_id = ?").bind(id),
  ]);
  if (res!.meta.changes === 0) fail(404, "共有されていません");
  return c.json({ share: await findShare(c.env.DB, id, new URL(c.req.url).origin) });
});

/** パスワードを外す。URL を知っている人は誰でも読めるようになる */
articles.delete("/:id/share/passcode", async (c) => {
  const id = c.req.param("id");
  const res = await c.env.DB.prepare("UPDATE article_shares SET passcode = NULL WHERE article_id = ?").bind(id).run();
  if (res.meta.changes === 0) fail(404, "共有されていません");
  return c.json({ share: await findShare(c.env.DB, id, new URL(c.req.url).origin) });
});

/** 共有を止める。行を消すので、その URL はすぐ見えなくなる */
articles.delete("/:id/share", async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM article_shares WHERE article_id = ?").bind(c.req.param("id")).run();
  if (res.meta.changes === 0) fail(404, "共有されていません");
  return c.json({ ok: true });
});

articles.get("/:id/revisions", async (c) => {
  const id = c.req.param("id");
  const exists = await c.env.DB.prepare("SELECT 1 FROM articles WHERE id = ? AND deleted_at IS NULL").bind(id).first();
  if (!exists) fail(404, "記事が見つかりません");
  const { results } = await c.env.DB.prepare(
    `SELECT r.version, r.title, r.action, r.created_at, r.edited_by, u.name AS edited_by_name, u.avatar_id AS edited_by_avatar
       FROM revisions r JOIN users u ON u.id = r.edited_by WHERE r.article_id = ? ORDER BY r.version DESC`,
  )
    .bind(id)
    .all();
  return c.json({ revisions: results });
});

async function loadRevision(db: D1Database, id: string, version: number) {
  const row = await db
    .prepare(
      `SELECT r.version, r.title, r.body, r.tags, r.action, r.created_at, r.edited_by, u.name AS edited_by_name, u.avatar_id AS edited_by_avatar
         FROM revisions r JOIN articles a ON a.id = r.article_id JOIN users u ON u.id = r.edited_by
        WHERE r.article_id = ? AND r.version = ? AND a.deleted_at IS NULL`,
    )
    .bind(id, version)
    .first<{ title: string; body: string; tags: string }>();
  if (!row) fail(404, "版が見つかりません");
  return { ...row, tags: JSON.parse(row.tags) as string[] };
}

articles.get("/:id/revisions/:version", async (c) => {
  const revision = await loadRevision(c.env.DB, c.req.param("id"), Number(c.req.param("version")));
  return c.json({ revision });
});

articles.post("/:id/revisions/:version/restore", async (c) => {
  const body = await readJson(c);
  const id = c.req.param("id");
  const revision = await loadRevision(c.env.DB, id, Number(c.req.param("version")));
  return update(c, id, int(body, "baseVersion", "版番号"), { title: revision.title, body: revision.body, tags: revision.tags }, "restore");
});
