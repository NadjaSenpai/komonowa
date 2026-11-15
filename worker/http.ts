import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { PASSWORD_MIN } from "../shared/accounts";

export function fail(status: ContentfulStatusCode, message: string, extra?: Record<string, unknown>): never {
  throw new HTTPException(status, {
    res: new Response(JSON.stringify({ error: message, ...extra }), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    }),
  });
}

export async function readJson(c: Context): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // fall through
  }
  fail(400, "リクエストの形式が正しくありません");
}

/** 前後の空白を除いて長さを確かめる。trim: false は、空白も中身のうちのもの（パスワード、本文）に使う */
export function str(body: Record<string, unknown>, key: string, opts: { min?: number; max: number; label: string; trim?: boolean }): string {
  const raw = body[key];
  if (typeof raw !== "string") fail(400, `${opts.label}を入力してください`);
  const value = opts.trim === false ? raw : raw.trim();
  if (value.length < (opts.min ?? 1)) {
    fail(400, opts.min && opts.min > 1 ? `${opts.label}は${opts.min}文字以上にしてください` : `${opts.label}を入力してください`);
  }
  if (value.length > opts.max) fail(400, `${opts.label}は${opts.max}文字以内にしてください`);
  return value;
}

/** 確かめずにそのまま読む（文字列でなければ空）。照合するだけの値（今のパスワード、合言葉）に使う */
export function text(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

export function int(body: Record<string, unknown>, key: string, label: string): number {
  const value = body[key];
  if (typeof value !== "number" || !Number.isInteger(value)) fail(400, `${label}が正しくありません`);
  return value;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function email(body: Record<string, unknown>): string {
  const value = str(body, "email", { max: 254, label: "メールアドレス" }).toLowerCase();
  if (!EMAIL_RE.test(value)) fail(400, "メールアドレスの形式が正しくありません");
  return value;
}

export function password(body: Record<string, unknown>, key = "password"): string {
  return str(body, key, { min: PASSWORD_MIN, max: 256, label: "パスワード", trim: false });
}

/** リクエストを受けたオリジン。メールや共有に載せる URL を作るのに使う */
export function origin(c: Context): string {
  return new URL(c.req.url).origin;
}

/** 一意インデックスに弾かれたエラーか。事前の確認と書き込みの間に割り込まれたときに起きる */
export function isUniqueViolation(err: unknown, column?: string): boolean {
  return err instanceof Error && err.message.includes("UNIQUE constraint failed") && (column === undefined || err.message.includes(column));
}
