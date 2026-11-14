/** 編集画面のツールバーで入れる Markdown の記号（docs/superpowers/specs/2026-11-14-markup-toolbar-design.md） */
export type MarkupAction = "heading" | "bold" | "strike" | "link" | "page" | "bullet" | "numbered" | "task" | "quote" | "code";

/** text の [from, to) を insert に置き換え、置き換え後の text で [selectFrom, selectTo) を選択する */
export interface MarkupEdit {
  from: number;
  to: number;
  insert: string;
  selectFrom: number;
  selectTo: number;
}

/** edit を text に当てた結果 */
export function applyEdit(text: string, edit: MarkupEdit): string {
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}

/** 文字を囲む記号。選択がなければお手本の文字を入れて、その部分を選択する */
const WRAPS = {
  bold: { open: "**", close: "**", sample: "太字" },
  strike: { open: "~~", close: "~~", sample: "取り消し" },
  page: { open: "[[", close: "]]", sample: "ページ名" },
  code: { open: "`", close: "`", sample: "コード" },
} as const;

/** 行頭に付ける記号。番号は行ごとに数える */
const LINE_PREFIXES: Record<"heading" | "bullet" | "task" | "quote" | "numbered", (n: number) => string> = {
  heading: () => "## ",
  bullet: () => "- ",
  task: () => "- [ ] ",
  quote: () => "> ",
  numbered: (n) => `${n}. `,
};

/** 選択を行単位に広げる。終わりが行頭なら（行のトリプルクリックなど）その行は含めない */
function lineRange(text: string, start: number, end: number) {
  const from = text.lastIndexOf("\n", start - 1) + 1;
  const last = end > start && text[end - 1] === "\n" ? end - 1 : end;
  const next = text.indexOf("\n", last);
  return { from, to: next < 0 ? text.length : next };
}

export function applyMarkup(action: MarkupAction, text: string, selStart: number, selEnd: number): MarkupEdit {
  const selected = text.slice(selStart, selEnd);

  if (action === "code" && selected.includes("\n")) {
    const { from, to } = lineRange(text, selStart, selEnd);
    const block = text.slice(from, to);
    return { from, to, insert: "```\n" + block + "\n```", selectFrom: from + 4, selectTo: from + 4 + block.length };
  }

  if (action in LINE_PREFIXES) {
    const prefix = LINE_PREFIXES[action as keyof typeof LINE_PREFIXES];
    const { from, to } = lineRange(text, selStart, selEnd);
    const lines = text.slice(from, to).split("\n");
    let n = 0;
    // 複数行のときは空行に付けない（番号も空行を飛ばして続ける）
    const insert = lines.map((line) => (lines.length > 1 && line.trim() === "" ? line : prefix(++n) + line)).join("\n");
    const added = insert.length - (to - from);
    if (selStart === selEnd) {
      const cursor = selStart + prefix(1).length;
      return { from, to, insert, selectFrom: cursor, selectTo: cursor };
    }
    return { from, to, insert, selectFrom: from, selectTo: selEnd + added };
  }

  // 囲む記号：前後の空白は記号の外に出す（"**太字 **" は太字にならないため）
  const lead = selected.length - selected.trimStart().length;
  const inner = selected.trim();
  const from = inner ? selStart + lead : selStart;
  const to = inner ? from + inner.length : selEnd;

  if (action === "link") {
    const label = inner || "リンクの文字";
    const urlAt = from + label.length + 3;
    return { from, to, insert: `[${label}](https://)`, selectFrom: urlAt, selectTo: urlAt + "https://".length };
  }

  const wrap = WRAPS[action as keyof typeof WRAPS];
  const body = inner || wrap.sample;
  const at = from + wrap.open.length;
  return { from, to, insert: wrap.open + body + wrap.close, selectFrom: at, selectTo: at + body.length };
}
