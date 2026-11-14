# 運用手順：バックアップと復元

Wiki のデータは2か所にあります。両方をそろえて保管・復元してください。

| 保存先 | 内容 |
| --- | --- |
| D1 `wiki-db` | 利用者（パスワードハッシュ）、セッション、招待、記事、全履歴、タグ、添付のメタデータ |
| R2 `wiki-files` | 添付ファイル本体（キー: `attachments/<記事ID>/<添付ID>`。記事の保存前に本文へ差し込んだものは `attachments/<添付ID>`）、アイコン画像（キー: `avatars/<利用者ID>/<アイコンID>`） |

バックアップには全記事と添付、パスワードハッシュが含まれます。暗号化されたストレージなど、メンバー以外が読めない場所に保管してください。`backups/` は `.gitignore` 済みです。

## 手動バックアップ

前提: `npx wrangler login` 済みで、`wrangler.jsonc` の `database_id` が本番のものになっていること。

```sh
npm run backup:remote
# → backups/<日時>/d1.sql, manifest.json, r2/attachments/..., r2/avatars/...
```

スクリプト（`scripts/backup.mjs`）は次を順に行います。

1. `wrangler d1 export wiki-db --remote --output d1.sql` でスキーマとデータを SQL として書き出す
2. D1 の `attachments` テーブルと `users.avatar_id` から R2 キーの一覧を取得する
3. 各オブジェクトを `wrangler r2 object get` で取得し、`manifest.json` に一覧を記録する

注意:

- 一覧用の小さい画像（`<キー>.thumb`）はバックアップに含めません。復元後は元の画像を一覧に表示します
- D1 のエクスポート中はデータベースへの他のリクエストが待たされます。利用の少ない時間帯に実行してください
- 添付は1件ずつ取得するので、件数が多いと時間がかかります
- バックアップ中にアップロードされた添付は含まれないことがあります。整合性が必要なら、作業時間を告知してから実行してください
- ローカル開発データで試すときは `npm run backup:local` を使います

## D1 の復元

### A. 直近30日以内の時点に戻す（Time Travel）

D1 は過去30日間の任意の時点に戻せます。誤操作の取り消しにはこちらが最速です。

```sh
npx wrangler d1 time-travel info wiki-db --timestamp=2026-11-11T09:00:00+09:00   # その時点のブックマークを確認
npx wrangler d1 time-travel restore wiki-db --timestamp=2026-11-11T09:00:00+09:00
```

その時点以降の変更（記事・利用者・セッション）はすべて失われます。R2 の添付は戻らないため、復元後にその時点以降の添付は D1 から参照されない孤立したオブジェクトになります（表示には影響しません）。

### B. バックアップの SQL から復元する

`d1.sql` にはスキーマ（`d1_migrations` を含む）とデータが入っているので、**空の** データベースに流し込みます。

```sh
npx wrangler d1 create wiki-db-restore
# wrangler.jsonc の database_id を新しい ID に変更（database_name も合わせる）
npx wrangler d1 execute wiki-db-restore --remote --file backups/<日時>/d1.sql
```

既存のデータベースに直接流すと、テーブルが既にあるためエラーになります。新しいデータベースを作り、確認してから `wrangler.jsonc` を切り替えてデプロイしてください。

## R2 の復元

D1 を戻したあとに実行します（D1 の添付メタデータとキーが一致している必要があります）。

```sh
npm run restore:r2 -- backups/<日時> --remote
```

`manifest.json` のキーと Content-Type のとおりに `wrangler r2 object put` で書き戻します。同じキーのオブジェクトは上書きされます。

## 復元後の確認

1. 管理者でログインできる（セッションは復元時点のものに戻るため、全員が再ログインになる場合があります）
2. 記事一覧の件数、任意の記事の履歴が期待どおり
3. 添付付きの記事を開き、画像の表示とファイルのダウンロードができる

## 定期的な確認

- 月1回程度、`npm run backup:remote` を実行し、ローカル環境（`.wrangler/` を退避した空の状態）へ復元できることを確かめると安心です。手順はローカルなら次のとおりです

