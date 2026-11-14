# 引き継ぎ：komonowa

## 状況（2026-11-15 時点）

- リポジトリは `github.com/NadjaSenpai/komonowa`。本番は `https://komonowa.nadja.app/`（`wrangler.jsonc` の `routes`）で公開中。
- 機能と設計は `README.md`、運用は `docs/operations.md`、機能ごとの仕様と計画は `docs/superpowers/` を参照。
- `npm run check`（整形とリント・型検査・テスト・本番ビルド）が成功する状態を保つ。GitHub Actions でも同じコマンドを実行する。
- セキュリティの確認結果は `docs/security-local-2026-11-15.md`。

## デプロイ時の注意

- `main` に入ると GitHub Actions が自動でデプロイする（マイグレーション → ビルド → デプロイ）。シークレット `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` が必要。
- スキーマを変えるときは、`main` に入れる前に `npm run backup:remote` を実行する。
- 定期バックアップは毎月 2 日と 16 日（`.github/workflows/backup.yml`）。暗号化のパスフレーズはシークレット `BACKUP_PASSPHRASE`。

## 残っていること

- 認証情報は会話やファイルに書き出さない。
