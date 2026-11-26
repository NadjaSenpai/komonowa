import { type Context, Hono } from "hono";
import { searchExcerpt } from "../../shared/searchExcerpt";
import type { AppEnv } from "../env";
import { randomPasscode, randomToken } from "../crypto";
import { fail, int, isUniqueViolation, origin, readJson, str } from "../http";
import { requireAuth } from "../session";
import { extractWikiLinks, titleKey } from "../../shared/wikilinks";
import { firstVideoLine } from "../../shared/youtube";

export const articles = new Hono<AppEnv>();
articles.use("*", requireAuth);

const MAX_TAGS = 20;
const PAGE_SIZE = 30;
/** 記事の画面に出す「関連ページ」（2ホップ）の上限 */
const MAX_RELATED = 50;

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
    body: str(body, "body", { min: 0, max: 200_000, label: "本文", trim: false }),
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
  const clash = await db.prepare("SELECT 1 FROM articles WHERE title_key = ? AND deleted_at IS NULL AND id <> ?").bind(key, exceptId).first();
  if (clash) fail(409, message);
}

/** 事前の確認と書き込みの間に割り込まれ、一意インデックスに弾かれたときも同じ 409 にする */
async function batchGuardingTitle(db: D1Database, stmts: D1PreparedStatement[]) {
  try {
    return await db.batch(stmts);
  } catch (err) {
    if (isUniqueViolation(err, "title_key")) fail(409, DUPLICATE_TITLE);
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
  // 一覧に出す画像。本文で最初に出てくる、その記事に添付された画像（ほかの記事の添付や画像以外は飛ばす）。
  // 本文で使われている添付は消せないので（attachments.ts）、保存のときに選べば足りる
  // YouTube の動画の行が、そうした画像より先にあれば、動画のサムネイルを出す（cover_video。一覧では cover_id より優先）
  const matches = [...input.body.matchAll(IMAGE_ATTACHMENT)];
  const images = matches.map((m) => m[1]!);
  const video = firstVideoLine(input.body);
  const imagesBeforeVideo = video ? matches.filter((m) => m.index < video.index).map((m) => m[1]!) : [];
  stmts.push(
    db
      .prepare(
        `UPDATE articles SET cover_id = (
           SELECT f.id FROM json_each(?1) j JOIN attachments f ON f.id = j.value
            WHERE f.article_id = ?2 AND f.content_type LIKE 'image/%' ORDER BY j.key LIMIT 1),
           cover_video = (
           SELECT ?3 WHERE NOT EXISTS (
             SELECT 1 FROM json_each(?4) j JOIN attachments f ON f.id = j.value
              WHERE f.article_id = ?2 AND f.content_type LIKE 'image/%'))
          WHERE id = ?2 AND revision_id = ?5`,
      )
      .bind(JSON.stringify(images), articleId, video?.id ?? null, JSON.stringify(imagesBeforeVideo), revisionId),
  );
  return stmts;
}

const IMAGE_ATTACHMENT = /!\[[^\]]*\]\(\/api\/attachments\/([0-9a-f-]{36})\)/g;

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
  /** ピン留めした時刻。していなければ null */
  pinned_at: number | null;
}

