# ページ間リンク（`[[タイトル]]`）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本文の `[[タイトル]]` を記事間リンクにし、未作成の記事へのリンクから新規作成でき、記事ごとに被リンクを表示する。

**Architecture:** 解析と正規化は `shared/wikilinks.ts` に置き、ワーカー（保存時のリンク抽出）とクライアント（描画）の両方から使う。保存時に `article_links` へリンク先の正規化キーを書き、記事 API が `links`（リンク先の有無）と `backlinks` を返す。タイトルは `articles.title_key` の部分一意インデックスで重複を禁止する（ごみ箱の記事は対象外）。

**Tech Stack:** Hono on Cloudflare Workers, D1, React 19, react-router 8, marked 18, DOMPurify, vitest（`@cloudflare/vitest-plugin` と jsdom）

**Spec:** `docs/superpowers/specs/2026-11-14-wiki-links-design.md`

## Global Constraints

- 記法は `[[タイトル]]`。中身は改行と `[` `]` を含まず、前後の空白を除いて空でなく、200文字以内
- インラインコードとコードブロックの中は対象外
- タイトルキーの手順：trim → NFKC → 連続する空白を半角スペース1つに → `toLowerCase()`
- `articles.title` は入力どおり（前後の空白だけ除く）に保存する。キーはサーバーで計算する
- タイトル重複のメッセージ：作成・編集・版の復元は「同じタイトルの記事がすでにあります」、ごみ箱からの復元は「同じタイトルの記事がすでにあります。どちらかのタイトルを変えてから戻してください」。どちらも `409`
- 新しいエンドポイントには、未ログイン・メンバー・管理者の認可テストを書く（AGENTS.md）
- 適用済みのマイグレーションは編集しない。新しく `0004_wiki_links.sql` を足す
- コミット前に `npm run check` を通す

## Review Focus

1. タイトルに `/` `?` `#` `%` を含む場合：`/wiki/<符号化>` → `by-title` → 記事、の往復で同じ記事に着く（Task 3 と Task 4 にテストあり）
2. 自分のタイトルを大文字小文字だけ変える（`docker` → `Docker`）：自分とぶつかったと判定して `409` にしてはいけない（Task 2）
3. `[[ ]]` や `[[　]]`（空白だけ）：リンクにしない（Task 1）
4. リンク文字列の HTML（`[[<img onerror=…>]]`）：エスケープして描画する（Task 4）
5. 本文に大量の `[[…]]` がある場合：リンクの書き込みを1文（`json_each`）で行い、D1 のバッチ文数を本文に比例させない（Task 3）

---

### Task 1: 共通モジュール `shared/wikilinks.ts`

**Files:**
- Create: `shared/wikilinks.ts`
- Modify: `tsconfig.app.json`（`include` に `"shared"`）、`tsconfig.worker.json`（`include` に `"shared"`）、`vitest.config.ts`（ui プロジェクトの `include` に `"shared/**/*.test.ts"`）
- Test: `shared/wikilinks.test.ts`

**Interfaces:**
- Produces:
  - `titleKey(title: string): string`
  - `extractWikiLinks(markdown: string): string[]`：リンク文字列（trim 済み、出現順、キーで重複除去した最初の表記）
  - `wikiLinkExtension: TokenizerAndRendererExtension`（marked）：トークン `{ type: "wikilink", raw, text }`。描画は `<a href="/wiki/${encodeURIComponent(text)}" class="wikilink">${エスケープした text}</a>`
  - `wikiPath(title: string): string` → `/wiki/${encodeURIComponent(title)}`

- [ ] **Step 1: 失敗するテストを書く**

