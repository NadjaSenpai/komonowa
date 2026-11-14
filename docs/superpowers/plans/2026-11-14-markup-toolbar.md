# マークアップツールバー Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 記事の編集画面の本文欄に、Markdown の記号を入れるボタン10個とショートカットを付け、入れたものを Ctrl+Z で取り消せるようにする。

**Architecture:** 記号の付け方は純粋な関数 `applyMarkup`（`src/markup.ts`）が「どこを何に置き換え、その後どこを選択するか」を返す。差し込みは `insertIntoTextarea` が `execCommand("insertText")` で行い、ブラウザ標準の取り消し履歴に載せる。動かなければ state を直接書き換える。ツールバーは `src/MarkupToolbar.tsx`。

**Tech Stack:** React 19、TypeScript、vitest（jsdom）

**Spec:** `docs/superpowers/specs/2026-11-14-markup-toolbar-design.md`

## Global Constraints

- ボタンの順とラベル：見出し、太字、取り消し線、リンク、ページ ｜ 箇条書き、番号、チェック、引用、コード
- `title` と `aria-label` に入る記号を含める（例：`太字　**文字**　Ctrl+B`）
- 選択なしのときに入れるお手本の文字：`太字`、`取り消し`、`リンクの文字`、`ページ名`、`コード`。お手本の部分を選択状態にする（リンクは URL の `https://` を選択）
- ショートカット：Ctrl+B／⌘B で太字、Ctrl+K／⌘K でリンク
- 斜体なし、記号を外すトグルなし
- プレビュータブでは押せない。押した後は本文欄にフォーカスを戻す
- 狭い画面では横スクロールにし、折り返さない

## Review Focus

1. 行をトリプルクリックすると、選択の終わりが次の行の先頭になる：次の行には記号を付けない（Task 1）
2. `太字 ` のように前後に空白を含む選択を囲む：`**太字 **` は太字にならないので、空白は記号の外に出す（Task 1）
3. 空行を含む複数行に箇条書き・番号・チェック・引用を付ける：空行には付けず、番号は空行を飛ばして続ける（Task 1）
4. 本文が空のときに見出しを押す：`## ` が入り、カーソルはその後ろ（Task 1）
5. 日本語入力の変換中に Ctrl+B を押す：変換中（`isComposing`）は何もしない（Task 2）

---

### Task 1: 記号の付け方 `applyMarkup`

**Files:**
- Create: `src/markup.ts`
- Test: `src/__tests__/markup.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type MarkupAction = "heading" | "bold" | "strike" | "link" | "page" | "bullet" | "numbered" | "task" | "quote" | "code";
  /** text の [from, to) を insert に置き換え、置き換え後の text で [selectFrom, selectTo) を選択する */
  export interface MarkupEdit { from: number; to: number; insert: string; selectFrom: number; selectTo: number }
  export function applyMarkup(action: MarkupAction, text: string, selStart: number, selEnd: number): MarkupEdit
  /** edit を text に当てた結果（テストとフォールバック用） */
  export function applyEdit(text: string, edit: MarkupEdit): string
  ```

- [ ] **Step 1: 失敗するテストを書く**

テストの補助として、`|` で選択範囲を示す文字列から `(text, start, end)` を作り、結果を同じ形式で返す関数を用意する（`"a|bc|d"` は `bc` を選択、`"ab|c"` はカーソルのみ）。`run(action, "…") === "…"` の形で書く：

