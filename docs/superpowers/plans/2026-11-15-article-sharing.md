# 記事の外部共有 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 共有を ON にした記事を、推測できない共有専用 URL でログインなしに読めるようにする。

**Architecture:** `article_shares`（記事ごとに 1 行、トークンをそのまま保存）。メンバーの操作は articles ルーター（要ログイン）、管理者の一覧・停止は admin ルーター、公開側は新しい `worker/routes/share.ts`（`/api/share`、ログイン不要）。画面は `/s/:token` の `SharedPage`。

**Tech Stack:** Hono, D1, R2, React, vitest

**Spec:** docs/superpowers/specs/2026-11-15-article-sharing-design.md

## Global Constraints

- 公開側の応答は `{ title, body, updated_at }` だけ。404 の文言は「共有が見つかりません。共有が止められたか、URL が違います」で、理由を区別しない
- 公開側の応答（添付も）に `X-Robots-Tag: noindex, nofollow, noarchive, noai, noimageai` と `cache-control: no-store`
- ごみ箱に入れたら共有の行を消す。戻しても消えたまま
- 適用済みのマイグレーションは編集しない（新しく `0008_article_shares.sql`）
- `npm run check` を通してからコミット

## Review Focus

- 共有トークンで、ほかの記事の添付・下書き添付が取れない
- 止めた直後に、ブラウザやエッジのキャッシュから見えない（no-store）
- 記事の完全削除で共有の行が残らない（外部キーの ON DELETE CASCADE）
- 共有ページの本文の HTML から、メンバーの名前やほかの記事の ID が漏れない（`[[ ]]` のリンク先 `/wiki/...` は文字にする）
- トークンの形が違う（長すぎる・空）ときも 404 で、500 にならない

---

### Task 1: 共有の記録と、メンバー・管理者の操作（API）

**Files:** Create `migrations/0008_article_shares.sql`, `test/share.test.ts`; Modify `worker/routes/articles.ts`, `worker/routes/admin.ts`

**Interfaces:** Produces `POST/DELETE /api/articles/:id/share`、`GET /api/articles/:id` の `share: { url: string; created_at: number; created_by_name: string } | null`、`GET /api/admin/shares` → `{ shares: { article_id, title, created_at, created_by_name }[] }`、`DELETE /api/admin/shares/:articleId`

- [ ] **Step 1: テスト**：未ログイン 401。メンバーが始めると 201 で `share.url` が `https://wiki.example.com/s/<43文字前後>`、もう一度始めると 200 で同じ URL。記事の GET に share が出る。止めると 200、GET の share は null。止めてまた始めると別の URL。ごみ箱の記事は始められない 404。ごみ箱に入れると share の行が消え、管理者が戻しても null。完全削除で行が消える。管理者の一覧・停止はメンバー 403、管理者 200
- [ ] **Step 2: 失敗を確認** `npx vitest run --project worker test/share.test.ts`
- [ ] **Step 3: 実装**：テーブル `article_shares(article_id TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE, token TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL)`。開始は `INSERT ... ON CONFLICT DO NOTHING` のあと読み直し。ごみ箱への移動と同じ batch で行を消す
- [ ] **Step 4: 通過を確認**、`npm run db:migrate:local`
- [ ] **Step 5: コミット** `feat(api): let members start and stop sharing an article`

### Task 2: 公開側の API と、ボット対策

**Files:** Create `worker/routes/share.ts`, `public/robots.txt`; Modify `worker/index.ts`, `worker/routes/attachments.ts`（配信の共通化）, `index.html`, `test/share.test.ts`

**Interfaces:** Produces `GET /api/share/:token` → `{ article: { title, body, updated_at } }`、`GET /api/share/:token/attachments/:id`

- [ ] **Step 1: テスト**：ログインなしで読め、応答のキーが title・body・updated_at だけ。X-Robots-Tag と no-store。止めた・ごみ箱・でたらめ・長すぎるトークンは同じ 404 文言。その記事の添付は読め（no-store）、ほかの記事の添付・下書き添付・共有していない記事の添付は 404
- [ ] **Step 2: 失敗を確認**
- [ ] **Step 3: 実装**：添付の Response を組む部分を `attachmentResponse(object, row)` として attachments.ts から出す。robots.txt は `User-agent: *` に `Disallow: /`、AI の収集ボット（GPTBot, ChatGPT-User, OAI-SearchBot, ClaudeBot, Claude-Web, anthropic-ai, CCBot, Google-Extended, PerplexityBot, Bytespider, Amazonbot, Applebot-Extended, meta-externalagent）も名前で Disallow。index.html の meta robots を `noindex, nofollow, noarchive, noai, noimageai`
- [ ] **Step 4: 通過を確認**、`npm run check`
- [ ] **Step 5: コミット** `feat(api): serve shared articles without login`

### Task 3: 画面と文書

**Files:** Create `src/pages/SharedPage.tsx`, `src/share.ts`, `src/__tests__/share.test.ts`; Modify `src/App.tsx`, `src/pages/ArticleViewPage.tsx`, `src/pages/AdminPage.tsx`, `src/pages/HelpPage.tsx`, `src/__tests__/help.test.ts`, `src/styles.css`, `README.md`, `docs/operations.md`

**Interfaces:** Produces `sharedHtml(body: string, token: string): string`（`renderMarkdown` の結果で、`/api/attachments/<id>` を `/api/share/<token>/attachments/<id>` に読み替え、`a[href^="/wiki/"]` を中身の文字だけの `span` に置き換える）

- [ ] **Step 1: テスト**（src/__tests__/share.test.ts）：画像と添付リンクの URL が読み替わる。`[[ほかの記事]]` が `<a>` でなく文字になり `/wiki/` を含まない。外部リンクはそのまま
- [ ] **Step 2: 失敗を確認** `npx vitest run --project ui src/__tests__/share.test.ts`
- [ ] **Step 3: 実装**：`/s/:token`（ログイン不要、上のナビなし。「komonowa で共有された記事」、タイトル、最終更新日、本文）。記事画面に「共有」ボタンと共有の欄（spec の文言、「共有を始める」「コピー」「共有を止める」、止めるときは確認）と「共有中」の印。管理画面に「共有中の記事」節（「共有を止める」）。ヘルプに「記事を共有する」節（`HELP_SECTIONS` に `share` を足す）。README の機能表と、operations.md に Cloudflare の AI ボットのブロック設定を勧める一文
- [ ] **Step 4: 通過を確認**、`npm run check`
- [ ] **Step 5: コミット** `feat(ui): share an article with people outside the wiki`