```ts
describe("titleKey", () => {
  it("全角・大文字・前後や連続の空白をそろえる", () => {
    expect(titleKey("  Ｄｏｃｋｅｒ　 入門 ")).toBe("docker 入門");
    expect(titleKey("Docker 入門")).toBe(titleKey("docker　入門"));
  });
});
describe("extractWikiLinks", () => {
  it("[[ ]] を順に拾い、キーが同じものは最初の表記だけ残す", () => {
    expect(extractWikiLinks("[[手順書]] と [[ Docker ]] と [[docker]]")).toEqual(["手順書", "Docker"]);
  });
  it("コードの中、空、改行や角かっこを含むもの、201文字以上は拾わない", () => {
    const md = "`[[a]]`\n\n```\n[[b]]\n```\n\n[[ ]] [[　]] [[c\nd]] [[e[f]]] [[" + "x".repeat(201) + "]]";
    expect(extractWikiLinks(md)).toEqual([]);
  });
  it("見出し・リスト・表の中も拾う", () => {
    expect(extractWikiLinks("# [[A]]\n\n- [[B]]\n\n| x |\n|---|\n| [[C]] |")).toEqual(["A", "B", "C"]);
  });
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run shared/wikilinks.test.ts`
Expected: FAIL（モジュールがない）

- [ ] **Step 3: 実装する**

トークナイザーは `start` で `[[` の位置を返し、`/^\[\[([^\[\]\n]+)\]\]/` に一致したうえで trim 後に空でなく200文字以内のときだけトークンを返す（それ以外は `undefined` を返して通常の文字として扱わせる）。`extractWikiLinks` は `new Marked({ extensions: [wikiLinkExtension] })` の `lexer` と `walkTokens` で `wikilink` トークンを集める。コードのトークンは子を持たないので、これだけで除外される。エスケープは marked の描画用ヘルパーではなく、`& < > " '` を置き換える小さな関数で行う。

- [ ] **Step 4: 通ることを確認する**

Run: `npx vitest run shared/wikilinks.test.ts` → PASS。`npx tsc -b` → エラーなし

- [ ] **Step 5: コミット**

```bash
git add shared tsconfig.app.json tsconfig.worker.json vitest.config.ts
git commit -m "feat: parse [[title]] links and normalize titles"
```

---

### Task 2: タイトルの重複禁止

**Files:**
- Create: `migrations/0004_wiki_links.sql`
- Modify: `worker/routes/articles.ts`（作成・`update`）、`worker/routes/admin.ts`（ごみ箱からの復元）、`test/helpers.ts`（`createArticle` の既定タイトル）
- Test: `test/articles.test.ts`

**Interfaces:**
- Consumes: `titleKey`（Task 1）
- Produces: 列 `articles.title_key`、インデックス `articles_title_key`、表 `article_links(source_id, target_key)` と `article_links_target`（表は Task 3 で使う。マイグレーションを1本にするためここで作る）

マイグレーションの内容：

```sql
ALTER TABLE articles ADD COLUMN title_key TEXT NOT NULL DEFAULT '';
UPDATE articles SET title_key = lower(trim(title));
CREATE UNIQUE INDEX articles_title_key ON articles(title_key) WHERE deleted_at IS NULL;
CREATE TABLE article_links (
  source_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  target_key TEXT NOT NULL,
  PRIMARY KEY (source_id, target_key)
);
CREATE INDEX article_links_target ON article_links(target_key);
```

（先頭に、仕様書を参照する日本語のコメントを付ける。既存のマイグレーションの書き方に合わせる）

- [ ] **Step 1: テストの準備**

`test/helpers.ts` の `createArticle` の既定タイトルを `` `記事-${crypto.randomUUID().slice(0, 8)}` `` にする。既存のテストは同じテスト内で既定タイトルの記事を何本も作っており、重複禁止にするとそのままでは失敗するため。

- [ ] **Step 2: 失敗するテストを書く**（`describe("タイトルの重複")` として `test/articles.test.ts` に追加）

- `"正規化して同じになるタイトルは作れない"`：`Docker 入門` を作った後、`ｄｏｃｋｅｒ　入門` の作成が `409` になり、`error` が `"同じタイトルの記事がすでにあります"`
- `"編集でほかの記事と同じタイトルにはできないが、自分の大文字小文字は変えられる"`：A=`docker`、B=`メモ`。B の PUT（title `DOCKER`）が `409`。A の PUT（title `Docker`）が `200`
- `"版の復元でほかの記事とぶつかると 409"`：A を `旧名` で作り、`新名` に編集する。B を `旧名` で作る。A の版1を復元すると `409`
- `"ごみ箱の記事と同じタイトルは作れ、ごみ箱から戻すときにぶつかれば 409"`：A=`共有` を削除する。B=`共有` を作ると `201`。管理者が A を戻すと `409` で、`error` が `"同じタイトルの記事がすでにあります。どちらかのタイトルを変えてから戻してください"`。B を `共有2` に変えると、A を戻せて `200`

