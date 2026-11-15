import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import { fail } from "../http";
import { requireAuth } from "../session";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** 一覧に出す小さい版（長辺 400px の WebP。作れないブラウザでは JPEG）の上限 */
export const MAX_THUMB_BYTES = 200 * 1024;

type Kind = "image" | "pdf" | "zip" | "ole" | "text";
interface FileType {
  mime: string;
  kind: Kind;
}

/** 許可する拡張子。Content-Type は利用者の申告ではなくここで決める（SVG・HTML は XSS になるので不可） */
const TYPES: Record<string, FileType> = {
  png: { mime: "image/png", kind: "image" },
  jpg: { mime: "image/jpeg", kind: "image" },
  jpeg: { mime: "image/jpeg", kind: "image" },
  gif: { mime: "image/gif", kind: "image" },
  webp: { mime: "image/webp", kind: "image" },
  pdf: { mime: "application/pdf", kind: "pdf" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "zip" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "zip" },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", kind: "zip" },
  odt: { mime: "application/vnd.oasis.opendocument.text", kind: "zip" },
  ods: { mime: "application/vnd.oasis.opendocument.spreadsheet", kind: "zip" },
  odp: { mime: "application/vnd.oasis.opendocument.presentation", kind: "zip" },
  doc: { mime: "application/msword", kind: "ole" },
  xls: { mime: "application/vnd.ms-excel", kind: "ole" },
  ppt: { mime: "application/vnd.ms-powerpoint", kind: "ole" },
  txt: { mime: "text/plain; charset=utf-8", kind: "text" },
  md: { mime: "text/markdown; charset=utf-8", kind: "text" },
  csv: { mime: "text/csv; charset=utf-8", kind: "text" },
  zip: { mime: "application/zip", kind: "zip" },
};

/** 保存されないまま残った下書き添付を消すまでの時間 */
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

function startsWith(bytes: Uint8Array, sig: number[], offset = 0) {
  return sig.every((b, i) => bytes[offset + i] === b);
}

/** 先頭バイトで中身が拡張子どおりか確かめる */
export function contentMatches(ext: string, bytes: Uint8Array): boolean {
  const type = TYPES[ext];
  if (!type) return false;
  switch (type.kind) {
    case "image":
      if (ext === "png") return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      if (ext === "gif") return startsWith(bytes, [0x47, 0x49, 0x46, 0x38]);
      if (ext === "webp") return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8);
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "pdf":
      return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case "zip":
      // 空の .zip は中央ディレクトリ終端（PK 05 06）だけでできている。Office 文書は必ず中身がある
      if (ext === "zip" && startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) return true;
      return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
    case "ole":
      return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case "text":
      return !bytes.subarray(0, 8192).includes(0);
  }
}

function extensionOf(filename: string) {
  const dot = filename.lastIndexOf(".");
  return dot < 0 ? "" : filename.slice(dot + 1).toLowerCase();
}

function cleanFilename(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "";
  // 制御文字と、ヘッダーで問題になる文字を除く
  return base
    .replace(/[\u0000-\u001f\u007f"]/g, "")
    .trim()
    .slice(0, 200);
}

/** multipart の file を検証して取り出す。種類は拡張子で決め、中身の先頭バイトと照合する */
async function readUpload(c: Context<AppEnv>) {
  const declared = Number(c.req.header("content-length"));
  if (Number.isFinite(declared) && declared > MAX_FILE_BYTES + MAX_THUMB_BYTES + 64 * 1024) fail(413, "ファイルは10MBまでです");
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    fail(400, "ファイルを送信してください");
  }
  const file = form.get("file");
  if (!(file instanceof File)) fail(400, "ファイルを送信してください");
  if (file.size === 0) fail(400, "空のファイルは添付できません");
  if (file.size > MAX_FILE_BYTES) fail(413, "ファイルは10MBまでです");
  const filename = cleanFilename(file.name);
  const ext = extensionOf(filename);
  const type = TYPES[ext];
  if (!filename || !type) fail(415, "この種類のファイルは添付できません（画像・PDF・Office 文書・テキスト・ZIP のみ）");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!contentMatches(ext, bytes)) fail(415, "ファイルの中身が拡張子と一致しません");
  return { filename, type, bytes, thumb: await readThumb(form, type) };
}

/** 画像に添えられた小さい版。WebP・JPEG・PNG だけを受け付け、種類は中身で決める */
async function readThumb(form: FormData, type: FileType) {
  const thumb = form.get("thumb");
  if (thumb === null) return null;
  if (!(thumb instanceof File) || thumb.size === 0 || type.kind !== "image") fail(400, "小さい版の画像が正しくありません");
  if (thumb.size > MAX_THUMB_BYTES) fail(413, "小さい版の画像は200KBまでです");
  const bytes = new Uint8Array(await thumb.arrayBuffer());
  const ext = ["webp", "jpg", "png"].find((e) => contentMatches(e, bytes));
  if (!ext) fail(415, "小さい版は WebP・JPEG・PNG にしてください");
  return { bytes, mime: TYPES[ext]!.mime };
}