async function loadArticle(db: D1Database, id: string) {
  const row = await db
    .prepare(
      `SELECT a.id, a.title, a.body, a.version, a.created_at, a.updated_at,
              a.created_by, cu.name AS created_by_name, cu.avatar_id AS created_by_avatar,
              a.updated_by, uu.name AS updated_by_name, uu.avatar_id AS updated_by_avatar, a.pinned_at, ${TAGS_JSON} AS tags
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
  // ピン留めした記事を先頭に出すのは、探しものをしていないときだけ（検索・タグの結果は更新の新しい順のまま）
  const favoritesOnly = c.req.query("favorite") === "1";
  const pinsFirst = q === "" && tags.length === 0 && !favoritesOnly;
  const where = ["a.deleted_at IS NULL"];
  const params: unknown[] = [];
  if (favoritesOnly) {
    where.push("EXISTS (SELECT 1 FROM article_favorites f WHERE f.article_id = a.id AND f.user_id = ?)");
    params.push(c.var.user.id);
  }
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
    `SELECT a.id, a.title, ${q ? "a.body" : "substr(a.body, 1, 400)"} AS excerpt, a.cover_id AS cover, a.cover_video, a.updated_at, a.updated_by, uu.name AS updated_by_name, uu.avatar_id AS updated_by_avatar,
            EXISTS (SELECT 1 FROM article_favorites f WHERE f.article_id = a.id AND f.user_id = ?) AS favorite,
            a.pinned_at IS NOT NULL AS pinned,
            ${TAGS_JSON} AS tags
       FROM articles a JOIN users uu ON uu.id = a.updated_by
      WHERE ${where.join(" AND ")}
      ORDER BY ${pinsFirst ? "a.pinned_at IS NULL, a.pinned_at DESC, " : ""}a.updated_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(c.var.user.id, ...params, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE)
    .all<{ id: string; tags: string; pinned: number; favorite: number; excerpt: string }>();
  return c.json({
    articles: results.slice(0, PAGE_SIZE).map((r) => ({
      ...r,
      excerpt: q ? searchExcerpt(r.excerpt, q.split(/\s+/).filter(Boolean).slice(0, 10)) : r.excerpt,
      tags: JSON.parse(r.tags) as string[],
      pinned: r.pinned === 1,
      favorite: r.favorite === 1,
    })),
    hasMore: results.length > PAGE_SIZE,
    page,
  });
});

const MAX_TITLE_SUGGESTIONS = 8;

/**
 * 編集画面で [[ と打ったときの候補。タイトルに q を含む記事を、更新の新しい順に返す（q が空なら最近の記事）。
 * 重複の判定と同じキーで比べるので、全角半角・大文字小文字の違いは気にしなくてよい
 */
articles.get("/titles", async (c) => {
  const key = titleKey((c.req.query("q") ?? "").slice(0, 200));
  const { results } = await c.env.DB.prepare(
    `SELECT title FROM articles WHERE deleted_at IS NULL AND title_key LIKE ? ESCAPE '\\'
      ORDER BY updated_at DESC LIMIT ?`,
  )
    .bind(`%${escapeLike(key)}%`, MAX_TITLE_SUGGESTIONS)
    .all<{ title: string }>();
  return c.json({ titles: results.map((r) => r.title) });
});

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
    // 下書き添付は、一覧に出す画像を選ぶ（writeStatements）より先にひもづける
    ...(attachmentIds.length > 0
      ? [
          c.env.DB.prepare(
            `UPDATE attachments SET article_id = ?
              WHERE article_id IS NULL AND uploaded_by = ? AND id IN (${attachmentIds.map(() => "?").join(", ")})`,
          ).bind(id, userId, ...attachmentIds),
        ]
      : []),
    ...writeStatements(c.env.DB, id, revisionId, 1, input, "create", userId, now),
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
  const favorite = !!(await c.env.DB.prepare("SELECT 1 FROM article_favorites WHERE user_id = ? AND article_id = ?").bind(c.var.user.id, article.id).first());
  const [attachments, links, backlinks, related] = await c.env.DB.batch([
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
    // 2ホップ：この記事と同じリンク先を持つ記事。via は共通のリンク先（記事があればそのタイトル、まだなければリンクのキー）
    c.env.DB.prepare(
      `SELECT a.id, a.title, a.updated_at, COALESCE(t.title, l1.target_key) AS via
         FROM article_links l1
         JOIN article_links l2 ON l2.target_key = l1.target_key AND l2.source_id <> l1.source_id
         JOIN articles a ON a.id = l2.source_id AND a.deleted_at IS NULL
         LEFT JOIN articles t ON t.title_key = l1.target_key AND t.deleted_at IS NULL
        WHERE l1.source_id = ?
        ORDER BY via, a.updated_at DESC, a.rowid DESC LIMIT ?`,
    ).bind(article.id, MAX_RELATED),
  ]);
  return c.json({
    article,
    attachments: attachments!.results,
    links: links!.results,
    backlinks: backlinks!.results,
    related: related!.results,
    share: await findShare(c.env.DB, article.id, origin(c)),
    favorite,
  });
});