| テスト名 | 入力 | 期待 |
|---|---|---|
| 太字：選択なしはお手本を選択 | `bold`, `"あ|い"` | `"あ**|太字|**い"` |
| 太字：選択を囲む | `bold`, `"|強調|です"` | `"**|強調|**です"` |
| 太字：前後の空白は外に出す | `bold`, `"|太字 |です"` | `"**|太字|** です"` |
| 取り消し線 | `strike`, `"|"` | `"~~|取り消し|~~"` |
| リンク：選択なし | `link`, `"|"` | `"[リンクの文字](|https://|)"` |
| リンク：選択を文字にする | `link`, `"|公式|"` | `"[公式](|https://|)"` |
| ページ | `page`, `"|"` / `"|手順書|"` | `"[[|ページ名|]]"` / `"[[|手順書|]]"` |
| 見出し：空の本文 | `heading`, `"|"` | `"## |"` |
| 見出し：今の行 | `heading`, `"一\n二|三\n四"` | `"一\n## 二|三\n四"`（カーソルは記号の分だけ後ろへ） |
| 箇条書き：選択した各行、空行は飛ばす | `bullet`, `"|a\n\nb|"` | `"|- a\n\n- b|"`（選択は書き換えた行全体） |
| 箇条書き：終わりが次の行頭なら次の行は含めない | `bullet`, `"|a\n|b"` | `"|- a\n|b"` |
| 番号：空行を飛ばして連番 | `numbered`, `"|a\n\nb\nc|"` | `"|1. a\n\n2. b\n3. c|"` |
| チェック | `task`, `"|a|"` | `"|- [ ] a|"` |
| 引用 | `quote`, `"|a\nb|"` | `"|> a\n> b|"` |
| コード：1行内 | `code`, `"x |y| z"` | `` "x `|y|` z" `` |
| コード：選択なし | `code`, `"|"` | `` "`|コード|`" `` |
| コード：複数行は囲み | `code`, `"|a\nb|"` | ```` "```\n|a\nb|\n```" ```` |

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/__tests__/markup.test.ts`
Expected: FAIL（モジュールがない）

- [ ] **Step 3: `src/markup.ts` を実装する**

行に付ける操作（heading・bullet・numbered・task・quote）とコードの囲みは、選択を行単位に広げてから処理する。終わりが行頭で、かつ選択が空でないときは、その行を含めない。置き換えるのは広げた範囲だけにする（本文全体を置き換えると取り消しの単位が大きくなる）。

- [ ] **Step 4: 通ることを確認する**

Run: `npx vitest run src/__tests__/markup.test.ts` → PASS

- [ ] **Step 5: コミット**

```bash
git add src/markup.ts src/__tests__/markup.test.ts
git commit -m "feat: compute Markdown markup edits for the editor toolbar"
```

---

### Task 2: ツールバーと差し込み

**Files:**
- Create: `src/MarkupToolbar.tsx`
- Modify: `src/markup.ts`（`insertIntoTextarea` を追加）、`src/pages/ArticleEditPage.tsx`、`src/styles.css`
- Test: `src/__tests__/markup.test.ts`

**Interfaces:**
- Consumes: `applyMarkup`、`applyEdit`、`MarkupAction`、`MarkupEdit`（Task 1）
- Produces:
  - `insertIntoTextarea(el: HTMLTextAreaElement, edit: MarkupEdit, fallback: (next: string) => void): void`：`el` に focus し、`[from, to)` を選択して `document.execCommand("insertText", false, insert)` を呼ぶ。`execCommand` がない、または `false` を返した場合は `fallback(applyEdit(el.value, edit))` を呼ぶ。最後に `[selectFrom, selectTo)` を選択する（フォールバック時は、描画の後に `requestAnimationFrame` で選択する）
  - `markupShortcut(e: KeyboardEvent | React.KeyboardEvent): MarkupAction | null`：Ctrl／⌘ と B で `"bold"`、K で `"link"`。Shift／Alt 付きや `isComposing` のときは `null`
  - `<MarkupToolbar disabled={boolean} onAction={(action: MarkupAction) => void} />`

- [ ] **Step 1: 失敗するテストを書く**（jsdom には `execCommand` がないので、フォールバックの経路を確かめる）

- `"execCommand が使えなければ fallback に書き換え後の本文を渡す"`：`value = "ab"` の textarea に `{ from: 1, to: 1, insert: "X", selectFrom: 2, selectTo: 2 }` を当てると、`fallback` が `"aXb"` で1回呼ばれる
- `"ショートカット"`：`{ ctrlKey: true, key: "b" }` は `"bold"`、`{ metaKey: true, key: "k" }` は `"link"`、`{ ctrlKey: true, shiftKey: true, key: "b" }` は `null`、`{ ctrlKey: true, key: "b", isComposing: true }` は `null`、`{ key: "b" }` は `null`

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/__tests__/markup.test.ts` → 新しいテストが FAIL

- [ ] **Step 3: 実装する**

- `insertIntoTextarea` と `markupShortcut` を `src/markup.ts` に追加する
- `MarkupToolbar`：Global Constraints の順・ラベル・`title`・`aria-label` でボタンを並べる。前半と後半の間に仕切りを入れる。`role="toolbar"`、`aria-label="書式"`。ボタンの `onMouseDown` で `preventDefault` して、本文欄の選択を保つ
- `ArticleEditPage`：`editor-bar` の下に置き、`disabled={tab !== "edit"}` にする。`onAction` では `textarea.current` と `applyMarkup` と `insertIntoTextarea` を使い、フォールバックは `setBody`。本文欄の `onKeyDown` で `markupShortcut` が値を返したら、`preventDefault` して同じ処理をする
- CSS：`.markup-toolbar` は `display: flex; overflow-x: auto; flex-wrap: nowrap`。ボタンは既存の `.secondary.small` に合わせ、`white-space: nowrap`

- [ ] **Step 4: 通ることを確認する**

Run: `npm run check` → typecheck、テスト、ビルドがすべて成功

- [ ] **Step 5: 実際の画面で確かめる**

`npm run dev` で、各ボタンが表どおりに入ること、Ctrl+Z で1回ずつ戻ることを見る（ブラウザツールがなければ省略し、報告に書く）

- [ ] **Step 6: コミット**

```bash
git add src
git commit -m "feat(ui): add a Markdown toolbar to the article editor"
```
