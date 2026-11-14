# 記事一覧のサムネイル Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 記事の最初の添付画像を、一覧で小さい版（サムネイル）として表示する。

**Architecture:** ブラウザが添付時に長辺 400px の小さい版を作り、multipart の `thumb` 欄で一緒に送る。サーバーは `<r2_key>.thumb` に保存して `attachments.thumb_key` に記録し、`GET /api/attachments/:id/thumb` で配る（なければ元の画像）。一覧 API は本文から最初の自記事の画像添付を探して `cover` を返す。

**Tech Stack:** Hono, D1, R2, React, vitest

**Spec:** docs/superpowers/specs/2026-11-14-list-thumbnails-design.md

## Global Constraints

- 長辺 400px 以内、WebP（作れないブラウザでは JPEG）。小さい版は WebP・JPEG・PNG のみ、200KB まで（超えたら 413）
- Ruling（Task 3）：iPhone の Safari は WebP を作れず、PNG だと写真で 200KB を超えやすいため、JPEG を受け付けるよう spec を改めた
- 元のファイルが画像でないのに `thumb` があれば 400
- `/thumb` の見える・見えないは `GET /api/attachments/:id` と同じ判定
- 適用済みのマイグレーションは編集しない（新しく `0007_attachment_thumbs.sql`）
- `npm run check` を通してからコミット

## Review Focus

- 小さい版の保存に失敗したとき、元の添付と DB がずれない（R2 に孤児を残さない）
- 下書き添付の掃除・添付の削除・完全削除で `.thumb` も消える
- `cover` に、ほかの記事の添付や下書き添付、画像以外のリンクを選ばない
- `thumb` 欄に File 以外（文字列）が来ても 500 にならない
- 小さい版づくりがブラウザで失敗しても、添付自体は成功する

---

### Task 1: 小さい版の保存・配信・削除（API）

**Files:** Create `migrations/0007_attachment_thumbs.sql`, `test/thumbnails.test.ts`; Modify `worker/routes/attachments.ts`, `worker/routes/admin.ts`

**Interfaces:** Produces `GET /api/attachments/:id/thumb`、`MAX_THUMB_BYTES = 200 * 1024`。アップロードの multipart に任意の `thumb` 欄

- [ ] **Step 1: テスト**（thumbnails.test.ts）：
  - 画像に `thumb`（PNG）を付けて添付 → `/thumb` が小さい版のバイト列と `image/png` を返す。元の URL は元の画像のまま
  - `thumb` なしの画像 → `/thumb` が元の画像を返す
  - R2 から小さい版を消した場合も元の画像を返す
  - PDF に `thumb` → 400、`thumb` が SVG や GIF → 415、200KB 超 → 413、`thumb` が文字列 → 400
  - 未ログインの `/thumb` → 401。ほかの人の下書き添付・メンバーから見たごみ箱の記事の添付 → 404
  - 下書き添付（`POST /api/attachments`）でも `thumb` を受け付ける
  - 添付の削除・記事の完全削除・期限切れ下書きの掃除で `<key>.thumb` が R2 から消える
- [ ] **Step 2: 失敗を確認** `npx vitest run --project worker test/thumbnails.test.ts`
- [ ] **Step 3: 実装**：マイグレーション（`ALTER TABLE attachments ADD COLUMN thumb_key TEXT`）。`readUpload` が `thumb` を検証して返す。元の put の後に小さい版を put し、INSERT 失敗時は両方消す。`/thumb` は `findAttachment` の判定を共有。削除系は `thumb_key` も消す
- [ ] **Step 4: 通過を確認**、`npm run db:migrate:local`
- [ ] **Step 5: コミット** `feat(api): store and serve attachment thumbnails`

### Task 2: 一覧の `cover`（API）

**Files:** Modify `worker/routes/articles.ts`, `test/thumbnails.test.ts`

**Interfaces:** Produces 一覧の各記事に `cover: string | null`（添付 ID）

- [ ] **Step 1: テスト**：本文の最初の画像添付が `cover`。前にある PDF のリンク・外部画像・ほかの記事の添付は飛ばす。画像がなければ null
- [ ] **Step 2: 失敗を確認**
- [ ] **Step 3: 実装**：一覧の SELECT で body も取り、`/!\[[^\]]*\]\(\/api\/attachments\/([0-9a-f-]{36})\)/g` で候補を集め、`SELECT id, article_id FROM attachments WHERE id IN (...) AND content_type LIKE 'image/%'` で自記事のものから本文順に最初を選ぶ。応答に body は含めない
- [ ] **Step 4: 通過を確認**
- [ ] **Step 5: コミット** `feat(api): return each article's first image in the list`

### Task 3: 小さい版づくりと一覧の表示（UI）

**Files:** Create `src/thumbnail.ts`, `src/__tests__/thumbnail.test.ts`; Modify `src/upload.ts`, `src/pages/ArticleListPage.tsx`, `src/styles.css`, `README.md`

**Interfaces:** Produces `thumbSize(width: number, height: number): { width: number; height: number }`（長辺 400 以内、拡大しない、最小 1）、`makeThumbnail(file: File): Promise<Blob | null>`（失敗したら null）

- [ ] **Step 1: テスト**：`thumbSize(4000, 3000)` → 400×300、`thumbSize(300, 1200)` → 100×400、`thumbSize(200, 100)` → 200×100、`thumbSize(4000, 1)` → 400×1
- [ ] **Step 2: 失敗を確認** `npx vitest run --project ui src/__tests__/thumbnail.test.ts`
- [ ] **Step 3: 実装**：`makeThumbnail` は `createImageBitmap` と canvas（`renderAvatar` と同じ WebP→PNG）。`uploadAttachment` は画像なら `thumb` を付ける。一覧は `cover` があれば右側に `<img src="/api/attachments/{cover}/thumb" loading="lazy" alt="">` を記事へのリンクで包む（`tabIndex={-1}` `aria-hidden`）。スマホ 72px・広い画面 96px の正方形、`object-fit: cover`。README の添付の行に一言
- [ ] **Step 4: 通過を確認**、`npm run check`
- [ ] **Step 5: コミット** `feat(ui): show a thumbnail of the first image in the article list`
