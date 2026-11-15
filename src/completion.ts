import type { MarkupEdit } from "./markup";

/** 入力中の候補を出すきっかけ。from はきっかけの記号（[[ または @）の位置、query はそのあとに打った文字 */
export interface Trigger {
  kind: "article" | "member";
  from: number;
  query: string;
}

/** 候補の1件。記事はタイトル、メンバーは名前と ID */
export type Suggestion = { kind: "article"; title: string } | { kind: "member"; id: string; name: string; avatar_id: string | null };

/** きっかけを探すのは、カーソルの手前のこの文字数まで（記事タイトルの上限 200 に記号の分を足した長さ） */
const LOOK_BEHIND = 210;

/**
 * カーソルの手前が「[[ と書きかけのタイトル」か「@ と書きかけの名前」なら、そのきっかけを返す。
 * - [[ のあとに [ ] や改行があれば対象外（リンクを書き終えている）
 * - @ の直前が半角の英数字や記号のときは対象外（メールアドレスの途中）
 */
export function findTrigger(text: string, caret: number): Trigger | null {
  const start = Math.max(0, caret - LOOK_BEHIND);
  const before = text.slice(start, caret);
  const line = before.slice(before.lastIndexOf("\n") + 1);
  const lineStart = caret - line.length;

  const open = line.lastIndexOf("[[");
  if (open >= 0) {
    const query = line.slice(open + 2);
    if (!/[[\]]/.test(query)) return { kind: "article", from: lineStart + open, query };
  }
  const at = /(?:^|[^A-Za-z0-9._%+-])@([^\s@[\]()]{0,50})$/.exec(line);
  if (at) return { kind: "member", from: caret - at[1]!.length - 1, query: at[1]! };
  return null;
}

/** 名前の絞り込み用。全角半角・大文字小文字の違いを無視する */
export function matchKey(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

/**
 * 候補を選んだときの書き換え。きっかけからカーソルまでを、記事なら [[タイトル]]、メンバーなら [@名前](/users/<id>) に置き換える。
 * [[ のあとにすでに ]] があれば（かっこを先に閉じていた場合）、それも置き換えて二重にならないようにする
 */
export function applySuggestion(text: string, caret: number, trigger: Trigger, choice: Suggestion): MarkupEdit {
  if (choice.kind === "article") {
    const insert = `[[${choice.title}]]`;
    const to = text.startsWith("]]", caret) ? caret + 2 : caret;
    return { from: trigger.from, to, insert, selectFrom: trigger.from + insert.length, selectTo: trigger.from + insert.length };
  }
  // 名前の [ ] はリンクの文字を壊すので除く
  const insert = `[@${choice.name.replace(/[[\]]/g, "")}](/users/${choice.id}) `;
  return { from: trigger.from, to: caret, insert, selectFrom: trigger.from + insert.length, selectTo: trigger.from + insert.length };
}

/**
 * 本文欄の中で、index 文字目が表示される位置（欄の左上からの px。top は、その行の下端）。
 * 本文欄と同じ幅・文字の設定にした見えない要素に同じ文字を流し込んで測る
 */
export function caretOffset(el: HTMLTextAreaElement, index: number): { top: number; left: number } {
  const style = getComputedStyle(el);
  const mirror = document.createElement("div");
  const copied = [
    "boxSizing",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "borderStyle",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontFeatureSettings",
    "fontVariantLigatures",
    "lineHeight",
    "letterSpacing",
    "tabSize",
  ] as const;
  for (const prop of copied) mirror.style[prop] = style[prop];
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.top = "0";
  mirror.style.left = "-9999px";
  mirror.style.width = `${el.offsetWidth}px`;
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.textContent = el.value.slice(0, index);
  const marker = document.createElement("span");
  marker.textContent = "​";
  mirror.append(marker);
  document.body.append(mirror);
  const position = { top: marker.offsetTop + marker.offsetHeight - el.scrollTop, left: marker.offsetLeft };
  mirror.remove();
  return position;
}
