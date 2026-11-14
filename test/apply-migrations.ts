import { applyD1Migrations, env, reset } from "cloudflare:test";
import { beforeEach, vi } from "vitest";
import { mailer } from "../worker/mail";
import { mailbox } from "./helpers";

// テストごとに D1 / R2 を空にしてからマイグレーションを適用する
beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

// メールは送らずに mailbox にためる。failNext を立てると次の1通だけ送信に失敗する
beforeEach(() => {
  mailbox.sent.length = 0;
  mailbox.failNext = false;
  vi.spyOn(mailer, "send").mockImplementation(async (_env, mail) => {
    if (mailbox.failNext) {
      mailbox.failNext = false;
      throw Object.assign(new Error("delivery failed"), { code: "E_DELIVERY_FAILED" });
    }
    mailbox.sent.push(mail);
  });
});