- [ ] **Step 3: 失敗を確認する**

Run: `npx vitest run test/articles.test.ts` → 新しいテストが FAIL

- [ ] **Step 4: 実装する**

- 作成と `update` で `titleKey(input.title)` を `title_key` に書く
- 書き込みの前に `SELECT 1 FROM articles WHERE title_key = ? AND deleted_at IS NULL AND id <> ?` を確認し、あれば `fail(409, …)`
- 確認から書き込みまでの間に割り込まれた場合に備え、`DB.batch` の例外のメッセージに `UNIQUE constraint failed` と `title_key` が含まれていたら、同じ `409` にする。小さな関数にまとめて、作成と `update` の両方で使う
- 管理者のごみ箱からの復元：戻す記事の `title_key` で同じ確認を行い、ごみ箱用のメッセージで `409`

- [ ] **Step 5: 通ることを確認する**

Run: `npx vitest run test/` → すべて PASS

- [ ] **Step 6: コミット**

```bash
git add migrations/0004_wiki_links.sql worker/routes/articles.ts worker/routes/admin.ts test/helpers.ts test/articles.test.ts
git commit -m "feat: forbid duplicate article titles outside the trash"
```

---

### Task 3: リンクの保存と、`links`・`backlinks`・`by-title` の API

**Files:**
- Modify: `worker/routes/articles.ts`（`writeStatements`、`GET /:id`、新しいルート）
- Test: `test/links.test.ts`（新規）

**Interfaces:**
- Consumes: `titleKey`、`extractWikiLinks`（Task 1）、表 `article_links`（Task 2）
- Produces:
  - `GET /api/articles/by-title/:title` → `200 { id: string }` / `404`
  - `GET /api/articles/:id` のレスポンスに `links: { key: string; id: string | null }[]` と `backlinks: { id: string; title: string; updated_at: number }[]` を足す

- [ ] **Step 1: 失敗するテストを書く**（`test/links.test.ts`）

