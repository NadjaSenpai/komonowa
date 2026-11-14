import { fail } from "./http";

/** komonowa が送るメール。html があれば HTML と文字だけの本文の両方を送る（worker/mailTemplates.ts） */
export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export const MAIL_FAILED = "メールを送れませんでした。アドレスを確かめて、もう一度試してください";

/**
 * Cloudflare Email Sending で送る。テストではこの send を差し替える（test/apply-migrations.ts）。
 * wrangler dev では送信は模擬され、本物は送られない
 */
export const mailer = {
  async send(env: Env, mail: Mail): Promise<void> {
    await env.EMAIL.send({ from: { email: env.MAIL_FROM, name: "komonowa" }, ...mail });
  },
};

/** 送れなければ 502。呼び出し側は送れてから記録するので、失敗しても何も残らない */
export async function sendOrFail(env: Env, mail: Mail): Promise<void> {
  try {
    await mailer.send(env, mail);
  } catch (err) {
    console.error("mail send failed", (err as { code?: string }).code ?? "", err);
    fail(502, MAIL_FAILED);
  }
}
