import type { MarkupAction } from "./markup";

/** ボタンのラベルと、マウスを乗せたときに見せる記号（記号を覚えてもらうため） */
const GROUPS: { action: MarkupAction; label: string; hint: string }[][] = [
  [
    { action: "heading", label: "見出し", hint: "見出し　## 見出し" },
    { action: "bold", label: "太字", hint: "太字　**文字**　Ctrl+B" },
    { action: "strike", label: "取り消し線", hint: "取り消し線　~~文字~~" },
    { action: "link", label: "リンク", hint: "リンク　[文字](https://…)　Ctrl+K" },
    { action: "page", label: "ページ", hint: "ほかの記事へのリンク　[[記事のタイトル]]" },
  ],
  [
    { action: "bullet", label: "箇条書き", hint: "箇条書き　- 項目" },
    { action: "numbered", label: "番号", hint: "番号付きリスト　1. 項目" },
    { action: "task", label: "チェック", hint: "チェックリスト　- [ ] 項目" },
    { action: "quote", label: "引用", hint: "引用　> 文章" },
    { action: "code", label: "コード", hint: "コード　`コード`（複数行は ``` で囲む）" },
  ],
];

/** 本文欄の上に並べる書式ボタン。押すと Markdown の記号がそのまま本文に入る */
export function MarkupToolbar({ disabled, onAction }: { disabled: boolean; onAction: (action: MarkupAction) => void }) {
  return (
    <div className="markup-toolbar" role="toolbar" aria-label="書式">
      {GROUPS.map((group, i) => (
        <div key={i} className="markup-group">
          {group.map((b) => (
            <button
              key={b.action}
              type="button"
              className="secondary small"
              title={b.hint}
              aria-label={b.hint}
              disabled={disabled}
              // 押したときに本文欄の選択が外れないようにする
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onAction(b.action)}
            >
              {b.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
