import { afterEach, describe, expect, it } from "vitest";
import { decorateMentions } from "../mentions";
import { renderMarkdown } from "../markdown";
import { zoomImage } from "../lightbox";

const USER = "11111111-2222-3333-4444-555555555555";

function render(html: string) {
  const root = document.createElement("div");
  root.className = "markdown";
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

const lightbox = () => document.querySelector<HTMLDialogElement>("dialog.lightbox");

afterEach(() => {
  document.body.innerHTML = "";
});

describe("画像の拡大", () => {
  it("本文の画像を押すと、同じ画像を大きい枠に出す", () => {
    const root = render(renderMarkdown("![図の説明](/api/attachments/abc)"));
    expect(zoomImage(root.querySelector("img"))).toBe(true);
    const dialog = lightbox()!;
    expect(dialog.getAttribute("aria-label")).toBe("図の説明");
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe("/api/attachments/abc");
    expect(dialog.querySelector("img")?.alt).toBe("図の説明");
    expect(dialog.querySelector(".lightbox-close")?.getAttribute("aria-label")).toBe("閉じる");
  });

  it("大きい画像を押すと閉じる。続けて別の画像を開いても枠は1つ", () => {
    const root = render(renderMarkdown("![一](/api/attachments/a)\n\n![二](https://example.com/b.png)"));
    const [first, second] = root.querySelectorAll("img");
    zoomImage(first!);
    zoomImage(second!);
    expect(document.querySelectorAll("dialog.lightbox")).toHaveLength(1);
    expect(lightbox()!.querySelector("img")?.getAttribute("src")).toBe("https://example.com/b.png");
    // 開いた枠の中の画像を押しても、もう1つ開かない
    expect(zoomImage(lightbox()!.querySelector("img"))).toBe(false);
    lightbox()!.dispatchEvent(new Event("close"));
    expect(lightbox()).toBeNull();
  });

  it("リンクの中の画像・人のアイコン・動画のサムネイル・本文の外の画像は開かない", () => {
    const members = [{ id: USER, name: "なかの", avatar_id: "av1", bio: "", article_count: 0 }];
    const root = render(
      decorateMentions(
        renderMarkdown(`[![図](/api/attachments/abc)](https://example.com)\n\n[@なかの](/users/${USER})\n\nhttps://youtu.be/jNQXAC9IVRw`),
        members,
      ),
    );
    const images = [...root.querySelectorAll("img")];
    expect(images).toHaveLength(3);
    for (const img of images) expect(zoomImage(img), img.outerHTML).toBe(false);

    const outside = document.createElement("img");
    outside.src = "/api/attachments/abc";
    document.body.append(outside);
    expect(zoomImage(outside)).toBe(false);
    expect(zoomImage(root)).toBe(false);
    expect(zoomImage(null)).toBe(false);
    expect(lightbox()).toBeNull();
  });
});