```sh
npx wrangler d1 execute wiki-db --local --file backups/<日時>/d1.sql
npm run restore:r2 -- backups/<日時> --local
npm run dev
```

## その他の運用

- **パスワードを忘れた**: 管理画面の「再設定メールを送る」で本人の登録アドレスに送る（24時間有効・一回限り。送り直すと古いリンクは無効）
- **招待メールが届かない**: 迷惑メールフォルダを確認してもらい、管理画面の招待一覧で「再送」する（同じ権限・同じ期限の長さで新しいリンクを送り、古いリンクは無効）。送信に失敗すると「メールを送れませんでした」と表示され、何も変わらない。原因は Workers のログ（`mail send failed` とエラーコード）と、ダッシュボードの Email Sending の送信状況で確認する
- **送信元ドメイン**: `wrangler.jsonc` の `vars.MAIL_FROM`（`komonowa@nadja.app`）。Email Sending の登録で `cf-bounce` サブドメインに MX・SPF・DKIM が入る。消すと送れなくなる
- **退職・異動**: 管理画面で「無効化」。即座に全セッションが切断され、その人が送った未使用の招待も取り消される（降格でも同じ）。記事と履歴は残る
- **管理者を追加**: 「管理者」権限で招待するか、既存メンバーの権限を変更する。有効な管理者が0人になる操作はできない
- **所有者**: 最初の管理者。ほかの管理者からは降格・無効化できない。画面では譲れないので（うっかり譲る事故を避けるため）、譲るときは次のコマンドで（新しい所有者は有効な管理者であること。アドレスが一致しなければ何も変わらない）

  ```sh
  npx wrangler d1 execute wiki-db --remote --command "UPDATE users SET is_owner = 0 WHERE is_owner = 1 AND EXISTS (SELECT 1 FROM users WHERE email = '新しい所有者のアドレス' AND role = 'admin' AND status = 'active'); UPDATE users SET is_owner = 1 WHERE email = '新しい所有者のアドレス' AND role = 'admin' AND status = 'active';"
  npx wrangler d1 execute wiki-db --remote --command "SELECT name, email FROM users WHERE is_owner = 1"  # 確認
  ```
- **外部共有**: 管理画面の「共有中の記事」で、だれが何を共有しているかを確認して止められる。共有ページは `robots.txt` などでボットに載せないよう伝えているが、行儀のよいボットにしか効かないため、Cloudflare ダッシュボードで nadja.app の **Security → Settings →（Bot traffic で絞り込み）AI Crawler and Agent access policies** を開き、Search・Agent・Training をすべて **Block** にしておく（新しいドメインは既定で Allow）。守りの本体は URL を知られないことなので、URL が漏れたら共有を止めて始め直す（新しい URL になる）
- **強制退会**: 管理画面の「強制退会」で、その人の名前・メールアドレス・アイコン・パスワードを消し、同じアドレスを招待とメールアドレスの変更先に使えなくする。締め出しを解くときは次のコマンドで（`<アドレス>` は小文字にしたもの。アドレスの SHA-256 を base64url で保存している）

  ```sh
  HASH=$(printf "%s" "<アドレス>" | openssl dgst -sha256 -binary | basenc --base64url | tr -d "=")
  npx wrangler d1 execute wiki-db --remote --command "DELETE FROM blocked_emails WHERE email_hash = '$HASH'"
  ```
- **スキーマ変更**: `migrations/` に連番の SQL を追加し、`npm run db:migrate:remote`。適用前にバックアップを取る。マイグレーションを適用してからデプロイする（新しいコードが新しい列を読むため）
- **期限切れの記録の掃除**: 毎日 03:00（JST）の cron（`wrangler.jsonc` の `triggers`）が、期限切れのセッション・メール変更の申し込み・1日より古い失敗の記録と、期限から30日たった招待・再設定のトークンを消す（`worker/cleanup.ts`）。実行の記録は Workers のログ（`observability` を有効にしている）で確認できる