type Upload = Awaited<ReturnType<typeof readUpload>>;

/** 元のファイルと小さい版を R2 に置く。小さい版のキーを返す */
async function putObjects(env: Env, key: string, upload: Upload) {
  await env.FILES.put(key, upload.bytes, { httpMetadata: { contentType: upload.type.mime } });
  if (!upload.thumb) return null;
  const thumbKey = `${key}.thumb`;
  try {
    await env.FILES.put(thumbKey, upload.thumb.bytes, { httpMetadata: { contentType: upload.thumb.mime } });
  } catch (err) {
    await env.FILES.delete(key);
    throw err;
  }
  return thumbKey;
}

/** 添付の R2 本体と小さい版を消す */
export async function deleteObjects(env: Env, rows: { r2_key: string; thumb_key: string | null }[]) {
  const keys = rows.flatMap((r) => (r.thumb_key ? [r.r2_key, r.thumb_key] : [r.r2_key]));
  if (keys.length > 0) await env.FILES.delete(keys);
}

function created(id: string, upload: Upload) {
  return {
    attachment: { id, filename: upload.filename, content_type: upload.type.mime, size: upload.bytes.byteLength, url: `/api/attachments/${id}` },
  };
}

/** 期限切れの下書き添付を少しずつ消す（cron を持たないので、アップロードのついでに行う） */
async function purgeExpiredDrafts(env: Env) {
  const { results } = await env.DB.prepare("SELECT id, r2_key, thumb_key FROM attachments WHERE article_id IS NULL AND created_at < ? LIMIT 50")
    .bind(Date.now() - DRAFT_TTL_MS)
    .all<{ id: string; r2_key: string; thumb_key: string | null }>();
  if (results.length === 0) return;
  await deleteObjects(env, results);
  await env.DB.prepare(`DELETE FROM attachments WHERE article_id IS NULL AND id IN (${results.map(() => "?").join(", ")})`)
    .bind(...results.map((r) => r.id))
    .run();
}

export const attachments = new Hono<AppEnv>();
// "/" にマウントするので、ミドルウェアは各ルートに個別に付ける

