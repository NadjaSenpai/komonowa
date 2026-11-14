import { fail } from "./http";

/** komonowa が送るメール（文字だけ） */
export interface Mail {
  to: string;
  subject: string;
  text: string;
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

/** メールに書く日時（チームは日本にいる前提で日本時間） */
export function formatJst(ms: number): string {
  return new Date(ms).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short" }) + "（日本時間）";
}

/** 送れなければ 502。呼び出し側は送れてから記録するので、失敗しても何も残らない */
export async function sendOrFail(env: Env, mail: Mail): Promise<void> {
  try {
    await mailer.send(env, mail);
  } catch (err) {
    console.error("mail send failed", (err as { code?: string }).code ?? "", err);
    fail(502, MAIL_FAILED);
  }
}
