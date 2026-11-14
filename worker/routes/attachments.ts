import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import { fail } from "../http";
import { requireAuth } from "../session";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

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
  return base.replace(/[\u0000-\u001f\u007f"]/g, "").trim().slice(0, 200);
}

/** multipart の file を検証して取り出す。種類は拡張子で決め、中身の先頭バイトと照合する */
async function readUpload(c: Context<AppEnv>) {
  const declared = Number(c.req.header("content-length"));
  if (Number.isFinite(declared) && declared > MAX_FILE_BYTES + 64 * 1024) fail(413, "ファイルは10MBまでです");
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
  return { filename, type, bytes };
}

function created(id: string, upload: { filename: string; type: FileType; bytes: Uint8Array }) {
  return {
    attachment: { id, filename: upload.filename, content_type: upload.type.mime, size: upload.bytes.byteLength, url: `/api/attachments/${id}` },
  };
}

/** 期限切れの下書き添付を少しずつ消す（cron を持たないので、アップロードのついでに行う） */
async function purgeExpiredDrafts(env: Env) {
  const { results } = await env.DB.prepare("SELECT id, r2_key FROM attachments WHERE article_id IS NULL AND created_at < ? LIMIT 50")
    .bind(Date.now() - DRAFT_TTL_MS)
    .all<{ id: string; r2_key: string }>();
  if (results.length === 0) return;
  await env.FILES.delete(results.map((r) => r.r2_key));
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
  await c.env.FILES.put(key, upload.bytes, { httpMetadata: { contentType: upload.type.mime } });
  await c.env.DB.prepare(
    `INSERT INTO attachments (id, article_id, r2_key, filename, content_type, size, uploaded_by, created_at)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, key, upload.filename, upload.type.mime, upload.bytes.byteLength, c.var.user.id, Date.now())
    .run();
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
  await c.env.FILES.put(key, upload.bytes, { httpMetadata: { contentType: upload.type.mime } });
  try {
    await c.env.DB.prepare(
      `INSERT INTO attachments (id, article_id, r2_key, filename, content_type, size, uploaded_by, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM articles WHERE id = ? AND deleted_at IS NULL)`,
    )
      .bind(id, articleId, key, upload.filename, upload.type.mime, upload.bytes.byteLength, c.var.user.id, Date.now(), articleId)
      .run()
      .then((r) => {
        if (r.meta.changes === 0) throw new Error("article gone");
      });
  } catch {
    await c.env.FILES.delete(key);
    fail(409, "記事が削除されたため添付できませんでした");
  }
  return c.json(created(id, upload), 201);
});

interface AttachmentRow {
  r2_key: string;
  article_id: string | null;
  filename: string;
  content_type: string;
  uploaded_by: string;
  deleted_at: number | null;
}

async function findAttachment(db: D1Database, id: string) {
  return db
    .prepare(
      `SELECT f.r2_key, f.article_id, f.filename, f.content_type, f.uploaded_by, a.deleted_at
         FROM attachments f LEFT JOIN articles a ON a.id = f.article_id WHERE f.id = ?`,
    )
    .bind(id)
    .first<AttachmentRow>();
}

attachments.get("/attachments/:id", requireAuth, async (c) => {
  const row = await findAttachment(c.env.DB, c.req.param("id"));
  // 下書き添付はアップロードした本人のみ、削除済み記事の添付は管理者のみ
  if (!row) fail(404, "ファイルが見つかりません");
  if (row.article_id === null && row.uploaded_by !== c.var.user.id) fail(404, "ファイルが見つかりません");
  if (row.deleted_at !== null && c.var.user.role !== "admin") fail(404, "ファイルが見つかりません");
  const object = await c.env.FILES.get(row.r2_key);
  if (!object) fail(404, "ファイルが見つかりません");
  const inline = row.content_type.startsWith("image/") || row.content_type === "application/pdf";
  const ascii = row.filename.replace(/[^\x20-\x7e]/g, "_").replace(/[\\;]/g, "_");
  const headers = new Headers({
    "content-type": row.content_type,
    "content-length": String(object.size),
    "content-disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
    "x-content-type-options": "nosniff",
    "cache-control": "private, max-age=300",
    "cross-origin-resource-policy": "same-origin",
  });
  if (row.content_type.startsWith("image/")) headers.set("content-security-policy", "default-src 'none'; sandbox");
  return new Response(object.body, { headers });
});

attachments.delete("/attachments/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const row = await findAttachment(c.env.DB, id);
  if (!row || row.deleted_at !== null) fail(404, "ファイルが見つかりません");
  if (row.article_id === null && row.uploaded_by !== c.var.user.id) fail(404, "ファイルが見つかりません");
  if (row.uploaded_by !== c.var.user.id && c.var.user.role !== "admin") fail(403, "添付した本人か管理者のみ削除できます");
  await c.env.DB.prepare("DELETE FROM attachments WHERE id = ?").bind(id).run();
  await c.env.FILES.delete(row.r2_key);
  return c.json({ ok: true });
});
