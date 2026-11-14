# 運用手順：バックアップと復元

Wiki のデータは2か所にあります。両方をそろえて保管・復元してください。

| 保存先 | 内容 |
| --- | --- |
| D1 `wiki-db` | 利用者（パスワードハッシュ）、セッション、招待、記事、全履歴、タグ、添付のメタデータ |
| R2 `wiki-files` | 添付ファイル本体（キー: `attachments/<記事ID>/<添付ID>`。記事の保存前に本文へ差し込んだものは `attachments/<添付ID>`）、アイコン画像（キー: `avatars/<利用者ID>/<アイコンID>`） |

バックアップには全記事と添付、パスワードハッシュが含まれます。暗号化されたストレージなど、メンバー以外が読めない場所に保管してください。`backups/` は `.gitignore` 済みです。

## 手動バックアップ

前提: `npx wrangler login` 済みで、`wrangler.jsonc` の `database_id` が本番のものになっていること。SQLからファイル一覧を作るため `sqlite3` CLI も必要です（macOSでは標準搭載）。

```sh
npm run backup:remote
# → backups/<日時>/d1.sql, manifest.json, r2/attachments/..., r2/avatars/...
```

スクリプト（`scripts/backup.mjs`）は次を順に行います。

1. `wrangler d1 export wiki-db --remote --output d1.sql` でスキーマとデータを SQL として書き出す
2. 書き出した SQL をローカルのインメモリ SQLite に読み込み、`attachments` テーブルと `users.avatar_id` から R2 キーの一覧を取得する（本番DBは再照会しない）
3. 各オブジェクトを `wrangler r2 object get` で取得し、`manifest.json` に一覧を記録する

注意:

- 一覧用の小さい画像（`<キー>.thumb`）はバックアップに含めません。復元後は元の画像を一覧に表示します
- D1 のエクスポート中はデータベースへの他のリクエストが待たされます。利用の少ない時間帯に実行してください
- 添付は1件ずつ取得するので、件数が多いと時間がかかります
- バックアップ中にアップロードされた添付は含まれないことがあります。整合性が必要なら、作業時間を告知してから実行してください
- SQLの書き出し後に削除された添付・アイコンを取得できない場合は失敗します。削除操作を避けて再実行してください
- ローカル開発データで試すときは `npm run backup:local` を使います

## B2 への定期バックアップ

`.github/workflows/backup.yml` が毎月 **1・8・15・22日の09:23（JST）** に実行します。GitHub Actions のスケジュールは遅延・未実行になる場合があります。`main` にワークフローを反映してから有効になり、Actions → Backup → Run workflow から随時実行もできます。

保存先は非公開バケット `komonowa-backups`、Endpoint は `https://s3.us-west-004.backblazeb2.com` です。
`komonowa/backup-<UTC日時>.tar.gz.gpg` として保存します。D1 SQL・manifest・R2ファイルをまとめてGPGのAES256で暗号化し、暗号文だけを送信します。
再ダウンロードした暗号文のSHA-256を照合した後、**直近24世代**を残して古いものをバージョンID付きで完全削除します。
手動実行分も1世代として数えます。保存または照合に失敗した場合は旧世代を削除しません。B2の「Keep all versions」の設定はそのままで構いません。
デプロイと同じconcurrency groupを使い、マイグレーションとの同時実行を避けます。

### 初期設定

GitHubリポジトリの Settings → Secrets and variables → Actions に次を登録します。

| Secret | 値 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | D1のエクスポートとR2の読み取りができるAPIトークン。既存のデプロイ用トークンに必要な権限があるか確認する |
| `CLOUDFLARE_ACCOUNT_ID` | 対象アカウントID（デプロイと共通） |
| `B2_ACCESS_KEY_ID` | 対象バケット専用のkeyID |
| `B2_SECRET_ACCESS_KEY` | 対応するapplicationKey |
| `BACKUP_PASSPHRASE` | 暗号化・復号用の十分長いランダムな値。32文字以上・改行なし |

B2の App Keys → Add a New Application Key から、対象バケット専用の Read and Write キーを作成します。Master Application KeyはS3互換APIで使えません。
B2のキーには対象バケットのファイルを一覧・読み取り・書き込み・削除できる権限が必要です。
`BACKUP_PASSPHRASE` は、利用者の端末で `openssl rand -base64 32` を実行して作成できます。
**パスワード管理ツールにも保管してください。GitHub Secretsから元の値を取り出すことはできません。** キーを変更しても既存の暗号文は変わらないので、旧世代の復元には旧パスフレーズが必要です。チャットやリポジトリには貼り付けません。

初回は Actions から手動実行し、成功・B2上のファイル・以下の復元を確認してください。
手元で実行する場合は `npm run backup:b2` を使えますが、GPG・tar・AWS CLI・sqlite3と上記環境変数（B2キーは `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`）が必要です。

