# komonowa

メンバー限定の日本語ナレッジベースです。Cloudflare Workers 上で動き、Cloudflare Access の利用者枠には依存しません。

- **UI**: React + Vite（`src/`）
- **API**: Hono（`worker/`）。すべての API でサーバー側が認証と権限を確認します
- **データ**: D1（利用者・セッション・記事・履歴・タグ）、非公開 R2（添付ファイル・アイコン画像）

## 機能

| 区分 | 内容 |
| --- | --- |
| 認証 | 管理者が送る招待メールの期限付き・一回限りのリンクで登録。メールアドレスとパスワードでログイン |
| アカウント | 退会（名前・メールアドレス・アイコン・パスワードを消す。記事と履歴は「（削除されたユーザー）」で残る。所有者と最後の管理者は不可）、表示名の変更（過去の記事・履歴の表示にも反映）、アイコン画像（PNG/JPEG/WebP、256px に縮小。未設定なら名前の頭文字）、パスワード変更、メールアドレスの変更（新しいアドレスに届く確認メールのリンクで確定。古いアドレスにはお知らせが届く） |
| 管理 | 強制退会（名前・メールアドレス・アイコン・パスワードを消し、記事と履歴は「（削除されたユーザー）」で残す。同じアドレスは招待・メール変更に使えなくなる。アドレスは SHA-256 だけを保存）、招待メールの送信・再送・取り消し、パスワード再設定メール（24時間・一回限り）、メンバーの無効化・再有効化・権限変更（無効化・降格すると、その人が送った未使用の招待も取り消す。無効化すると、その人が始めた外部共有も止める）。最初の管理者は「所有者」で、ほかの管理者から権限変更・無効化されない |
| 記事 | Markdown 編集とプレビュー、見出しからの目次（広い画面では右欄、スマホでは本文の上）、チェックリスト（表示画面で付け外しでき、状態はそのブラウザにだけ保存）、書式ボタン（見出し・太字・リンク・箇条書きなど。押すと記号が入り、Ctrl+Z で取り消せる）、キーワード検索（空白区切り AND）、複数タグの AND 絞り込み |
| 履歴 | 全版のスナップショット、過去版の表示と復元（復元も新しい版として記録） |
| 同時編集 | 版番号による楽観的ロック。競合時は最新版を表示し、上書きするか取り込むかを選べます |
| 削除 | メンバーはごみ箱へ移動。復元・完全削除は管理者のみ。無効化された人の記事と履歴は残ります |
| リンク | 本文に `[[タイトル]]` と書くと記事へのリンクになる。まだない記事へのリンクは薄く表示され、押すとそのタイトルで新規作成。「このページにリンクしているページ」を表示（広い画面では右欄、スマホでは本文の下）。タイトルは重複不可（全角半角・大文字小文字の違いは同じとみなす。ごみ箱の記事は除く）。タイトルに半角の `[` `]` は使えない（全角の［］は可） |
| タグ | 管理者が名前の変更・削除 |
| 添付 | 画像（PNG/JPEG/GIF/WebP）、PDF、Office 文書、テキスト/CSV/Markdown、ZIP を最大 10 MB。編集画面でボタン・貼り付け・ドラッグ＆ドロップから本文に差し込める（保存前の新規記事でも可。1日使われなかったものは自動削除）。削除は添付した本人か管理者のみで、記事の本文（ごみ箱の記事も含む）で使われている間は削除できない。ログイン中のみ取得可能。画像は添付時にブラウザで長辺 400px の小さい版も作り、記事一覧では本文の最初の画像をその小さい版で表示（小さい版のない古い画像は元の画像） |
| ヘルプ | `/help` に使い方（ボタンでの書き方、記事リンク、チェックリスト、履歴、困ったとき）と Markdown 記法の早見表。ログインなしでも読める。「管理者の方へ」は管理者にだけ表示。上のナビ、ログイン画面、編集画面の「書き方」（新しいタブ）から開ける |
| 外部共有 | 記事ごとに共有用の URL（`/s/…`）を発行し、ログインなしで読めるようにする。見えるのはタイトル・本文・最終更新日とその記事の添付だけ（書いた人・タグ・ほかの記事は見えず、記事リンクは文字になる）。メンバーなら誰でも始められ、止めるとすぐ見えなくなる（再開すると新しい URL）。任意で6桁のパスワード（自動で作る合言葉。入れたブラウザは30日有効、15分に5回まで）を付けられる。ごみ箱に入れると共有も止まる。始めた人が無効化・退会・強制退会になったときも止まる。管理者は管理画面で共有中の記事を一覧し、止められる |

## 必要なもの

- Node.js 22 以上（開発時は 26 で確認）
- Cloudflare アカウント（デプロイ時のみ）。招待・再設定メールの送信に Workers Paid プランと、Email Sending への送信元ドメインの登録が必要

## 開発

```sh
npm install
cp .dev.vars.example .dev.vars   # SETUP_TOKEN を32文字以上のランダム値に変更
npm run db:migrate:local
npm run dev                      # http://localhost:5173
```

初回は `/setup` で `.dev.vars` の `SETUP_TOKEN` を入力し、最初の管理者を作成します。

```sh
npm run lint        # 整形とリントの確認（Biome。直すときは npm run format）
npm run typecheck   # TypeScript
npm test            # Workers ランタイム上の API テストと、UI のロジックのテスト（D1/R2 はテストごとに初期化）
npm run build       # 本番ビルド（dist/）
npm run check       # 上の4つをまとめて実行
```

