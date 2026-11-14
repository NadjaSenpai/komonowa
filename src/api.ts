export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", headers: {} };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["content-type"] = "application/json";
  }
  const res = await fetch(`/api${path}`, init);
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/")) window.dispatchEvent(new Event("wiki:unauthorized"));
    throw new ApiError(res.status, typeof data.error === "string" ? data.error : `エラーが発生しました（${res.status}）`, data);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

export interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  avatar_id: string | null;
}

export interface Article {
  id: string;
  title: string;
  body: string;
  version: number;
  tags: string[];
  created_at: number;
  updated_at: number;
  created_by: string;
  created_by_name: string;
  created_by_avatar: string | null;
  updated_by: string;
  updated_by_name: string;
  updated_by_avatar: string | null;
}

/** 本文の [[タイトル]] のリンク先。id が null なら「まだない記事」 */
export interface WikiLink {
  key: string;
  id: string | null;
}

/** この記事にリンクしている記事 */
export interface Backlink {
  id: string;
  title: string;
  updated_at: number;
}

export interface Attachment {
  id: string;
  filename: string;
  content_type: string;
  size: number;
  created_at: number;
  uploaded_by: string;
  uploaded_by_name: string;
}

export function formatDate(ms: number) {
  return new Date(ms).toLocaleString("ja-JP", { dateStyle: "medium", timeStyle: "short" });
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : "エラーが発生しました";
}
