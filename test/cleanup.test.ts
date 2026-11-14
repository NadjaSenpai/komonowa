import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../worker/index";
import { adminClient, memberClient } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;
const count = async (table: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

describe("期限切れの記録の掃除（毎日の cron）", () => {
  it("期限切れのセッション・メール変更・古いトークン・古い失敗の記録だけを消す", async () => {
    const admin = await adminClient();
    const member = await memberClient(admin);
    const now = Date.now();
    const uid = member.user.id;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO sessions (id_hash, user_id, expires_at, created_at) VALUES ('old-session', ?, ?, ?)").bind(uid, now - 1000, now),
      env.DB.prepare("INSERT INTO email_changes (token_hash, user_id, new_email, expires_at, created_at) VALUES ('old-change', ?, 'a@example.com', ?, ?)").bind(
        uid,
        now - 1000,
        now,
      ),
      env.DB.prepare(
        "INSERT INTO email_changes (token_hash, user_id, new_email, expires_at, created_at) VALUES ('live-change', ?, 'b@example.com', ?, ?)",
      ).bind(uid, now + DAY, now),
      // 招待の一覧に履歴として出すので、期限から 30 日は残す
      env.DB.prepare(
        "INSERT INTO auth_tokens (token_hash, kind, email, role, created_by, expires_at, created_at) VALUES ('recent-invite', 'invite', 'c@example.com', 'member', ?, ?, ?)",
      ).bind(uid, now - DAY, now),
      env.DB.prepare(
        "INSERT INTO auth_tokens (token_hash, kind, email, role, created_by, expires_at, created_at) VALUES ('old-invite', 'invite', 'd@example.com', 'member', ?, ?, ?)",
      ).bind(uid, now - 31 * DAY, now),
      env.DB.prepare("INSERT INTO login_failures (email, created_at) VALUES ('typo@example.com', ?)").bind(now - 2 * DAY),
      env.DB.prepare("INSERT INTO login_failures (email, created_at) VALUES ('now@example.com', ?)").bind(now),
    ]);
    const sessions = await count("sessions");
    const tokens = await count("auth_tokens");

    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController(), env, ctx);
    await waitOnExecutionContext(ctx);

    expect(await count("sessions")).toBe(sessions - 1);
    expect(await count("auth_tokens")).toBe(tokens - 1);
    expect(await env.DB.prepare("SELECT token_hash FROM email_changes").all()).toMatchObject({ results: [{ token_hash: "live-change" }] });
    expect(await env.DB.prepare("SELECT email FROM login_failures").all()).toMatchObject({ results: [{ email: "now@example.com" }] });
    // ログイン中の人はそのまま使える
    expect((await member.client.get("/api/auth/me")).status).toBe(200);
  });
});