`main` への push とプルリクエストでは、GitHub Actions が `npm run check` を実行します（`.github/workflows/ci.yml`）。`main` への push では、それが通ったあと本番へのデプロイまで自動で行います（下の「デプロイ」）。

`npm install` の際に npm 11 が esbuild と workerd のインストールスクリプトの承認を求めます。`package.json` の `allowScripts` に承認済みのものを記録しています。

## デプロイ

本番は `wrangler.jsonc` の `routes` のカスタムドメインで公開しています（`workers.dev` とプレビュー URL は無効）。新しく立てるときの手順は次のとおりです。

先にダッシュボードの Email Service → Email Sending で送信元ドメインを登録し、`wrangler.jsonc` の `vars.MAIL_FROM` をそのドメインのアドレスにします（`wrangler dev` とテストでは送信は模擬され、本物は送られません）。

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
3. 管理画面からメンバーを招待します。招待リンクはメールで本人に届き、画面には表示されません。

更新は `main` に入れば GitHub Actions が自動で行います（`.github/workflows/ci.yml` の `deploy`）。`npm run check` が通ったあと、マイグレーションの適用 → ビルド → デプロイの順に実行します（新しいコードが新しい列を読むため、マイグレーションが先）。リポジトリのシークレットに次の2つが必要です。

| シークレット | 内容 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | API トークン。テンプレート「Edit Cloudflare Workers」に D1 の編集権限を足し、対象のアカウントだけに絞る |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare のアカウント ID |

自動デプロイはバックアップを取りません。スキーマを変える変更は、`main` に入れる前に `npm run backup:remote` を実行してください。手で出すときは次のとおりです。

```sh
npm run backup:remote                    # スキーマを変えるときは先にバックアップ
npm run db:migrate:remote
npm run build && npx wrangler deploy
```

## セキュリティ上の設計

- パスワードは PBKDF2-HMAC-SHA256（100,000 回、ソルト付き）でハッシュ化。Workers の Web Crypto のみを使います
- セッション・招待・再設定のトークンは 256 ビットの乱数で、D1 には SHA-256 ハッシュだけを保存します
- セッション Cookie は `__Host-` 接頭辞・`HttpOnly`・`Secure`・`SameSite=Lax`。有効期限30日（残り15日を切ると延長）
- パスワード変更・再設定・無効化で、その人の全セッションを失効させます
- 期限切れのセッション・メール変更の申し込み・失敗の記録は、毎日の cron で消します。招待・再設定のトークンは、招待一覧の履歴のため期限から30日後に消します（`worker/cleanup.ts`）
- ログイン失敗が15分間に10回続くと、そのアドレスを一時ロックします
- メール変更・パスワード変更・退会の再認証も、利用者ごとに3操作共通で15分間に10回まで。成功すると回数を解除し、通常ログインとは別に制限します
- 招待・再設定トークンは本人宛てのメールでだけ渡し、API の応答には含めません。URL のフラグメント（`#` 以降）に載せるため、サーバーログや Referer にも残りません
- メールは送れたときだけトークンを記録します。送信に失敗すると何も変わらず、前に送ったリンクはそのまま使えます
- 他サイトからのフォーム送信は Origin 検査で拒否します（Hono `csrf`）
- Markdown は DOMPurify でサニタイズしてから表示します。静的ファイルには CSP を付けています（`public/_headers`）
- 添付の Content-Type は利用者の申告ではなく拡張子から決め、先頭バイトで中身を確認します。SVG・HTML は受け付けません
- 添付は `nosniff`・`Cache-Control: private` で配信し、画像とPDF以外はダウンロードとして返します
- 有効な管理者が0人になる操作（最後の管理者の降格・無効化）は拒否します
- 最初の管理者（所有者）は、ほかの管理者から降格・無効化できません。管理者を増やしても締め出されないためです
- 外部共有の URL は推測できない乱数で、止めると記録を消すので即座に無効になります。共有ページの API は `no-store` で配信し、その記事の添付だけを返します
- 検索エンジン・AI のボットには `robots.txt`（AI の収集ボットも名前で拒否）、`X-Robots-Tag` と meta robots（`noindex, nofollow, noarchive, noai, noimageai`）で載せないよう伝えます。行儀のよいボットにしか効かないので、Cloudflare の AI ボットのブロック設定も併用します（`docs/operations.md`）

## 運用

D1 と R2 は 2 週間ごとに GitHub Actions が暗号化してバックアップします（`.github/workflows/backup.yml`）。設定と復元は [docs/operations.md](docs/operations.md) を参照してください。
毎月1・8・15・22日の09:23（JST）にGitHub ActionsからB2へ暗号化バックアップを保存し、直近24世代を保持します。
稼働にはB2用Secretsと復号用の `BACKUP_PASSPHRASE` が必要です。初期設定と復元手順は運用手順を参照してください。

## ディレクトリ

```text
worker/            Hono API（routes/ にエンドポイント）
src/               React UI（pages/ に画面）
shared/            API と UI の両方で使うコード（記事リンクの解析など）
migrations/        D1 スキーマ
test/              API テスト（@cloudflare/vitest-plugin）
scripts/           バックアップ・復元スクリプト
public/_headers    静的ファイルのセキュリティヘッダー
.github/workflows/ CI（npm run check）、本番への自動デプロイ、定期バックアップ
docs/              仕様・計画・運用手順
```

## ライセンス

[MIT License](LICENSE)
