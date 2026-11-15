import { describe, expect, it } from "vitest";
import { fallbackThumbnail, playVideo, youtubeVideo } from "../embeds";
import { markdownToText, renderMarkdown } from "../markdown";

const ID = "jNQXAC9IVRw";

function render(markdown: string) {
  const root = document.createElement("div");
  root.innerHTML = renderMarkdown(markdown);
  return root;
}

describe("youtubeVideo", () => {
  it("いろいろな形の URL から動画 ID を取り出す", () => {
    for (const url of [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtube.com/watch?v=${ID}&list=PL123`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}`,
      `https://youtu.be/${ID}?si=abc`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/live/${ID}`,
      `https://www.youtube.com/embed/${ID}`,
    ]) {
      expect(youtubeVideo(url), url).toEqual({ id: ID, start: 0 });
    }
  });

  it("開始位置を秒にする", () => {
    expect(youtubeVideo(`https://youtu.be/${ID}?t=90`)?.start).toBe(90);
    expect(youtubeVideo(`https://www.youtube.com/watch?v=${ID}&t=1m30s`)?.start).toBe(90);
    expect(youtubeVideo(`https://www.youtube.com/watch?v=${ID}&t=1h2m3s`)?.start).toBe(3723);
    expect(youtubeVideo(`https://www.youtube.com/embed/${ID}?start=12`)?.start).toBe(12);
    expect(youtubeVideo(`https://youtu.be/${ID}?t=abc`)?.start).toBe(0);
  });

  it("動画でない URL や、ほかのサイトは null", () => {
    for (const url of [
      "https://www.youtube.com/",
      "https://www.youtube.com/@channel",
      "https://www.youtube.com/playlist?list=PL123",
      "https://www.youtube.com/watch?v=short",
      `https://www.youtube.com/watch?v=${ID}"onload=`,
      `https://youtube.com.evil.example/watch?v=${ID}`,
      `https://evil.example/watch?v=${ID}`,
      `javascript:alert(1)//youtu.be/${ID}`,
      "youtu.be",
    ]) {
      expect(youtubeVideo(url), url).toBeNull();
    }
  });
});

