import { SELF } from "cloudflare:test";
import type { Mail } from "../worker/mail";

/** テスト中に送ったメール（test/apply-migrations.ts で mailer.send を差し替え、本物も模擬も送らない） */
export const mailbox = { sent: [] as Mail[], failNext: false };

/** 最後に送ったメール */
export function lastMail(): Mail {
  const mail = mailbox.sent.at(-1);
  if (!mail) throw new Error("メールが送られていません");
  return mail;
}

/** メール本文のリンク（.../invite#トークン など）からトークンを取り出す */
export function tokenFrom(mail: Mail): string {
  const m = /#([A-Za-z0-9_-]+)/.exec(mail.text);
  if (!m) throw new Error("本文にリンクがありません");
  return m[1]!;
}

export const ORIGIN = "https://wiki.example.com";
export const SETUP_TOKEN = "test-setup-token-0123456789abcdefghij";
export const ADMIN = { email: "admin@example.com", name: "管理者", password: "admin-password-123" };

/** Cookie を保持する簡易クライアント */
export class Client {
  cookie = "";

  async request(path: string, init: RequestInit & { json?: unknown } = {}) {
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set("cookie", this.cookie);
    if (!headers.has("origin")) headers.set("origin", ORIGIN);
    let body = init.body;
    if (init.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(init.json);
    }
    const res = await SELF.fetch(`${ORIGIN}${path}`, { ...init, headers, body, redirect: "manual" });
    const set = res.headers.get("set-cookie");
    if (set) {
      const [pair] = set.split(";");
      const [, value] = (pair ?? "").split("=");
      this.cookie = value ? (pair as string) : "";
    }
    return res;
  }

  get(path: string) {
    return this.request(path);
  }
  post(path: string, json?: unknown) {
    return this.request(path, { method: "POST", json: json ?? {} });
  }
  put(path: string, json: unknown) {
    return this.request(path, { method: "PUT", json });
  }
  patch(path: string, json: unknown) {
    return this.request(path, { method: "PATCH", json });
  }
  del(path: string) {
    return this.request(path, { method: "DELETE" });
  }
}

export async function json<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** 初期管理者でログインしたクライアントを返す（未作成なら作成する） */
export async function adminClient(): Promise<Client> {
  const c = new Client();
  const res = await c.post("/api/auth/setup", { token: SETUP_TOKEN, ...ADMIN });
  if (res.status === 201) return c;
  const login = await c.post("/api/auth/login", { email: ADMIN.email, password: ADMIN.password });
  if (login.status !== 200) throw new Error(`admin login failed: ${login.status}`);
  return c;
}

let counter = 0;
/** 管理者が招待したメンバーを登録してログイン済みクライアントを返す */
export async function memberClient(admin: Client, role: "member" | "admin" = "member") {
  counter += 1;
  const email = `user${counter}-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const sent = await admin.post("/api/admin/invites", { email, role });
  if (sent.status !== 201) throw new Error(`invite failed: ${sent.status} ${await sent.text()}`);
  const c = new Client();
  const res = await c.post("/api/auth/invite/accept", { token: tokenFrom(lastMail()), name: `メンバー${counter}`, password: "member-password-123" });
  if (res.status !== 201) throw new Error(`accept failed: ${res.status} ${await res.text()}`);
  const { user } = await json(res);
  return { client: c, user, email, password: "member-password-123" };
}

export async function createArticle(c: Client, data: { title?: string; body?: string; tags?: string[] } = {}) {
  const res = await c.post("/api/articles", { title: `記事-${crypto.randomUUID().slice(0, 8)}`, body: "本文", tags: [], ...data });
  if (res.status !== 201) throw new Error(`create failed: ${res.status} ${await res.text()}`);
  return (await json(res)).article;
}
