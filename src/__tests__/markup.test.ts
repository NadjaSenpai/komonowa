import { describe, expect, it } from "vitest";
import { applyEdit, applyMarkup, type MarkupAction } from "../markup";

/** "a|bc|d" は bc を選択、"ab|c" はカーソルだけ。結果も同じ形式で返す */
function run(action: MarkupAction, marked: string): string {
  const first = marked.indexOf("|");
  const second = marked.indexOf("|", first + 1);
  const text = marked.replaceAll("|", "");
  const start = first;
  const end = second < 0 ? first : second - 1;
  const edit = applyMarkup(action, text, start, end);
  const next = applyEdit(text, edit);
  if (edit.selectFrom === edit.selectTo) return next.slice(0, edit.selectFrom) + "|" + next.slice(edit.selectFrom);
  return next.slice(0, edit.selectFrom) + "|" + next.slice(edit.selectFrom, edit.selectTo) + "|" + next.slice(edit.selectTo);
}

describe("applyMarkup：囲む記号", () => {
  it("太字：選択なしはお手本を選択", () => expect(run("bold", "あ|い")).toBe("あ**|太字|**い"));
  it("太字：選択を囲む", () => expect(run("bold", "|強調|です")).toBe("**|強調|**です"));
  it("太字：前後の空白は外に出す", () => expect(run("bold", "|太字 |です")).toBe("**|太字|** です"));
  it("取り消し線", () => expect(run("strike", "|")).toBe("~~|取り消し|~~"));
  it("リンク：選択なし", () => expect(run("link", "|")).toBe("[リンクの文字](|https://|)"));
  it("リンク：選択を文字にする", () => expect(run("link", "|公式|")).toBe("[公式](|https://|)"));
  it("ページ", () => {
    expect(run("page", "|")).toBe("[[|ページ名|]]");
    expect(run("page", "|手順書|")).toBe("[[|手順書|]]");
  });
  it("コード：1行内", () => expect(run("code", "x |y| z")).toBe("x `|y|` z"));
  it("コード：選択なし", () => expect(run("code", "|")).toBe("`|コード|`"));
  it("コード：複数行は囲み", () => expect(run("code", "|a\nb|")).toBe("```\n|a\nb|\n```"));
});

describe("applyMarkup：行に付ける記号", () => {
  it("見出し：空の本文", () => expect(run("heading", "|")).toBe("## |"));
  it("見出し：今の行", () => expect(run("heading", "一\n二|三\n四")).toBe("一\n## 二|三\n四"));
  it("箇条書き：選択した各行、空行は飛ばす", () => expect(run("bullet", "|a\n\nb|")).toBe("|- a\n\n- b|"));
  it("箇条書き：終わりが次の行頭なら次の行は含めない", () => expect(run("bullet", "|a\n|b")).toBe("|- a\n|b"));
  it("番号：空行を飛ばして連番", () => expect(run("numbered", "|a\n\nb\nc|")).toBe("|1. a\n\n2. b\n3. c|"));
  it("チェック", () => expect(run("task", "|a|")).toBe("|- [ ] a|"));
  it("引用", () => expect(run("quote", "|a\nb|")).toBe("|> a\n> b|"));
});
