import { afterEach, describe, expect, it, vi } from "vitest";
import { Client, adminClient, memberClient } from "./helpers";

const post = "https://x.com/Interior/status/463440424141459456";
const preview = (url: string) => `/api/x-preview?url=${encodeURIComponent(url)}`;
const html = '<blockquote class="twitter-tweet"><p>公開投稿</p></blockquote>';

afterEach(() => vi.restoreAllMocks());

describe("Xの投稿プレビュー", () => {
  it("ログインしていない場合は取得しない", async () => {
    const fetchPost = vi.spyOn(globalThis, "fetch");
    expect((await new Client().get(preview(post))).status).toBe(401);
    expect(fetchPost).not.toHaveBeenCalled();
  });

  it("管理者とメンバーが、投稿URLから引用HTMLを取得できる", async () => {
    const admin = await adminClient();
    const { client: member } = await memberClient(admin);
    const fetchPost = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ html, author_name: "Interior" }));
    for (const client of [admin, member]) {
      const response = await client.get(preview(post.replace("x.com", "twitter.com") + "?s=20#post"));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ html });
    }
    expect(fetchPost).toHaveBeenCalledTimes(2);
    const [request, options] = fetchPost.mock.calls[0]!;
    const endpoint = new URL(String(request));
    expect(endpoint.origin + endpoint.pathname).toBe("https://publish.x.com/oembed");
    expect(Object.fromEntries(endpoint.searchParams)).toEqual({ url: post, omit_script: "1", hide_thread: "1" });
    expect(options?.redirect).toBe("error");
  });

  it("投稿以外のURLを拒否し、Xで取得できない場合はエラーを返す", async () => {
    const admin = await adminClient();
    const fetchPost = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(null, { status: 404 }));
    for (const url of ["https://x.com.evil.example/Interior/status/1", "https://x.com/Interior", "https://x.com@evil.example/Interior/status/1"]) {
      expect((await admin.get(preview(url))).status).toBe(400);
    }
    expect(fetchPost).not.toHaveBeenCalled();
    expect((await admin.get(preview(post))).status).toBe(502);
  });
});