- `"本文のリンク先の有無を返す"`：`手順書` を作る。B の本文は `[[手順書]] [[まだない]] \`[[コード]]\``。B の `links` を key で並べると `[{ key: "まだない", id: null }, { key: "手順書", id: <手順書のid> }]` になる（`コード` は含まない）
- `"被リンクは自分とごみ箱を除き、更新の新しい順"`：T=`目的地`（本文 `[[目的地]]`）、A・B（本文 `[[ 目的地 ]]` と `[[目的地]]`）、C（`[[目的地]]`）を削除する。T の `backlinks` の id が `[B, A]` になる（B を後で作る）
- `"編集でリンクを外すと被リンクから消え、版の復元で戻る"`
- `"タイトルを変えると、旧タイトルへのリンクは未作成になる"`：B が `[[旧]]` を含む。`旧` を `新` に変えると、B の `links` の `旧` は `id: null` になる
- `"by-title は正規化して引け、ごみ箱やない記事は 404"`：`a/b?c#d%` を作り、``/api/articles/by-title/${encodeURIComponent("Ａ/B?c#d%")}`` で id が返る。ない記事と削除した記事は `404`
- `"by-title の認可"`：未ログインは `401`。メンバーと管理者は `200`

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run test/links.test.ts` → FAIL

- [ ] **Step 3: 実装する**

- `writeStatements` に、既存の `guard` を付けた2文を足す：`DELETE FROM article_links WHERE source_id = ? AND <guard>` と、`INSERT OR IGNORE INTO article_links (source_id, target_key) SELECT ?, value FROM json_each(?) WHERE <guard>`。2つ目には `JSON.stringify(extractWikiLinks(body).map(titleKey))` を渡す
- `links`：`article_links` を `articles`（`title_key` が一致し、`deleted_at IS NULL`）と LEFT JOIN する
- `backlinks`：仕様どおりの条件で、`updated_at DESC`
- `by-title` は `/:id` より前に登録し、`decodeURIComponent` 済みの引数から `titleKey` で引く

- [ ] **Step 4: 通ることを確認する**

Run: `npx vitest run test/` → すべて PASS

- [ ] **Step 5: コミット**

```bash
git add worker/routes/articles.ts test/links.test.ts
git commit -m "feat: store [[title]] links and return links and backlinks"
```

---

### Task 4: 画面（描画・`/wiki/:title`・未作成リンク・被リンク）と README

**Files:**
- Create: `src/pages/WikiLinkPage.tsx`
- Modify: `src/markdown.ts`、`src/api.ts`（`links` と `backlinks` の型）、`src/App.tsx`（ルート）、`src/pages/ArticleViewPage.tsx`、`src/pages/ArticleEditPage.tsx`（`?title=`）、`src/pages/HistoryPage.tsx`（本文内リンクのクリック）、`src/styles.css`、`README.md`（機能表に「リンク」の行）
- Test: `src/__tests__/markdown.test.ts`

**Interfaces:**
- Consumes: `wikiLinkExtension`、`wikiPath`、`titleKey`（Task 1）、Task 3 の API
- Produces: `useInternalLinks(): (e: React.MouseEvent) => void`（`src/markdown.ts` か新しいフックファイル。`/` で始まり `target` のない `<a>` のクリックを `navigate` に置き換える。修飾キー付きのクリックは除く）

- [ ] **Step 1: 失敗するテストを書く**（`src/__tests__/markdown.test.ts`）

- `"[[ ]] をアプリ内リンクにする"`：`renderMarkdown("[[a/b?c]]")` に `<a href="/wiki/a%2Fb%3Fc" class="wikilink">a/b?c</a>` が含まれる
- `"リンク文字列の HTML はエスケープする"`：`renderMarkdown("[[<img src=x onerror=alert(1)>]]")` に `<img` も `onerror=` も含まれない（エスケープされた文字列として残る）
- `"コードの中は描画しない"`：`` renderMarkdown("`[[a]]`") `` に `wikilink` が含まれない

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/__tests__/markdown.test.ts` → FAIL

- [ ] **Step 3: 実装する**

- `markdown.ts`：`marked.use({ extensions: [wikiLinkExtension] })`
- `WikiLinkPage`：`by-title` の結果に応じて `navigate(…, { replace: true })` する。行き先はあれば `/articles/<id>`、`404` なら `/articles/new?title=<符号化したタイトル>`。それ以外のエラーは表示する。ルートは `/wiki/:title`（`Protected`）
- 表示画面：`dangerouslySetInnerHTML` の要素で、描画した後に `a.wikilink` を走査する。`titleKey(a.textContent)` が `links` で `id: null` なら `missing` クラスを付ける（`useEffect` か ref で）。本文の `onClick` には `useInternalLinks` を付ける。被リンクは本文と添付の間に `<section className="backlinks"><h2>このページにリンクしているページ</h2>` を置き、`article-list` のスタイルでタイトルと更新日を出す。0件なら section ごと出さない
- 履歴画面の本文にも `useInternalLinks` を付ける。編集画面のプレビューには付けない（移動すると未保存の確認が出るため、そのままでよい）
- 編集画面：新規作成時は `useSearchParams` の `title` を初期値にする。`original.title` は空のままにして、未保存扱いにする
- CSS：`.wikilink` は既存のリンク色、`.wikilink.missing` は `--color-muted` で点線の下線

- [ ] **Step 4: 通ることを確認する**

Run: `npm run check` → typecheck、テスト、ビルドがすべて成功

- [ ] **Step 5: 実際の画面で確かめる**

`npm run db:migrate:local` と `npm run dev` を実行し、次を見る：未作成リンクが薄い色になる → 押すとタイトル入りの新規作成画面が開く → 保存して戻ると通常のリンク色になり、相手の記事に被リンクが出る

- [ ] **Step 6: コミット**

```bash
git add src README.md
git commit -m "feat(ui): render [[title]] links and show backlinks"
```
