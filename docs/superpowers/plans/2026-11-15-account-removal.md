# 退会と強制退会 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本人の退会と管理者の強制退会で利用者を匿名化し、強制退会したアドレスを締め出す。

**Architecture:** 新しい `worker/accounts.ts` に匿名化の共通処理 `removeAccount(env, userId)` と締め出しの判定 `isBlocked(db, email)`。退会は auth ルーター、強制退会は admin ルーター。招待とメールアドレス変更で `isBlocked` を見る。

**Tech Stack:** Hono, D1, R2, React, vitest

**Spec:** docs/superpowers/specs/2026-11-15-account-removal-design.md

## Global Constraints

- 名前は「（削除されたユーザー）」、メールは `deleted-<id>@deleted.invalid`。文言は spec の通り
- `blocked_emails` にはアドレスの SHA-256（小文字にしてから）だけ
- 新しいマイグレーション `0010_account_removal.sql`。`npm run check` を通してからコミット

## Review Focus

- 退会後に元の名前・アドレスが残る場所（招待一覧の `email`、`email_changes`、`login_failures` の email、共有の「始めた人」）
- 退会と最後の管理者の判定が同時に走っても、有効な管理者が 0 人にならない
- 退会済みの人への PATCH（再有効化・権限変更）や再設定メールが通らない
- 強制退会の締め出しが、大文字小文字違いや前後の空白で抜けない
- 退会した人のアイコンが R2 に残らない

---

### Task 1: API

**Files:** Create `migrations/0010_account_removal.sql`, `worker/accounts.ts`, `test/account-removal.test.ts`; Modify `worker/routes/auth.ts`, `worker/routes/admin.ts`, `worker/routes/profile.ts`

**Interfaces:** Produces `DELETED_NAME = "（削除されたユーザー）"`、`removeAccount(env: Env, userId: string): Promise<void>`、`isBlocked(db: D1Database, email: string): Promise<boolean>`、`POST /api/auth/withdraw`、`POST /api/admin/users/:id/remove`、`/api/admin/users` は退会済みを除き、各利用者に `deleted` は返さない

- [ ] **Step 1: テスト**：spec の「テスト」の API 項目すべて
- [ ] **Step 2: 失敗を確認** `npx vitest run --project worker test/account-removal.test.ts`
- [ ] **Step 3: 実装**：マイグレーション（`users.deleted_at`、`blocked_emails`）。`removeAccount` は spec の「やること」を 1 回の batch で行い、その後にアイコンを R2 から消す。最後の管理者の判定は条件付き UPDATE。招待（送信・再送）とメール変更の申し込みで `isBlocked`。`login_failures` のその人のアドレスの行も消す。PATCH・再設定メールは `deleted_at IS NULL` の人だけ
- [ ] **Step 4: 通過を確認**、`npm run db:migrate:local`、`npm run check`
- [ ] **Step 5: コミット** `feat(api): let members withdraw and admins remove members`

### Task 2: 画面と文書

**Files:** Modify `src/pages/AccountPage.tsx`, `src/pages/AdminPage.tsx`, `src/Avatar.tsx`, `src/pages/HelpPage.tsx`, `README.md`, `docs/operations.md`

- [ ] **Step 1: 実装**：アカウント画面の「退会」節、管理画面の「強制退会」、退会済みの無地アイコン（名前が `DELETED_NAME` のとき）、ヘルプのアカウントと管理者の節、README の機能表、運用メモに締め出しの解除コマンド
- [ ] **Step 2**：`npm run check`
- [ ] **Step 3: コミット** `feat(ui): withdraw from the account page and remove members from admin`
