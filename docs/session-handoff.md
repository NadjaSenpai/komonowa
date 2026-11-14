# 引き継ぎ：komonowa

## 状況（2026-11-15 時点）

- リポジトリは `github.com/NadjaSenpai/komonowa`。本番は `https://komonowa.nadja.app/`（`wrangler.jsonc` の `routes`）で公開中。
- 機能と設計は `README.md`、運用は `docs/operations.md`、機能ごとの仕様と計画は `docs/superpowers/` を参照。
- `npm run check`（整形とリント・型検査・テスト・本番ビルド）が成功する状態を保つ。GitHub Actions でも同じコマンドを実行する。
- セキュリティの確認結果は `docs/security-local-2026-11-15.md`。

## デプロイ時の注意

- マイグレーションを適用してからデプロイする（`npm run db:migrate:remote` → `npm run build && npx wrangler deploy`）。
- `0012_reauth_failures.sql` と `0013_article_cover.sql` を本番に適用したかは、`npx wrangler d1 migrations list wiki-db --remote` で確認する。

## 残っていること

- 無効化した人が始めた外部共有は続く（強制退会では止まる）。そろえるかは未決定。
- 認証情報は会話やファイルに書き出さない。
