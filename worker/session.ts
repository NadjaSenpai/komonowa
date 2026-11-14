import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { randomToken, sha256 } from "./crypto";
import type { AppEnv, Role, SessionUser } from "./env";
import { fail } from "./http";

export const SESSION_COOKIE = "__Host-wiki_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RENEW_BEFORE_MS = 15 * 24 * 60 * 60 * 1000;

export async function createSession(c: Context<AppEnv>, userId: string): Promise<void> {
  const token = randomToken();
  const now = Date.now();
  const expires = now + SESSION_TTL_MS;
  await c.env.DB.prepare("INSERT INTO sessions (id_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(token), userId, expires, now)
    .run();
  writeCookie(c, token, expires);
}

function writeCookie(c: Context, token: string, expires: number) {
  setCookie(c, SESSION_COOKIE, token, {
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
    expires: new Date(expires),
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
}

export async function revokeUserSessions(db: D1Database, userId: string) {
  await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
}

interface SessionRow {
  expires_at: number;
  id: string;
  email: string;
  name: string;
  role: Role;
  avatar_id: string | null;
}

/** 有効なセッションと有効な利用者がそろっている場合だけ通す */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) fail(401, "ログインしてください");
  const idHash = await sha256(token);
  const now = Date.now();
  const row = await c.env.DB.prepare(
    `SELECT s.expires_at, u.id, u.email, u.name, u.role, u.avatar_id
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id_hash = ? AND s.expires_at > ? AND u.status = 'active'`,
  )
    .bind(idHash, now)
    .first<SessionRow>();
  if (!row) {
    clearSessionCookie(c);
    fail(401, "ログインしてください");
  }
  if (row.expires_at - now < RENEW_BEFORE_MS) {
    const expires = now + SESSION_TTL_MS;
    await c.env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE id_hash = ?").bind(expires, idHash).run();
    writeCookie(c, token, expires);
  }
  const user: SessionUser = { id: row.id, email: row.email, name: row.name, role: row.role, avatar_id: row.avatar_id };
  c.set("user", user);
  c.set("sessionHash", idHash);
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.var.user.role !== "admin") fail(403, "管理者のみ操作できます");
  await next();
};
