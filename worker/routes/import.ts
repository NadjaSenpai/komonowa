// Cosense（旧 Scrapbox）からの取り込み。記法の変換はブラウザ（shared/cosense.ts）で済ませ、ここには 1 ページずつ届く。
// 設計: docs/superpowers/specs/2026-11-26-cosense-import-design.md
import { Hono } from "hono";
import { titleKey } from "../../shared/wikilinks";
import type { AppEnv } from "../env";
import { readJson } from "../http";
import { fetchImportImage, isImportableImageUrl } from "../importImages";
import { requireAuth } from "../session";
import { assertTitleFree, createArticle, readArticleInput } from "./articles";
import { mimeOf, purgeExpiredDrafts } from "./attachments";

const MAX_IMAGES = 50;
const MIN_DATE = Date.UTC(2000, 0, 1);
const IMAGE = /!\[[^\]]*\]\((https:\/\/[^)\s]+)\)/g;

export const importRoutes = new Hono<AppEnv>();
importRoutes.use("*", requireAuth);

/** 引き継ぐ日付。2000-01-01 以降かつ現在以下でなければ現在時刻 */
function readDate(value: unknown, now: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= MIN_DATE && value <= now ? Math.floor(value) : now;
}

importRoutes.post("/cosense/pages", async (c) => {
  const body = await readJson(c);
  const input = readArticleInput(body);
  const now = Date.now();
  const updatedAt = readDate(body.updated, now);
  const createdAt = Math.min(readDate(body.created, now), updatedAt);
  const userId = c.var.user.id;
  // 画像を取りに行く前に、同じタイトルがないか確かめる（作成の時点でもう一度確かめる）
  await assertTitleFree(c.env.DB, titleKey(input.title), "");

  const urls = [...new Set([...input.body.matchAll(IMAGE)].map((m) => m[1]!))].filter(isImportableImageUrl);
  const images = { saved: 0, failed: Math.max(0, urls.length - MAX_IMAGES) };
  const attachmentIds: string[] = [];
  let text = input.body;
  // メモリと外部アクセスを抑えるため 1 枚ずつ
  for (const url of urls.slice(0, MAX_IMAGES)) {
    const image = await fetchImportImage(url);
    if (!image) {
      images.failed++;
      continue;
    }
    const id = crypto.randomUUID();
    const key = `attachments/${id}`;
    const mime = mimeOf(image.ext)!;
    await c.env.FILES.put(key, image.bytes, { httpMetadata: { contentType: mime } });
    await c.env.DB.prepare(
      `INSERT INTO attachments (id, article_id, r2_key, thumb_key, filename, content_type, size, uploaded_by, created_at)
       VALUES (?, NULL, ?, NULL, ?, ?, ?, ?, ?)`,
    )
      .bind(id, key, `cosense-${id.slice(0, 8)}.${image.ext}`, mime, image.bytes.byteLength, userId, now)
      .run();
    attachmentIds.push(id);
    text = text.split(`](${url})`).join(`](/api/attachments/${id})`);
    images.saved++;
  }

  // 記事の作成に失敗したとき、保存した画像は下書き添付のまま残り、期限が来たらこれで消える
  c.executionCtx.waitUntil(purgeExpiredDrafts(c.env).catch((err) => console.error("draft purge failed", err)));
  const id = await createArticle(c.env.DB, { input: { ...input, body: text }, userId, createdAt, updatedAt, attachmentIds });
  return c.json({ article: { id, title: input.title }, images }, 201);
});
