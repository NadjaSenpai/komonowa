# チェックリストの付け外し Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 記事の表示画面で ☐／☑ をクリックやキーボードで付け外しでき、その状態を localStorage に記事ごと・項目の文字ごとに覚える。

**Architecture:** 状態の読み書きと DOM への反映は `src/taskChecks.ts` にまとめる。`ArticleViewPage` は描画後の本文要素にそれを当て、クリックとキー操作を拾う。本文・API・サーバーは変えない。

**Tech Stack:** React 19、TypeScript、vitest（jsdom）

**Spec:** `docs/superpowers/specs/2026-11-14-task-checks-design.md`

## Global Constraints

- localStorage のキー：`komonowa:task-checks:<記事ID>`。値は `{ "<項目の文字>#<同じ文字の何番目か>": boolean }` の JSON
- `title`：`このブラウザにだけ保存されます`。ボタンの文言：`チェックをすべて外す`
- localStorage の読み書きはすべて try/catch で包み、失敗しても画面上では切り替わる
- 付け外しは表示画面だけ。プレビューと履歴は変えない

## Review Focus

1. 同じ文字の項目が2つ（`- [ ] 牛乳` が2行）：片方だけ付く（Task 1）
2. 本文の編集で項目の順番が入れ替わる：覚えたチェックは文字についていく（Task 1）
3. localStorage が例外を投げる：画面上の切り替えは動き、例外は外に出ない（Task 1）
4. 保存した JSON が壊れている：本文どおりの状態で表示する（Task 1）
5. 入れ子のリスト（項目の下に子の項目）：親の項目の文字に子の文字を含めない（Task 1）

---

### Task 1: `src/taskChecks.ts`

**Files:**
- Create: `src/taskChecks.ts`
- Test: `src/__tests__/taskChecks.test.ts`

**Interfaces:**
- Produces:
  - `prepareTaskBoxes(root: ParentNode, articleId: string): void`：`.task-box` を操作できる形にし、覚えている状態を当てる
  - `toggleTaskBox(box: Element, root: ParentNode, articleId: string): void`：切り替えて覚える
  - `clearTaskChecks(root: ParentNode, articleId: string): void`：全項目を外して覚える
  - `anyTaskChecked(root: ParentNode): boolean`

- [ ] **Step 1: 失敗するテストを書く**（`renderMarkdown` の出力を `div` に入れて使う。各テストの前に `localStorage.clear()`）
  - `"操作できる形にする"`：`- [ ] 牛乳` の `.task-box` が `role="checkbox"`、`aria-checked="false"`、`tabindex="0"`、`title="このブラウザにだけ保存されます"`
  - `"切り替えると印・aria・done が変わり、覚える"`：切り替え後に `☑`、`aria-checked="true"`、`li.done`。localStorage の `komonowa:task-checks:a1` が `{"牛乳#0":true}`
  - `"同じ文字の項目は何番目かで区別する"`：`- [ ] 牛乳\n- [ ] 牛乳` の2つ目を切り替えると、1つ目は `false` のまま、記録は `{"牛乳#1":true}`
  - `"覚えた状態は順番が変わっても文字についていく"`：`- [ ] 牛乳\n- [ ] たまご` で牛乳を付ける。`- [ ] たまご\n- [ ] 牛乳` を描画して `prepareTaskBoxes` すると、牛乳だけが付いている
  - `"覚えていない項目は本文どおり、[x] も外せる"`：`- [x] 済み` は付いた状態。切り替えると外れ、`{"済み#0":false}`
  - `"すべて外す"`：2つ付けてから `clearTaskChecks` で、両方 `false`、`anyTaskChecked` が `false`
  - `"入れ子の子の文字は親の項目キーに含めない"`：`- [ ] 親\n  - [ ] 子` の親を切り替えると `{"親#0":true}`
  - `"localStorage が使えなくても切り替わる"`：`vi.spyOn(Storage.prototype, "getItem")` と `setItem` が例外を投げる状態で、`prepareTaskBoxes` と `toggleTaskBox` が例外を出さず、印が `☑` になる
  - `"壊れた記録は無視する"`：`localStorage.setItem("komonowa:task-checks:a1", "{壊れ")` の後でも、本文どおりに表示される

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/__tests__/taskChecks.test.ts` → FAIL（モジュールがない）

- [ ] **Step 3: 実装する**

項目の文字は、`li` を複製して `.task-box` と入れ子の `ul`・`ol` を取り除いた `textContent` を trim したもの。

- [ ] **Step 4: 通ることを確認する**

Run: `npx vitest run src/__tests__/taskChecks.test.ts` → PASS

- [ ] **Step 5: コミット**

```bash
git add src/taskChecks.ts src/__tests__/taskChecks.test.ts
git commit -m "feat: remember task list checks per article in localStorage"
```

---

### Task 2: 表示画面につなぐ

**Files:**
- Modify: `src/pages/ArticleViewPage.tsx`、`src/styles.css`、`README.md`（「記事」の行にチェックリストの一言）

**Interfaces:**
- Consumes: Task 1 の4つの関数

- [ ] **Step 1: 実装する**
  - 本文の `div` に ref を付け、`html` が変わるたびに `useEffect` で `prepareTaskBoxes` を呼び、`anyTaskChecked` の結果を state に入れる
  - 本文の `onClick`：`.task-box` なら `toggleTaskBox` して state を更新する。それ以外は既存の `onBodyClick`
  - 本文の `onKeyDown`：`.task-box` でスペースか Enter なら `preventDefault` して切り替える
  - state が `true` のとき、本文の直後に `<button type="button" className="link small">チェックをすべて外す</button>`
  - CSS：`.task-box[role="checkbox"]` は `cursor: pointer` とフォーカスリング。`li.done` は `color: var(--color-muted); text-decoration: line-through`

- [ ] **Step 2: 確認する**

Run: `npm run check` → typecheck、テスト、ビルドがすべて成功

- [ ] **Step 3: コミット**

```bash
git add src README.md
git commit -m "feat(ui): toggle task list checks on the article page"
```
