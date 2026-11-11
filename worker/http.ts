import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

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

export function str(body: Record<string, unknown>, key: string, opts: { min?: number; max: number; label: string }): string {
  const value = body[key];
  if (typeof value !== "string") fail(400, `${opts.label}を入力してください`);
  const trimmed = opts.label === "パスワード" || key === "body" ? value : value.trim();
  if (trimmed.length < (opts.min ?? 1)) {
    fail(400, opts.min && opts.min > 1 ? `${opts.label}は${opts.min}文字以上にしてください` : `${opts.label}を入力してください`);
  }
  if (trimmed.length > opts.max) fail(400, `${opts.label}は${opts.max}文字以内にしてください`);
  return trimmed;
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

export const PASSWORD_MIN = 12;
export function password(body: Record<string, unknown>, key = "password"): string {
  return str(body, key, { min: PASSWORD_MIN, max: 256, label: "パスワード" });
}