async function update(c: Context<AppEnv>, id: string, baseVersion: number, input: { title: string; body: string; tags: string[] }, action: "edit" | "restore") {
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

articles.post("/:id/favorite", async (c) => {
  const id = c.req.param("id");
  const result = await c.env.DB.prepare(
    `INSERT INTO article_favorites (user_id, article_id, created_at)
     SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM articles WHERE id = ? AND deleted_at IS NULL)
     ON CONFLICT (user_id, article_id) DO UPDATE SET created_at = article_favorites.created_at`,
  )
    .bind(c.var.user.id, id, Date.now(), id)
    .run();
  if (!result.meta.changes) fail(404, "記事が見つかりません");
  return c.json({ favorite: true });
});

articles.delete("/:id/favorite", async (c) => {
  await c.env.DB.prepare("DELETE FROM article_favorites WHERE user_id = ? AND article_id = ?").bind(c.var.user.id, c.req.param("id")).run();
  return c.json({ favorite: false });
});

articles.put("/:id", async (c) => {
  const body = await readJson(c);
  const input = readArticleInput(body);
  return update(c, c.req.param("id"), int(body, "baseVersion", "版番号"), input, "edit");
});

articles.delete("/:id", async (c) => {
  const id = c.req.param("id");
  // ごみ箱に入れたら共有も止める（戻したときに、忘れていた共有が勝手に再開しないように）
  const [res] = await c.env.DB.batch([
    // ピン留めも外す（戻したときに、忘れていたピン留めが一覧の先頭に戻らないように）
    c.env.DB.prepare("UPDATE articles SET deleted_at = ?, deleted_by = ?, pinned_at = NULL WHERE id = ? AND deleted_at IS NULL").bind(
      Date.now(),
      c.var.user.id,
      id,
    ),
    c.env.DB.prepare("DELETE FROM article_shares WHERE article_id = ? AND EXISTS (SELECT 1 FROM articles WHERE id = ? AND deleted_at IS NOT NULL)").bind(
      id,
      id,
    ),
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
  return row ? { url: `${origin}/s/${row.token}`, passcode: row.passcode, created_at: row.created_at, created_by_name: row.created_by_name } : null;
}

/** ピン留めする。メンバーなら誰でも、どの記事でも。版や更新日時は変えない。すでにピン留め中なら、付けた時刻はそのまま */
articles.post("/:id/pin", async (c) => {
  const res = await c.env.DB.prepare("UPDATE articles SET pinned_at = COALESCE(pinned_at, ?) WHERE id = ? AND deleted_at IS NULL")
    .bind(Date.now(), c.req.param("id"))
    .run();
  if (res.meta.changes === 0) fail(404, "記事が見つかりません");
  return c.json({ pinned: true });
});

/** ピン留めを外す */
articles.delete("/:id/pin", async (c) => {
  const res = await c.env.DB.prepare("UPDATE articles SET pinned_at = NULL WHERE id = ? AND deleted_at IS NULL").bind(c.req.param("id")).run();
  if (res.meta.changes === 0) fail(404, "記事が見つかりません");
  return c.json({ pinned: false });
});

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
  const share = await findShare(c.env.DB, id, origin(c));
  if (!share || !(await c.env.DB.prepare("SELECT 1 FROM articles WHERE id = ? AND deleted_at IS NULL").bind(id).first())) {
    fail(404, "記事が見つかりません");
  }
  return c.json({ share }, res.meta.changes > 0 ? 201 : 200);
});

/** 共有のパスワード（6 桁）を付ける・作り直す。前に入れた人も入れ直しになり、間違いの記録も消す */
articles.post("/:id/share/passcode", async (c) => {
  const id = c.req.param("id");
  const [res] = await c.env.DB.batch([
    // 鍵も作り直す（前に入れた人は入れ直し）。鍵は乱数なので、URL とパスワードから計算できない
    c.env.DB.prepare("UPDATE article_shares SET passcode = ?, passcode_key = ? WHERE article_id = ?").bind(randomPasscode(), randomToken(), id),
    c.env.DB.prepare("DELETE FROM share_passcode_failures WHERE article_id = ?").bind(id),
  ]);
  if (res!.meta.changes === 0) fail(404, "共有されていません");
  return c.json({ share: await findShare(c.env.DB, id, origin(c)) });
});

/** パスワードを外す。URL を知っている人は誰でも読めるようになる */
articles.delete("/:id/share/passcode", async (c) => {
  const id = c.req.param("id");
  const res = await c.env.DB.prepare("UPDATE article_shares SET passcode = NULL, passcode_key = NULL WHERE article_id = ?").bind(id).run();
  if (res.meta.changes === 0) fail(404, "共有されていません");
  return c.json({ share: await findShare(c.env.DB, id, origin(c)) });
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
