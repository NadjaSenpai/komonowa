# 共有のパスワード Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 共有に任意で 6 桁のパスワードを付け、入れた人だけが本文・画像・添付を見られるようにする。

**Architecture:** `article_shares.passcode` と間違いの記録 `share_passcode_failures`。メンバーの付け外しは articles ルーター、鍵の確認と `unlock` は share ルーター。鍵はサーバーに保存しないクッキー（`SHA-256(token:passcode)`、共有ごとの Path）。

**Tech Stack:** Hono, D1, React, vitest

**Spec:** docs/superpowers/specs/2026-11-15-share-passcode-design.md

## Global Constraints

- パスワード要求・違うパスワードは 403 `{ error, needsPasscode: true }`（401 にしない）
- 文言は spec の通り（「パスワードを入れてください」「パスワードが違います」「間違いが続いたため、15分ほど待ってからもう一度試してください」）
- クッキー `share_key`、`Path=/api/share/<token>; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`
- 比較は `safeStringEqual`
- 新しいマイグレーション `0009_share_passcode.sql`。`npm run check` を通してからコミット

## Review Focus

- 添付の URL を鍵なしで直接開いても 403
- 作り直し・外し・停止の後に、古いクッキーで見えない（外した場合は見えてよい）
- 回数制限が正しいパスワードにも効く（当て続けて最後に正解、を防ぐ）
- 共有ページを開いたログイン中のメンバーが、アプリからログアウト扱いにならない（401 を返さない）
- パスワードの先頭が 0 でも 6 桁のまま扱われる

---

### Task 1: API

**Files:** Create `migrations/0009_share_passcode.sql`, `test/share-passcode.test.ts`; Modify `worker/routes/articles.ts`, `worker/routes/share.ts`, `worker/routes/admin.ts`, `worker/crypto.ts`

**Interfaces:** Produces `randomPasscode(): string`（6 桁）、`share.passcode: string | null`、`POST/DELETE /api/articles/:id/share/passcode` → `{ share }`、`POST /api/share/:token/unlock`、admin の `has_passcode`

- [ ] **Step 1: テスト**：spec の「テスト」の API 項目すべて（権限、6 桁・変わる・null、鍵なし 403 本文も添付も、違う 403、正しいと Set-Cookie の属性、そのクッキーで本文と添付が 200、作り直しで古いクッキー 403、外すとクッキーなし 200、止めると 404、5 回間違いで正解も 429・作り直しで解ける、`has_passcode`、`randomPasscode` が `/^\d{6}$/`）
- [ ] **Step 2: 失敗を確認** `npx vitest run --project worker test/share-passcode.test.ts`
- [ ] **Step 3: 実装**
- [ ] **Step 4: 通過を確認**、`npm run db:migrate:local`、`npm run check`
- [ ] **Step 5: コミット** `feat(api): protect a share with a passcode`

### Task 2: 画面と文書

**Files:** Modify `src/SharePanel.tsx`, `src/pages/SharedPage.tsx`, `src/pages/AdminPage.tsx`, `src/pages/HelpPage.tsx`, `src/styles.css`, `README.md`

- [ ] **Step 1: 実装**：spec の「共有の欄」「共有ページ」の文言と操作。共有ページは `ApiError.data.needsPasscode` でフォームを出し、`unlock` が成功したら読み込み直す。入力は `inputMode="numeric"`、`autoComplete="off"`、`pattern="\d{6}"`。管理画面の一覧に「パスワードあり」。ヘルプの共有の節と README の外部共有の行に一言
- [ ] **Step 2**：`npm run check`
- [ ] **Step 3: コミット** `feat(ui): set and enter a share passcode`
