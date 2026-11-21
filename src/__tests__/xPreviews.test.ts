import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { renderMarkdown } from "../markdown";
import { expandXPreviews } from "../xPreviews";

const url = "https://x.com/example/status/123";

afterEach(() => vi.restoreAllMocks());

describe("記事内のXプレビュー", () => {
  it("単独のリンクを、改行と投稿元リンクのある引用にする", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue({
      html: '<blockquote class="twitter-tweet"><p>海 &amp; 空<br>続き <a href="https://x.com/example">@example</a><script>bad()</script></p> — 投稿者</blockquote>',
      authorName: "投稿者 <名前>",
      authorHandle: "example",
    });
    const body = document.createElement("div");
    body.innerHTML = renderMarkdown(`https://youtu.be/dQw4w9WgXcQ\n\n${url}\n\n[投稿](${url}?s=20)\n\n参照先は ${url}`);
    const cleanup = expandXPreviews(body);
    await vi.waitFor(() => expect(body.querySelectorAll("blockquote")).toHaveLength(2));
    expect(get).toHaveBeenCalledTimes(1);
    expect(body.querySelector("blockquote p")?.textContent).toBe("投稿者 <名前> @example");
    expect(body.querySelector("blockquote strong")?.textContent).toBe("投稿者 <名前>");
    expect(body.querySelector("blockquote .x-post-text")?.textContent).toBe("海 & 空\n続き @example");
    expect(body.querySelector("blockquote a")?.getAttribute("href")).toBe(url);
    expect(body.querySelector("blockquote script")).toBeNull();
    expect(body.querySelector(".video-embed button")).not.toBeNull();
    expect(body.lastElementChild?.textContent).toBe(`参照先は ${url}`);
    cleanup();
    expect(body.querySelector("blockquote")).toBeNull();
    expect(body.querySelectorAll("p a")).toHaveLength(3);
  });

  it("取得できない投稿のリンクを残す", async () => {
    const get = vi.spyOn(api, "get").mockRejectedValue(new Error("unavailable"));
    const body = document.createElement("div");
    body.innerHTML = renderMarkdown(url);
    const cleanup = expandXPreviews(body);
    await expect(get.mock.results[0]?.value).rejects.toThrow("unavailable");
    expect(body.querySelector("a")?.getAttribute("href")).toBe(url);
    cleanup();
  });
});
