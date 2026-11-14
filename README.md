# komonowa

メンバー限定の日本語ナレッジベースです。Cloudflare Workers 上で動き、Cloudflare Access の利用者枠には依存しません。

- **UI**: React + Vite（`src/`）
- **API**: Hono（`worker/`）。すべての API でサーバー側が認証と権限を確認します
- **データ**: D1（利用者・セッション・記事・履歴・タグ）、非公開 R2（添付ファイル・アイコン画像）

## 機能

| 区分 | 内容 |
| --- | --- |
| 認証 | 管理者が発行する期限付き・一回限りの招待リンクで登録。メールアドレスとパスワードでログイン |
| アカウント | 表示名の変更（過去の記事・履歴の表示にも反映）、アイコン画像（PNG/JPEG/WebP、256px に縮小。未設定なら名前の頭文字）、パスワード変更 |
| 管理 | 招待の発行・取り消し、パスワード再設定リンク（24時間・一回限り）、メンバーの無効化・再有効化・権限変更 |
| 記事 | Markdown 編集とプレビュー、見出しからの目次（広い画面では右欄、スマホでは本文の上）、チェックリスト（表示画面で付け外しでき、状態はそのブラウザにだけ保存）、書式ボタン（見出し・太字・リンク・箇条書きなど。押すと記号が入り、Ctrl+Z で取り消せる）、キーワード検索（空白区切り AND）、複数タグの AND 絞り込み |
| 履歴 | 全版のスナップショット、過去版の表示と復元（復元も新しい版として記録） |
| 同時編集 | 版番号による楽観的ロック。競合時は最新版を表示し、上書きするか取り込むかを選べます |
| 削除 | メンバーはごみ箱へ移動。復元・完全削除は管理者のみ。無効化された人の記事と履歴は残ります |
| リンク | 本文に `[[タイトル]]` と書くと記事へのリンクになる。まだない記事へのリンクは薄く表示され、押すとそのタイトルで新規作成。「このページにリンクしているページ」を表示（広い画面では右欄、スマホでは本文の下）。タイトルは重複不可（全角半角・大文字小文字の違いは同じとみなす。ごみ箱の記事は除く）。タイトルに半角の `[` `]` は使えない（全角の［］は可） |
| タグ | 管理者が名前の変更・削除 |
| 添付 | 画像（PNG/JPEG/GIF/WebP）、PDF、Office 文書、テキスト/CSV/Markdown、ZIP を最大 10 MB。編集画面でボタン・貼り付け・ドラッグ＆ドロップから本文に差し込める（保存前の新規記事でも可。1日使われなかったものは自動削除）。削除は添付した本人か管理者のみで、記事の本文（ごみ箱の記事も含む）で使われている間は削除できない。ログイン中のみ取得可能 |

## 必要なもの

- Node.js 22 以上（開発時は 26 で確認）
- Cloudflare アカウント（デプロイ時のみ）

## 開発

```sh
npm install
cp .dev.vars.example .dev.vars   # SETUP_TOKEN を32文字以上のランダム値に変更
npm run db:migrate:local
npm run dev                      # http://localhost:5173
```

初回は `/setup` で `.dev.vars` の `SETUP_TOKEN` を入力し、最初の管理者を作成します。

```sh
npm test            # Workers ランタイム上の API テスト（D1/R2 はテストごとに初期化）
npm run typecheck   # TypeScript
npm run build       # 本番ビルド（dist/）
npm run check       # 上の3つをまとめて実行
```

`npm install` の際に npm 11 が esbuild と workerd のインストールスクリプトの承認を求めます。`package.json` の `allowScripts` に承認済みのものを記録しています。

## デプロイ

本番デプロイはこのリポジトリの作業範囲外ですが、手順は次のとおりです。

```sh
npx wrangler login
npx wrangler d1 create wiki-db          # 出力の database_id を wrangler.jsonc に設定
npx wrangler r2 bucket create wiki-files # 公開アクセス（r2.dev / カスタムドメイン）は有効にしない
npm run db:migrate:remote
npx wrangler secret put SETUP_TOKEN      # 例: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
npm run build && npx wrangler deploy
```

1. デプロイ先の `/setup` で `SETUP_TOKEN` を入力し、最初の管理者を作成します。
2. 作成後は `npx wrangler secret delete SETUP_TOKEN` でトークンを削除します（利用者が1人でもいれば初期設定 API は拒否しますが、念のため）。
3. 管理画面からメンバーを招待します。招待リンクは発行時に一度だけ表示されます。

## セキュリティ上の設計

- パスワードは PBKDF2-HMAC-SHA256（100,000 回、ソルト付き）でハッシュ化。Workers の Web Crypto のみを使います
- セッション・招待・再設定のトークンは 256 ビットの乱数で、D1 には SHA-256 ハッシュだけを保存します
- セッション Cookie は `__Host-` 接頭辞・`HttpOnly`・`Secure`・`SameSite=Lax`。有効期限30日（残り15日を切ると延長）
- パスワード変更・再設定・無効化で、その人の全セッションを失効させます
- ログイン失敗が15分間に10回続くと、そのアドレスを一時ロックします
- 招待・再設定トークンは URL のフラグメント（`#` 以降）で渡すため、サーバーログや Referer に残りません
- 他サイトからのフォーム送信は Origin 検査で拒否します（Hono `csrf`）
- Markdown は DOMPurify でサニタイズしてから表示します。静的ファイルには CSP を付けています（`public/_headers`）
- 添付の Content-Type は利用者の申告ではなく拡張子から決め、先頭バイトで中身を確認します。SVG・HTML は受け付けません
- 添付は `nosniff`・`Cache-Control: private` で配信し、画像とPDF以外はダウンロードとして返します
- 有効な管理者が0人になる操作（最後の管理者の降格・無効化）は拒否します

## 運用

D1 と R2 のバックアップ・復元は [docs/operations.md](docs/operations.md) を参照してください。

## ディレクトリ

```text
worker/            Hono API（routes/ にエンドポイント）
src/               React UI（pages/ に画面）
migrations/        D1 スキーマ
test/              API テスト（@cloudflare/vitest-plugin）
scripts/           バックアップ・復元スクリプト
public/_headers    静的ファイルのセキュリティヘッダー
docs/              仕様・計画・運用手順
```
