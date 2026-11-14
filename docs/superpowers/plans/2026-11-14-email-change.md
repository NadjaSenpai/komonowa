# メールアドレスの変更 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本人が確認メールを経てメールアドレスを変えられるようにする。

**Architecture:** `email_changes` テーブル。申し込みは profile ルーター（要ログイン）、確定は auth ルーター（ログイン不要）。メール文面は `worker/mailTemplates.ts` に `emailChangeMail` / `emailChangedNotice` を足す。

**Tech Stack:** D1, Hono, Email Sending, React, vitest

**Spec:** docs/superpowers/specs/2026-11-14-email-change-design.md

## Global Constraints

- エラー文と応答の形は spec の通り
- 適用済みのマイグレーションは編集しない（新しく `0006_email_changes.sql`）
- `npm run check` を通してからコミット

## Review Focus

- 大文字小文字だけ違うアドレス（`users.email` は NOCASE）を「同じ」「使用中」と正しく判定すること
- 確定の同時実行で片方だけ成功すること（used_at の条件付き UPDATE）
- 確定時に再設定リンクが無効になること
- 古いアドレスへのお知らせの失敗が、確定を失敗させないこと
- 無効化された利用者のリンクは 410

---

### Task 1: マイグレーションとメール文面

**Files:** Create `migrations/0006_email_changes.sql`; Modify `worker/mailTemplates.ts`, `test/mail.test.ts`

**Interfaces:** Produces `emailChangeMail({ to, url, expiresAt }): Mail`（件名「「komonowa」メールアドレスの確認」、ボタン「メールアドレスを確認する」）、`emailChangedNotice({ to, newEmail }): Mail`（件名「「komonowa」のメールアドレスが変更されました」、文字に新しいアドレスと「身に覚えがなければ管理者に連絡してください」）

- [ ] **Step 1: テスト**（mail.test.ts）：件名、リンク、ボタン文言、お知らせに新しいアドレスと連絡の文言
- [ ] **Step 2: 失敗を確認** `npx vitest run --project worker test/mail.test.ts`
- [ ] **Step 3: 実装**（お知らせはボタンなしの本文にするため、テンプレートの button/url を任意にする）
- [ ] **Step 4: 通過を確認**
- [ ] **Step 5: コミット** `feat(api): add the email change table and mail templates`

### Task 2: API

**Files:** Modify `worker/routes/profile.ts`（申し込み）、`worker/routes/auth.ts`（確定）; Create `test/email-change.test.ts`

- [ ] **Step 1: テスト**：未ログイン 401；メンバー・管理者とも申し込み 201、応答に token なし、新アドレスにメール；パスワード違い 403；同じアドレス（大文字違い含む）400；使用中 409；送信失敗 502 で前の申し込みが有効；確定で `/api/auth/me` の email が変わり、ログインは新アドレスで通り旧アドレスで通らない；古いアドレスにお知らせ；二回目の確定 410；期限切れ 410；申し込み直しで古いリンク 410；確定前に他人がそのアドレスで登録済みなら 409；確定で未使用の再設定リンクが 410；無効化された人のリンク 410；お知らせの送信失敗でも確定は 200
- [ ] **Step 2: 失敗を確認** `npx vitest run --project worker test/email-change.test.ts`
- [ ] **Step 3: 実装**
- [ ] **Step 4: 通過を確認**
- [ ] **Step 5: コミット** `feat(api): let users change their email after confirming the new address`

### Task 3: 画面と文書

**Files:** Modify `src/pages/AccountPage.tsx`、`src/pages/AuthPages.tsx`（`EmailConfirmPage`）、`src/App.tsx`（`/email`）、`README.md`

- [ ] **Step 1**：アカウント画面の欄と確認ページ（spec の文言）
- [ ] **Step 2**：README の機能表（アカウント）
- [ ] **Step 3**：`npm run check` → 成功
- [ ] **Step 4: コミット** `feat(ui): change your email from the account page`