### B2から取得して復号する

B2の管理画面から、復元したい `.tar.gz.gpg` をダウンロードします。macOSでは `brew install gnupg` でGPGを導入できます。
次のコマンドは復号用パスフレーズを対話入力します。引数やシェル履歴には残しません。

```sh
mkdir -p backups/restore
gpg --output backups/restore.tar.gz --decrypt "/path/to/backup-日時.tar.gz.gpg"
# 上のコマンドが成功した場合だけ、以下を実行する（破損時の部分出力を使わない）
tar -xzf backups/restore.tar.gz -C backups/restore
# backups/restore/d1.sql, manifest.json, r2/ がそろっていることを確認
```

続いて下の「D1の復元 B」「R2の復元」「復元後の確認」を実施します。D1は新しい空のDBへ復元してください。
現在のR2復元スクリプトは `wiki-files` に書き戻すため、実行前に本番への書き込みを止め、現在のバックアップも取ってください。
ローカルへの復元試験では `--local` を指定し、本番のDB設定を切り替えません。

### 通知・保存容量の確認

- GitHubの通知設定でActionsの失敗通知を有効にし、Backupの失敗を確認する。専用メール送信処理は追加していない
- 月1回、Actionsで直近の予定日に成功したか確認する。未実行を検知する外部監視はない
- B2の容量を確認する。無料保管枠10GBに対し、1世代の暗号化後サイズ×24が目安。1世代500MBなら約12GBになるため無料枠を超える。余裕を持つなら1世代350MB程度以下が目安
- B2のダウンロード無料枠、GitHub Actionsの無料実行枠は保管容量とは別。各サービスの利用量を確認する
- 初回と3か月に1回はローカル復元を試し、記事・履歴・添付・アイコンを確認する

## 定期バックアップ（自動）

GitHub Actions（`.github/workflows/backup.yml`）が、毎月 2 日と 16 日の 03:30（JST）に `scripts/backup.mjs --remote` を実行します。結果は `tar.gz` にまとめ、パスフレーズで暗号化（GPG、AES256）してから、その実行のアーティファクトとして 90 日保管します（約 6 世代）。暗号化しないものは置きません。

必要なシークレット（リポジトリの Settings → Secrets and variables → Actions）:

| シークレット | 内容 |
| --- | --- |
| `BACKUP_PASSPHRASE` | 暗号化のパスフレーズ。長いランダムな値にし、**パスワード管理ツールにも控える**（なくすと復元できない） |
| `CLOUDFLARE_API_TOKEN` | デプロイと共用。D1 の Edit と、R2 の読み取り権限が必要 |
| `CLOUDFLARE_ACCOUNT_ID` | デプロイと共用 |

注意:

- このリポジトリは public です。アーティファクトはリポジトリを読める人が取得できる前提で、暗号化を外さないでください
- public リポジトリでは、60 日間リポジトリに動きがないと定期実行が自動で止まります（GitHub の仕様）。しばらく更新しないときは、Actions の画面で止まっていないか確かめ、止まっていれば「Enable workflow」で戻します
- Actions の画面の「Run workflow」で、いつでも手動で取れます
- 手動バックアップ（下の「手動バックアップ」）と中身は同じです

取り出すとき:

```sh
gh run download <実行ID> -n <アーティファクト名>      # または Actions の画面からダウンロード
gpg -d komonowa-backup-<日時>.tar.gz.gpg | tar -xzf -  # パスフレーズを聞かれる。backup/ ができる
```

できた `backup/` は、下の復元手順の `backups/<日時>` と同じ形です。

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
- **退職・異動**: 管理画面で「無効化」。即座に全セッションが切断され、その人が送った未使用の招待も取り消される（降格でも同じ）。その人が始めた外部共有も止まる（再有効化しても戻らない。必要なら共有し直す）。記事と履歴は残る
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
- **スキーマ変更**: `migrations/` に連番の SQL を追加し、`npm run db:migrate:remote`。`main` に入ると GitHub Actions がマイグレーションを適用してからデプロイする（新しいコードが新しい列を読むため、この順）。自動デプロイはバックアップを取らないので、`main` に入れる前に `npm run backup:remote` を実行する。手で出すときも同じ順（`npm run db:migrate:remote` → デプロイ）
- **期限切れの記録の掃除**: 毎日 03:00（JST）の cron（`wrangler.jsonc` の `triggers`）が、期限切れのセッション・メール変更の申し込み・1日より古い失敗の記録と、期限から30日たった招待・再設定のトークンを消す（`worker/cleanup.ts`）。実行の記録は Workers のログ（`observability` を有効にしている）で確認できる
