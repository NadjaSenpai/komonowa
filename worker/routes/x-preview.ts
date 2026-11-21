import { Hono } from "hono";
import { xPostUrl } from "../../shared/x-posts";
import type { AppEnv } from "../env";
import { fail } from "../http";
import { requireAuth } from "../session";

export const xPreview = new Hono<AppEnv>();

async function readOEmbed(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let json = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return JSON.parse(json + decoder.decode());
      size += value.byteLength;
      if (size > 64 * 1024) {
        await reader.cancel();
        return null;
      }
      json += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

xPreview.get("/", requireAuth, async (c) => {
  const url = xPostUrl(c.req.query("url") ?? "");
  if (!url) fail(400, "Xの投稿URLを指定してください");

  const endpoint = new URL("https://publish.x.com/oembed");
  endpoint.search = new URLSearchParams({ url, omit_script: "1", hide_thread: "1" }).toString();
  try {
    // Workers は redirect: "error" を受け付けない。転送レスポンスは readOEmbed で拒否する。
    const response = await fetch(endpoint, { redirect: "manual", signal: AbortSignal.timeout(4000) });
    const data = await readOEmbed(response);
    if (data && typeof data === "object" && "html" in data && typeof data.html === "string" && data.html) {
      return c.json({ html: data.html });
    }
  } catch {
    // 取得できない場合は記事の元のリンクを残す。
  }
  return c.json({ error: "Xの投稿を取得できませんでした" }, 502);
});
