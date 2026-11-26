import { describe, expect, it } from "vitest";
import { convertCosensePage, cosenseTitle, parseCosenseExport } from "./cosense";

const page = (lines: string[]) => ({ title: "t", created: 1, updated: 2, lines });
const body = (...lines: string[]) => convertCosensePage(page(lines)).body;

describe("convertCosensePage", () => {
  it("[ページ] を [[ページ]] にし、名前の半角 [ ] は全角にする", () => {
    expect(body("見て [ページ] を")).toBe("見て [[ページ]] を");
  });

  it("[[太字]] は太字にして、リンクにしない", () => {
    expect(body("[[太字]] と [リンク]")).toBe("**太字** と [[リンク]]");
  });

  it("装飾の記法を Markdown にする", () => {
    expect(body("[* 太]")).toBe("**太**");
    expect(body("[** 見出し]")).toBe("### 見出し");
    expect(body("[**** 大]")).toBe("## 大");
    expect(body("a [/ 斜] b")).toBe("a *斜* b");
    expect(body("a [- 消] b")).toBe("a ~~消~~ b");
    expect(body("a [*/ 両] b")).toBe("a ***両*** b");
  });

  it("字下げを箇条書きにする", () => {
    expect(body(" a", "\t\tb")).toBe("- a\n  - b");
  });

  it("URL を画像・動画・リンクにする", () => {
    expect(body("[https://gyazo.com/abc]")).toBe("![](https://gyazo.com/abc)");
    expect(body("[https://example.com/x.png]")).toBe("![](https://example.com/x.png)");
    expect(body("[https://www.youtube.com/watch?v=abcdefghijk]")).toBe("https://www.youtube.com/watch?v=abcdefghijk");
    expect(body("[https://example.com]")).toBe("<https://example.com>");
    expect(body("[説明 https://e.com]")).toBe("[説明](https://e.com)");
    expect(body("[https://e.com 説明]")).toBe("[説明](https://e.com)");
  });

  it("別プロジェクトへのリンクは Cosense の URL にする", () => {
    expect(body("[/proj/ページ]")).toBe("[/proj/ページ](https://scrapbox.io/proj/%E3%83%9A%E3%83%BC%E3%82%B8)");
    expect(body("[/proj]")).toBe("[/proj](https://scrapbox.io/proj)");
  });

  it("ハッシュタグを記事のタグにし、タグだけの行は本文から消す", () => {
    const r = convertCosensePage(page(["本文 #メモ です", "#a #[b c]"]));
    expect(r.body).toBe("本文 #メモ です");
    expect(r.tags).toEqual(["メモ", "a", "b c"]);
  });

  it("タグは 20 個まで", () => {
    const r = convertCosensePage(page([Array.from({ length: 25 }, (_, i) => `#t${i}`).join(" ")]));
    expect(r.tags).toHaveLength(20);
  });

  it("アイコンの記法は消す", () => {
    expect(body("なるほど[Nadja.icon]", "[x.icon*3]ok")).toBe("なるほど\nok");
  });

  it("code: をコードブロックにし、中は変換しない", () => {
    expect(body("code:a.ts", " const x = [y] #z", "後")).toBe("```ts\nconst x = [y] #z\n```\n後");
  });

  it("table: を表にする", () => {
    expect(body("table:t", " 名前\t数", " りんご\t3")).toBe("| 名前 | 数 |\n| --- | --- |\n| りんご | 3 |");
  });

  it("引用・コマンド・数式", () => {
    expect(body("> 引用")).toBe("> 引用");
    expect(body("$ ls -a")).toBe("`ls -a`");
    expect(body("式 [$ x^2] です")).toBe("式 `x^2` です");
  });

  it("本文の先頭と末尾の空行は除く", () => {
    expect(body("", "", "本文", "", " a", "")).toBe("本文\n\n- a");
  });

  it("インラインコードの中は変換しない", () => {
    expect(body("`[a]` と [b]")).toBe("`[a]` と [[b]]");
  });

  it("日付をミリ秒にし、画像の数を数える", () => {
    const r = convertCosensePage({ title: "t", created: 1, updated: 2, lines: ["[https://gyazo.com/a]", "[https://e.com/b.jpg]"] });
    expect(r.created).toBe(1000);
    expect(r.updated).toBe(2000);
    expect(r.images).toBe(2);
  });

  it("タイトルの半角 [ ] を全角にする", () => {
    expect(convertCosensePage({ ...page([]), title: "a[b]" }).title).toBe("a［b］");
  });
});

describe("cosenseTitle", () => {
  it("半角 [ ] を全角にして、200 文字で切る", () => {
    expect(cosenseTitle(" a[b] ")).toBe("a［b］");
    expect(cosenseTitle("あ".repeat(250))).toHaveLength(200);
  });
});

describe("parseCosenseExport", () => {
  it("メタデータあり・なしの両方を読み、1 行目（タイトル）を除く", () => {
    const withMeta = { pages: [{ title: "T", created: 1, updated: 2, lines: [{ text: "T" }, { text: "本文" }] }] };
    const plain = { pages: [{ title: "T", created: 1, updated: 2, lines: ["T", "本文"] }] };
    const expected = [{ title: "T", created: 1, updated: 2, lines: ["本文"] }];
    expect(parseCosenseExport(withMeta)).toEqual(expected);
    expect(parseCosenseExport(plain)).toEqual(expected);
  });

  it("形が違えば null", () => {
    expect(parseCosenseExport({})).toBeNull();
    expect(parseCosenseExport({ pages: "x" })).toBeNull();
    expect(parseCosenseExport({ pages: [{ title: 1 }] })).toBeNull();
    expect(parseCosenseExport(null)).toBeNull();
  });
});