/** 記事の保存前に本文へ差し込むための下書き添付。記事の作成時に attachmentIds でひもづける */
attachments.post("/attachments", requireAuth, async (c) => {
  const upload = await readUpload(c);
  const id = crypto.randomUUID();
  const key = `attachments/${id}`;
  const thumbKey = await putObjects(c.env, key, upload);
  try {
    await c.env.DB.prepare(
      `INSERT INTO attachments (id, article_id, r2_key, thumb_key, filename, content_type, size, uploaded_by, created_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, key, thumbKey, upload.filename, upload.type.mime, upload.bytes.byteLength, c.var.user.id, Date.now())
      .run();
  } catch (err) {
    await deleteObjects(c.env, [{ r2_key: key, thumb_key: thumbKey }]);
    throw err;
  }
  c.executionCtx.waitUntil(purgeExpiredDrafts(c.env).catch((err) => console.error("draft purge failed", err)));
  return c.json(created(id, upload), 201);
});

attachments.post("/articles/:id/attachments", requireAuth, async (c) => {
  const articleId = c.req.param("id");
  const article = await c.env.DB.prepare("SELECT 1 FROM articles WHERE id = ? AND deleted_at IS NULL").bind(articleId).first();
  if (!article) fail(404, "記事が見つかりません");
  const upload = await readUpload(c);

  const id = crypto.randomUUID();
  const key = `attachments/${articleId}/${id}`;
  const thumbKey = await putObjects(c.env, key, upload);
  try {
    await c.env.DB.prepare(
      `INSERT INTO attachments (id, article_id, r2_key, thumb_key, filename, content_type, size, uploaded_by, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM articles WHERE id = ? AND deleted_at IS NULL)`,
    )
      .bind(id, articleId, key, thumbKey, upload.filename, upload.type.mime, upload.bytes.byteLength, c.var.user.id, Date.now(), articleId)
      .run()
      .then((r) => {
        if (r.meta.changes === 0) throw new Error("article gone");
      });
  } catch {
    await deleteObjects(c.env, [{ r2_key: key, thumb_key: thumbKey }]);
    fail(409, "記事が削除されたため添付できませんでした");
  }
  return c.json(created(id, upload), 201);
});

interface AttachmentRow {
  r2_key: string;
  thumb_key: string | null;
  article_id: string | null;
  filename: string;
  content_type: string;
  uploaded_by: string;
  deleted_at: number | null;
}

async function findAttachment(db: D1Database, id: string) {
  return db
    .prepare(
      `SELECT f.r2_key, f.thumb_key, f.article_id, f.filename, f.content_type, f.uploaded_by, a.deleted_at
         FROM attachments f LEFT JOIN articles a ON a.id = f.article_id WHERE f.id = ?`,
    )
    .bind(id)
    .first<AttachmentRow>();
}

/** 見てよい添付を探す。下書き添付はアップロードした本人のみ、削除済み記事の添付は管理者のみ */
async function findVisible(c: Context<AppEnv>, id: string) {
  const row = await findAttachment(c.env.DB, id);
  if (!row) fail(404, "ファイルが見つかりません");
  if (row.article_id === null && row.uploaded_by !== c.var.user.id) fail(404, "ファイルが見つかりません");
  if (row.deleted_at !== null && c.var.user.role !== "admin") fail(404, "ファイルが見つかりません");
  return row;
}

/** 一覧に出す小さい版。ない添付（古い添付、バックアップから戻したもの）は元の画像を返す */
attachments.get("/attachments/:id/thumb", requireAuth, async (c) => {
  const row = await findVisible(c, c.req.param("id"));
  if (!row.content_type.startsWith("image/")) fail(404, "ファイルが見つかりません");
  const object = (row.thumb_key ? await c.env.FILES.get(row.thumb_key) : null) ?? (await c.env.FILES.get(row.r2_key));
  if (!object) fail(404, "ファイルが見つかりません");
  return imageResponse(object, object.httpMetadata?.contentType ?? row.content_type, "private, max-age=300");
});

/** 画像をその場で表示するための応答（小さい版とアイコン）。種類は保存時に中身から決めたもの */
export function imageResponse(object: R2ObjectBody, contentType: string, cacheControl: string) {
  return new Response(object.body, {
    headers: {
      "content-type": contentType,
      "content-length": String(object.size),
      "x-content-type-options": "nosniff",
      "cache-control": cacheControl,
      "cross-origin-resource-policy": "same-origin",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}

attachments.get("/attachments/:id", requireAuth, async (c) => {
  const row = await findVisible(c, c.req.param("id"));
  const object = await c.env.FILES.get(row.r2_key);
  if (!object) fail(404, "ファイルが見つかりません");
  return attachmentResponse(object, row, "private, max-age=300");
});

/** 添付を返す。画像と PDF はその場で表示、それ以外はダウンロード（共有ページ share.ts からも使う） */
export function attachmentResponse(object: R2ObjectBody, row: { filename: string; content_type: string }, cacheControl: string) {
  const inline = row.content_type.startsWith("image/") || row.content_type === "application/pdf";
  const ascii = row.filename.replace(/[^\x20-\x7e]/g, "_").replace(/[\\;]/g, "_");
  const headers = new Headers({
    "content-type": row.content_type,
    "content-length": String(object.size),
    "content-disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
    "x-content-type-options": "nosniff",
    "cache-control": cacheControl,
    "cross-origin-resource-policy": "same-origin",
  });
  if (row.content_type.startsWith("image/")) headers.set("content-security-policy", "default-src 'none'; sandbox");
  return new Response(object.body, { headers });
}

attachments.delete("/attachments/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const row = await findAttachment(c.env.DB, id);
  if (!row || row.deleted_at !== null) fail(404, "ファイルが見つかりません");
  if (row.article_id === null && row.uploaded_by !== c.var.user.id) fail(404, "ファイルが見つかりません");
  if (row.uploaded_by !== c.var.user.id && c.var.user.role !== "admin") fail(403, "添付した本人か管理者のみ削除できます");
  // 消すと本文の画像やリンクが切れるので、どこかの記事（ごみ箱も含む）の本文で使われていたら断る。古い版は見ない
  const usedIn = await c.env.DB.prepare("SELECT title, deleted_at FROM articles WHERE instr(body, ?) > 0 ORDER BY deleted_at IS NOT NULL LIMIT 1")
    .bind(`/api/attachments/${id}`)
    .first<{ title: string; deleted_at: number | null }>();
  if (usedIn) {
    const where = usedIn.deleted_at === null ? `「${usedIn.title}」` : "ごみ箱の記事";
    fail(409, `${where}の本文で使われています。本文から外してから削除してください`);
  }
  await c.env.DB.prepare("DELETE FROM attachments WHERE id = ?").bind(id).run();
  await deleteObjects(c.env, [row]);
  return c.json({ ok: true });
});