describe("動画の枠", () => {
  it("YouTube の URL だけの行を、サムネイルと再生ボタンの枠にする", () => {
    const root = render(`前の文\n\nhttps://youtu.be/${ID}?t=90\n\n後の文`);
    const box = root.querySelector<HTMLElement>(".video-embed")!;
    expect(box.dataset.youtube).toBe(ID);
    expect(box.dataset.start).toBe("90");
    expect(box.querySelector("button.video-play")?.getAttribute("aria-label")).toBe("YouTube の動画を再生");
    expect(box.querySelector("img")?.getAttribute("src")).toBe(`https://i.ytimg.com/vi/${ID}/maxresdefault.jpg`);
    // 再生できないときのために、YouTube へのリンクも残す
    const link = box.querySelector("a")!;
    expect(link.getAttribute("href")).toBe(`https://youtu.be/${ID}?t=90`);
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    // 押すまでプレーヤーは入れない
    expect(root.querySelector("iframe")).toBeNull();
    expect(root.querySelectorAll("p")).toHaveLength(2);
  });

  it("文中の URL や、文字を付けたリンクは、ふつうのリンクのまま", () => {
    for (const markdown of [
      `この動画 https://youtu.be/${ID} を見て`,
      `[動画](https://youtu.be/${ID})`,
      `https://youtu.be/${ID}\n続きの行`,
      `- https://youtu.be/${ID}`,
      "https://example.com/watch?v=jNQXAC9IVRw",
    ]) {
      const root = render(markdown);
      expect(root.querySelector(".video-embed"), markdown).toBeNull();
      expect(root.querySelector("a"), markdown).not.toBeNull();
    }
  });

  it("本文に書いた iframe や枠の HTML からは、プレーヤーを作らない", () => {
    const root = render(
      `<iframe src="https://www.youtube-nocookie.com/embed/${ID}"></iframe>\n\n<div class="video-embed" data-youtube="x&quot;><script>alert(1)</script>"><button class="video-play">再生</button></div>`,
    );
    expect(root.querySelector("iframe")).toBeNull();
    expect(playVideo(root.querySelector(".video-play"))).toBe(false);
    expect(document.querySelector("iframe")).toBeNull();
    expect(root.innerHTML).not.toContain("<script");
  });

  it("再生ボタンを押すと、画面いっぱいの枠にプレーヤーを出す。閉じるとプレーヤーごと消える", () => {
    const root = render(`https://youtu.be/${ID}?t=90`);
    document.body.append(root);
    // サムネイルの上を押しても効く
    expect(playVideo(root.querySelector(".video-play img"))).toBe(true);
    const dialog = document.querySelector<HTMLDialogElement>("dialog.lightbox")!;
    expect(dialog.getAttribute("aria-label")).toBe("YouTube の動画");
    const frame = dialog.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe(`https://www.youtube-nocookie.com/embed/${ID}?autoplay=1&start=90`);
    expect(frame.getAttribute("referrerpolicy")).toBe("strict-origin-when-cross-origin");
    expect(frame.title).toBe("YouTube の動画");
    // 本文の枠はそのまま残るので、閉じたあとにもう一度再生できる
    expect(root.querySelector(".video-play")).not.toBeNull();
    expect(root.querySelector("iframe")).toBeNull();

    dialog.querySelector<HTMLButtonElement>(".lightbox-close")!.click();
    dialog.dispatchEvent(new Event("close"));
    expect(document.querySelector("dialog.lightbox")).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
    root.remove();
  });

  it("大きいサムネイルが無い動画では、小さい版に替える", () => {
    const root = render(`https://youtu.be/${ID}\n\n![図](https://example.com/a.png)`);
    const thumb = root.querySelector<HTMLImageElement>(".video-play img")!;
    const width = (value: number) => Object.defineProperty(thumb, "naturalWidth", { value, configurable: true });
    // 大きい版が読めたときはそのまま
    width(1280);
    expect(fallbackThumbnail(thumb)).toBe(false);
    // 無いときは 120×90 の灰色の画像が返る
    width(120);
    expect(fallbackThumbnail(thumb)).toBe(true);
    expect(thumb.getAttribute("src")).toBe(`https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
    // 小さい版も読めなくても、繰り返さない
    width(0);
    expect(fallbackThumbnail(thumb)).toBe(false);
    // 本文のほかの画像には触らない
    expect(fallbackThumbnail(root.querySelector("p img"))).toBe(false);
  });

  it("枠の外を押しても何もしない", () => {
    const root = render(`文\n\nhttps://youtu.be/${ID}`);
    expect(playVideo(root.querySelector("p"))).toBe(false);
    expect(playVideo(root.querySelector(".video-embed a"))).toBe(false);
    expect(playVideo(null)).toBe(false);
    expect(root.querySelector("iframe")).toBeNull();
  });

  it("一覧の抜粋には動画の枠の文字を入れない", () => {
    expect(markdownToText(`はじめ\n\nhttps://youtu.be/${ID}\n\nおわり`)).toBe("はじめ おわり");
  });
});

describe("ほかのサイトの画像", () => {
  it("画像の URL だけの行は、その画像にする", () => {
    for (const url of ["https://example.com/a.png", "https://example.com/photo.JPG?size=large", "https://example.com/x/y.webp#top"]) {
      const root = render(`前の文\n\n${url}\n\n後の文`);
      expect(root.querySelector("p > img")?.getAttribute("src"), url).toBe(url);
      expect(root.querySelector("a"), url).toBeNull();
    }
  });

  it("文中の URL・画像でない URL・http の URL は、リンクのまま", () => {
    for (const markdown of [
      "この画像 https://example.com/a.png を見て",
      "[画像](https://example.com/a.png)",
      "https://example.com/a.png\n続きの行",
      "https://example.com/a.pdf",
      "https://example.com/png",
      "https://example.com/page?file=a.png",
      "http://example.com/a.png",
    ]) {
      const root = render(markdown);
      expect(root.querySelector("img"), markdown).toBeNull();
      expect(root.querySelector("a"), markdown).not.toBeNull();
    }
  });

  it("https の画像はそのまま表示する", () => {
    expect(renderMarkdown("![図](https://example.com/a.png)")).toContain('<img src="https://example.com/a.png" alt="図">');
  });
});
