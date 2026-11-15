/** 退会・強制退会した人の表示名（worker/accounts.ts が DB の name に入れる）。記事・履歴・一覧はこの名前で出る */
export const DELETED_NAME = "（削除されたユーザー）";
/** 退会した人のメールアドレスの置き換え先のドメイン（deleted-<id>@deleted.invalid） */
export const DELETED_EMAIL_DOMAIN = "@deleted.invalid";
/** パスワードの最短の長さ。サーバーの検証（worker/http.ts）と画面の入力欄（src/）で同じ値を使う */
export const PASSWORD_MIN = 12;
