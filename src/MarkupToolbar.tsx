import { useRef } from "react";
import type { MarkupAction } from "./markup";

/** ボタンのラベルと、マウスを乗せたときに見せる記号（記号を覚えてもらうため） */
const GROUPS: { action: MarkupAction; label: string; hint: string }[][] = [
  [
    { action: "heading", label: "見出し", hint: "見出し　## 見出し" },
    { action: "bold", label: "太字", hint: "太字　**文字**　Ctrl+B" },
    { action: "strike", label: "取り消し線", hint: "取り消し線　~~文字~~" },
    { action: "link", label: "リンク", hint: "リンク　[文字](https://…)　Ctrl+K" },
    { action: "page", label: "記事リンク", hint: "ほかの記事へのリンク　[[記事のタイトル]]" },
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
  const more = useRef<HTMLDetailsElement>(null);
  const buttons = GROUPS.flat();
  const primary = ["heading", "bold", "link", "bullet"];
  function renderButton(b: (typeof buttons)[number]) {
    return (
      <button
        key={b.action}
        type="button"
        className="secondary small"
        title={b.hint}
        aria-label={b.hint}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          onAction(b.action);
          if (more.current) more.current.open = false;
        }}
      >
        {b.label}
      </button>
    );
  }
  return (
    <div className="markup-toolbar" role="group" aria-label="書式">
      {primary.map((action) => renderButton(buttons.find((b) => b.action === action)!))}
      {!disabled && (
        <details
          className="markup-more"
          ref={more}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false;
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.currentTarget.open = false;
              e.currentTarget.querySelector("summary")?.focus();
            }
          }}
        >
          <summary>
            その他 <span aria-hidden="true">▾</span>
          </summary>
          <div className="markup-more-panel">{buttons.filter((b) => !primary.includes(b.action)).map(renderButton)}</div>
        </details>
      )}
    </div>
  );
}
