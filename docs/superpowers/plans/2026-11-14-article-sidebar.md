# 記事画面の右欄と目次 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 記事の表示画面を、広い画面では「本文＋右欄（目次・被リンク・添付）」の2列、狭い画面では1列にし、見出しから目次を作る。

**Architecture:** 目次づくりは `src/toc.ts` の `buildToc`（描画済み HTML に見出しの id を付け、目次の項目を返す）。`ArticleViewPage` は本文の HTML をこれに通し、本文の列と `<aside>` の2つに分けて描く。並びと2列化は CSS のグリッドとメディアクエリで行う。

**Tech Stack:** React 19、TypeScript、vitest（jsdom）、CSS

**Spec:** `docs/superpowers/specs/2026-11-14-article-sidebar-design.md`

## Global Constraints

- 2列にする幅：1000px 以上。本文の列は最大 760px、右欄は 270px 前後
- 目次は `#`〜`###`、見出しが2つ以上のときだけ。id は `h-1`、`h-2`…（出現順、サニタイズの後で付ける）
- 狭い画面の目次は `<details>`（最初は閉じる）で本文の上。見出しの文言は「目次」
- 編集画面・プレビュー・履歴は変えない

## Review Focus

1. 見出しのない記事・見出しが1つの記事：目次の欄も `<details>` も出ない（Task 2）
2. `####` 以下の見出し：目次に入れない（Task 1）
3. 同じ文言の見出しが2つ：別の id になり、それぞれへ飛べる（Task 1）
4. 見出しの中のリンクや強調（`## [[手順書]] の **注意**`）：目次には文字だけが出る（Task 1）
5. 本文を書き換えて読み込み直す：id と目次が作り直される（`html` から毎回作るので Task 2 の作りで満たす）

---

### Task 1: `buildToc`

**Files:**
- Create: `src/toc.ts`
- Test: `src/__tests__/toc.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface TocItem { id: string; text: string; level: 1 | 2 | 3 }
  export function buildToc(html: string): { html: string; toc: TocItem[] }
  ```

- [ ] **Step 1: 失敗するテストを書く**（入力は `renderMarkdown(...)` の出力）
  - `"見出しに h-1 から順に id を付け、目次を返す"`：`# A\n\n## B\n\n### C` → `toc` が `[{id:"h-1",text:"A",level:1},{id:"h-2",text:"B",level:2},{id:"h-3",text:"C",level:3}]`、返した HTML に `<h2 id="h-2">`
  - `"#### 以下は目次に入れない"`：`## A\n\n#### D` → `toc` は1件
  - `"同じ文言の見出しも別の id"`：`## 同じ\n\n## 同じ` → id が `h-1` と `h-2`
  - `"見出しの中のリンクや強調は文字だけ"`：`## [[手順書]] の **注意**` → `text` が `"手順書 の 注意"`
- [ ] **Step 2: 失敗を確認する**：`npx vitest run src/__tests__/toc.test.ts` → FAIL
- [ ] **Step 3: 実装する**：`DOMParser` で読み、`h1, h2, h3` に id を付けて `body.innerHTML` を返す。`text` は `textContent` を trim し、連続する空白を1つにまとめたもの
- [ ] **Step 4: 通ることを確認する**：同じコマンドで PASS
- [ ] **Step 5: コミット**：`feat: build a table of contents from article headings`

---

### Task 2: 記事画面の2列レイアウト

**Files:**
- Modify: `src/pages/ArticleViewPage.tsx`、`src/styles.css`

**Interfaces:**
- Consumes: `buildToc`、`TocItem`（Task 1）

- [ ] **Step 1: 実装する**
  - `html` を `buildToc` に通し、HTML は本文に、`toc` は目次に使う
  - 構造：`<article className="article-page"><div className="article-layout"><div className="article-main">`（タイトル・更新情報・狭い画面用の `<details className="toc-inline">`・本文・「チェックをすべて外す」）`</div><aside className="article-aside">`（`<nav className="toc-side">` の目次、被リンク、添付）`</aside></div></article>`
  - 目次の項目は `<a href="#h-n">`。クリックで `preventDefault` し、`document.getElementById(id)?.scrollIntoView()` する（ルーターに URL を触らせない）
  - 目次は `toc.length >= 2` のときだけ両方とも出す
  - CSS：`.article-page` の最大幅を外す。`.article-layout` は1列のグリッド。`@media (min-width: 1000px)` で `grid-template-columns: minmax(0, 760px) minmax(0, 270px)`、`gap: var(--space-2xl)`。`.article-aside` は広い画面で `position: sticky; top: var(--space-lg); max-height: calc(100dvh - 2 * var(--space-lg)); overflow-y: auto`。`.toc-inline` は広い画面で隠し、`.toc-side` は狭い画面で隠す。右欄の中の被リンク・添付は、上の罫線と余白を欄に合わせて小さくする
- [ ] **Step 2: 確認する**：`npm run check` → typecheck、テスト、ビルドがすべて成功
- [ ] **Step 3: コミット**：`feat(ui): put the table of contents, backlinks and attachments beside the article`
