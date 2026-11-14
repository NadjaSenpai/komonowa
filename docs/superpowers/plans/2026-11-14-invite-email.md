# 招待・再設定メール Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 招待リンクとパスワード再設定リンクを、画面に出す代わりに Cloudflare Email Sending で本人にメールで送る。

**Architecture:** `worker/mail.ts` に送信オブジェクト `mailer` を置き、`env.EMAIL.send()` を包む。管理 API は「トークン生成 → メール送信 → 成功したら D1 に記録」の順にし、応答からトークンを外す。テストは `vi.spyOn(mailer, "send")` でメールを捕まえてトークンを取り出す（SELF 経由でもスパイが効くことを確認済み）。

**Tech Stack:** Cloudflare Workers `send_email` binding, Hono, D1, React, vitest (@cloudflare/vitest-plugin)

**Spec:** docs/superpowers/specs/2026-11-14-invite-email-design.md

## Global Constraints

- 送信元：`vars.MAIL_FROM = "komonowa@nadja.dev"`、表示名 `komonowa`
- 送信失敗時：502、エラー文「メールを送れませんでした。アドレスを確かめて、もう一度試してください」。D1 は変更しない
- API 応答：招待・再設定とも `201 { expiresAt }`（`token` を含めない）
- 新しい秘密の値を増やさない
- `npm run check` を通してからコミット。コミットの件名は命令形

## Review Focus

- 送信失敗時に、同じアドレスの前の未使用招待（再設定なら前のリンク）が取り消されずに残ること
- 応答 JSON にトークンが含まれないこと
- 再送で期限の長さが元と同じになること（24/72/168 時間）
- メール本文のリンクがリクエストのオリジンで作られること
- メンバー・未ログインは送信 API を呼べないこと（既存の 403/401 テストで担保）

---

### Task 1: 送信モジュールと招待メール

**Files:**
- Create: `worker/mail.ts`
- Modify: `wrangler.jsonc`（`send_email` と `vars`）、`worker/worker-configuration.d.ts`（`npm run cf-typegen`）、`worker/routes/admin.ts`（`POST /invites`）、`test/helpers.ts`、`test/auth.test.ts`

**Interfaces:**
- Produces: `mailer.send(env: Env, mail: { to: string; subject: string; text: string }): Promise<void>`、`MAIL_FAILED` 文言、`sendOrFail(env, mail)`（失敗を 502 に変換）。`test/helpers.ts` の `captureMail(): { last(): { to, subject, text }; token(): string; fail(): void }`（スパイを張り、最後のメール本文から `#` 以降のトークンを取り出す。`fail()` で次の送信を reject させる）

- [ ] **Step 1: テストを書き換える**：`招待` の既存テストで `token` を応答ではなく `captureMail().token()` から取る。応答 JSON に `token` が無いこと、メールの `to` が `new@example.com`、本文に `https://wiki.example.com/invite#` と招待者名「管理者」が入ることを確認。新テスト「送れなければ招待は記録されず、前の招待も使える」：1 回目の招待のトークンを取り、`fail()` してから同じアドレスへ再招待 → 502 と上記文言、1 回目のトークンで `/api/auth/invite/check` が 200。
- [ ] **Step 2: 失敗を確認**：`npx vitest run --project worker test/auth.test.ts` → FAIL
- [ ] **Step 3: 実装**：binding と vars を足して cf-typegen、`worker/mail.ts`、`POST /invites` を「送信 → batch」に変える
- [ ] **Step 4: 通過を確認**：同じコマンド → PASS
- [ ] **Step 5: コミット** `feat(api): send invites by email instead of returning the link`

### Task 2: パスワード再設定メール

**Files:** Modify `worker/routes/admin.ts`（`POST /users/:id/reset-link`）、`test/auth.test.ts`

- [ ] **Step 1: テスト**：再設定の既存 2 テストでトークンをメールから取る。宛先が本人のアドレス、本文に `https://wiki.example.com/reset#`、応答に `token` が無いこと。新テスト：送信失敗で 502、直前のリンクがまだ使える（`/api/auth/reset/accept` が 200）。
- [ ] **Step 2: 失敗を確認**（同上）
- [ ] **Step 3: 実装**：利用者の `email` を取り、送信してから batch
- [ ] **Step 4: 通過を確認**
- [ ] **Step 5: コミット** `feat(api): send password reset links by email`

### Task 3: 管理画面と文書

**Files:** Modify `src/pages/AdminPage.tsx`、`README.md`、`docs/operations.md`

- [ ] **Step 1: 実装**：`IssuedLink` を削除し、成功時は `notice` に「○○ に招待メールを送りました（期限：…）」「○○ さんに再設定メールを送りました（24時間有効）」。ボタン名「招待メールを送る」「再設定メールを送る」。招待一覧の「未使用」「期限切れ」の行に「再送」（`Math.round((expires_at - created_at) / 3600000)` 時間で `POST /admin/invites`）。`Invite` に `created_at` を足す。
- [ ] **Step 2: 文書**：README の機能表・デプロイ手順・必要なもの（Workers Paid と送信元ドメインの登録）、`docs/operations.md` に送信元ドメインと届かないときの確認。
- [ ] **Step 3: 確認**：`npm run check` → 成功
- [ ] **Step 4: コミット** `feat(ui): send invites and reset links by email from the admin page`
