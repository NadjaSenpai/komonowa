import type { ReactNode } from "react";
import { Link } from "react-router";
import { useAuth } from "../App";
import { renderMarkdown } from "../markdown";

/**
 * 使い方の説明（/help）。初めての人向けに「ボタンで書く」を先に、Markdown の記法は後ろにまとめる。
 * ボタン名は画面の文言と同じにする。画面を変えたらここも直す
 */
export const HELP_SECTIONS: { id: string; title: string; admin?: boolean }[] = [
  { id: "start", title: "はじめに" },
  { id: "read", title: "記事を読む・探す" },
  { id: "write", title: "記事を書く" },
  { id: "links", title: "ほかの記事へのリンク" },
  { id: "tasks", title: "チェックリスト" },
  { id: "history", title: "履歴と同時編集" },
  { id: "trash", title: "記事の削除" },
  { id: "share", title: "記事を共有する" },
  { id: "account", title: "アカウント" },
  { id: "trouble", title: "困ったとき" },
  { id: "markdown", title: "Markdown の書き方（記号で書きたい人へ）" },
  { id: "admin", title: "管理者の方へ", admin: true },
];

/** 記法の早見表。preview があるものは実物を置けないので、表示側を言葉で説明する */
export const MARKDOWN_EXAMPLES: { label: string; source: string; preview?: string }[] = [
  { label: "見出し", source: "## 大きい見出し\n### 小さい見出し" },
  { label: "太字", source: "ここは **太字** です" },
  { label: "取り消し線", source: "~~取り消し~~" },
  { label: "リンク", source: "[komonowa のトップ](/)" },
  { label: "記事リンク", source: "[[記事のタイトル]]" },
  { label: "箇条書き", source: "- りんご\n- みかん\n  - 字下げすると入れ子" },
  { label: "番号付きリスト", source: "1. 材料を切る\n2. 炒める" },
  { label: "チェックリスト", source: "- [ ] まだ\n- [x] 済み" },
  { label: "引用", source: "> 引用した文章" },
  { label: "コード", source: "`npm run dev` を実行" },
  { label: "コードブロック", source: "```\n複数行の\nコード\n```" },
  { label: "表", source: "| 名前 | 担当 |\n| --- | --- |\n| 佐藤 | 受付 |" },
  {
    label: "画像",
    source: "![写真の説明](/api/attachments/…)",
    preview: "記事の中に画像が表示されます。「画像・ファイルを挿入」を使うと、この形で自動的に入ります",
  },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="help-section">
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

export function HelpContent({ admin }: { admin: boolean }) {
  const sections = HELP_SECTIONS.filter((s) => admin || !s.admin);
  const title = (id: string) => HELP_SECTIONS.find((s) => s.id === id)!.title;
  return (
    <div className="help">
      <h1>ヘルプ</h1>
      <nav className="help-toc" aria-label="ヘルプの目次">
        <ol>
          {sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`}>{s.title}</a>
            </li>
          ))}
        </ol>
      </nav>

      <Section id="start" title={title("start")}>
        <p>komonowa は、メンバーだけで読み書きするチームの wiki です。だれでも記事を書き足したり直したりでき、直す前の版はすべて残ります。</p>
        <p>記号を覚える必要はありません。書式はボタンで付けられます。間違えても「履歴」から元に戻せるので、気軽に書いてみてください。</p>
      </Section>

      <Section id="read" title={title("read")}>
        <ul>
          <li>上の「記事」で記事の一覧を開きます。新しく更新された順に並びます。</li>
          <li>「キーワードで検索」に言葉を入れて「検索」を押します。空白で区切ると、すべての言葉を含む記事に絞り込みます。</li>
          <li>「タグで絞り込み」のタグを押すと、そのタグの記事だけになります。複数選ぶと、すべてのタグが付いた記事に絞り込みます。「すべて解除」で元に戻ります。</li>
          <li>記事に見出しがあると「目次」が出ます。広い画面では右側、スマホでは本文の上にあります。</li>
          <li>「このページにリンクしているページ」には、その記事へリンクしているほかの記事が並びます。</li>
        </ul>
      </Section>

      <Section id="write" title={title("write")}>
        <ol>
          <li>右上の「新しい記事」を押します。</li>
          <li>「タイトル」と、必要なら「タグ」を入れます。タグはカンマか空白で区切ります（例：ごはん, おでかけ）。</li>
          <li>本文を書きます。書式は本文の上のボタンで付けられます。</li>
          <li>「保存」を押すと記事になります。やめるときは「キャンセル」です。</li>
        </ol>
        <h3>書式ボタン</h3>
        <ul>
          <li>文字を選んでから「太字」などを押すと、その文字に書式が付きます。何も選ばずに押すと見本の文字が入るので、書き換えてください。</li>
          <li>「見出し」「箇条書き」「番号」「チェック」「引用」は、カーソルのある行（選んだ行すべて）に付きます。</li>
          <li>「見出し」「太字」「リンク」「箇条書き」はすぐ押せます。「取り消し線」「記事リンク」「番号」「チェック」「引用」「コード」は「その他」の中にあります。</li>
          <li>ボタンを押すと本文に記号（# や ** など）が入ります。それで正しく、表示するときに書式になります。</li>
          <li>間違えたら Ctrl+Z（Mac は ⌘+Z）で取り消せます。</li>
          <li>「プレビュー」を押すと、保存したときの見た目を確かめられます。「本文を編集」で書く画面に戻ります。</li>
        </ul>
        <h3>画像やファイル</h3>
        <ul>
          <li>「画像・ファイルを挿入」を押すか、本文にファイルを貼り付けるかドラッグ＆ドロップすると、本文に差し込まれます。</li>
          <li>使えるのは画像・PDF・Office 文書・テキスト・ZIP で、1つ10MBまでです。</li>
          <li>記事を開いた画面の「ファイルを添付」からも追加できます。</li>
        </ul>
      </Section>

      <Section id="links" title={title("links")}>
        <ul>
          <li>「その他」の「記事リンク」を押すと <code>[[ページ名]]</code> が入ります。「ページ名」を、リンクしたい記事のタイトルに書き換えます。先にタイトルを選んでから押すと、その文字がそのままリンクになります。</li>
          <li>まだない記事へのリンクは薄く表示されます。押すとそのタイトルで新しい記事を作れます。先にリンクだけ書いておいて、あとから中身を書く使い方ができます。</li>
          <li>同じタイトルの記事は作れません。全角と半角、大文字と小文字の違いも同じとみなします。</li>
          <li>タイトルには半角の <code>[</code> <code>]</code> を使えません。全角の［］なら使えます。</li>
        </ul>
      </Section>

      <Section id="tasks" title={title("tasks")}>
        <ul>
          <li>「その他」の「チェック」で、チェックリストの項目が入ります。</li>
          <li>記事を開いた画面で項目を押すと、チェックを付けたり外したりできます。</li>
          <li>チェックの状態は、使っているブラウザにだけ保存されます。ほかの人やほかの端末には伝わりません。持ち物リストのように、それぞれが自分用に使えます。</li>
          <li>「チェックをすべて外す」で最初の状態に戻ります。</li>
        </ul>
      </Section>

      <Section id="history" title={title("history")}>
        <ul>
          <li>記事を開いて「履歴」を押すと、これまでの版が並びます。「表示」で昔の内容を見られ、「復元」でその版に戻せます。戻したことも新しい版として残るので、やり直しもできます。</li>
          <li>ほかの人が同じ記事を同時に直していた場合、保存するときにお知らせが出て最新版が表示されます。「自分の内容で上書きする」か「自分の変更を捨てて最新版を読み込む」を選べます。</li>
        </ul>
      </Section>

      <Section id="trash" title={title("trash")}>
        <ul>
          <li>記事を開いて「削除」を押すと、記事はごみ箱に移ります。すぐには消えません。</li>
          <li>ごみ箱から戻せるのは管理者です。間違えて消したときは管理者に伝えてください。</li>
        </ul>
      </Section>

      <Section id="share" title={title("share")}>
        <p>komonowa のアカウントを持っていない人に、記事を1本だけ見せられます。</p>
        <ul>
          <li>記事を開いて「共有」を押し、「共有を始める」を押すと共有用の URL ができます。「コピー」で URL をコピーして、見せたい人に送ってください。</li>
          <li>URL を知っている人は、ログインなしで記事のタイトル・本文・最終更新日と、貼った画像や添付ファイルを見られます。書いた人の名前やタグ、ほかの記事は見えません。本文の記事リンクはただの文字になります。</li>
          <li>URL をグループチャットなどに貼るときは、「パスワードを付ける」で6桁の数字のパスワードを付けられます。パスワードは URL とは別に伝えてください。入れた人だけが読め、そのブラウザでは30日間入れ直さずに見られます。「作り直す」と前のパスワードで見ていた人も入れ直しになり、「外す」と誰でも読めるようになります。</li>
          <li>共有中に記事を直すと、共有先にもすぐ反映されます。共有中の記事には「共有中」の印が付きます。</li>
          <li>やめるときは「共有」から「共有を止める」を押します。その URL ではすぐに見られなくなります。もう一度共有すると新しい URL になり、前の URL は使えないままです。</li>
          <li>記事を削除（ごみ箱へ移動）すると、共有も止まります。</li>
          <li>共有ページは検索エンジンや AI に載せないよう設定していますが、URL を知った人は誰でも見られます。URL を送る相手には気をつけてください。</li>
        </ul>
      </Section>

      <Section id="account" title={title("account")}>
        <p>右上の自分の名前を押すと、アカウントの画面が開きます。</p>
        <ul>
          <li>表示名：変えると、過去の記事や履歴の表示も新しい名前になります。</li>
          <li>アイコン：「画像を選ぶ」で写真などを選び、表示する範囲を調整します。画像がないときは名前の頭文字が出ます。</li>
          <li>メールアドレス：新しいアドレスに確認メールが届きます。メールのリンクを開いて「変更を確定する」を押すと切り替わります。</li>
          <li>パスワード：変えると、ほかの端末ではログアウトされます。</li>
          <li>退会：現在のパスワードを入れて「退会する」を押すと、名前・メールアドレス・アイコン・パスワードが消えます。書いた記事と履歴は「（削除されたユーザー）」の名前で残ります。取り消せません。所有者は退会できません。</li>
        </ul>
      </Section>

      <Section id="trouble" title={title("trouble")}>
        <ul>
          <li>パスワードを忘れたときは、管理者に再設定メールを送ってもらってください。</li>
          <li>招待や確認のメールが届かないときは、迷惑メールのフォルダも見てください。メールのリンクには有効期限があり、一度しか使えません。期限が切れたら送り直してもらってください。</li>
          <li>ログインに続けて失敗すると、15分ほどログインできなくなります。少し待ってから試してください。</li>
        </ul>
      </Section>

      <Section id="markdown" title={title("markdown")}>
        <p>本文は Markdown という書き方で保存されます。記号に慣れている人は、ボタンを使わずに直接書けます。改行はそのまま改行になります。</p>
        <div className="help-table">
          <table>
            <thead>
              <tr>
                <th>種類</th>
                <th>こう書くと</th>
                <th>こう表示されます</th>
              </tr>
            </thead>
            <tbody>
              {MARKDOWN_EXAMPLES.map((ex) => (
                <tr key={ex.label}>
                  <th scope="row">{ex.label}</th>
                  <td>
                    <pre>{ex.source}</pre>
                  </td>
                  <td>
                    {ex.preview ? (
                      <p className="muted small">{ex.preview}</p>
                    ) : (
                      <div className="markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(ex.source) }} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {admin && (
        <Section id="admin" title={title("admin")}>
          <p>上の「管理」で開く画面でできることです。</p>
          <ul>
            <li>招待：「メンバーを招待」にメールアドレス・権限・有効期限を入れて送ります。届かなかったり期限が切れたりしたら「再送」、やめるときは「取り消し」です。</li>
            <li>パスワードを忘れた人には「再設定メールを送る」を押します（24時間有効）。</li>
            <li>権限（メンバー・管理者）の変更と「無効化」「再有効化」ができます。無効化しても、その人の記事と履歴は残ります。</li>
            <li>最初の管理者は「所有者」で、ほかの管理者から権限の変更や無効化はできません。</li>
            <li>迷惑な行為をする人は「強制退会」で外せます。名前・メールアドレス・アイコンが消え、記事は「（削除されたユーザー）」の名前で残ります。同じメールアドレスは招待にもメールアドレスの変更にも使えなくなります。取り消せません。一時的に止めるだけなら「無効化」を使ってください。</li>
            <li>「ごみ箱」の記事は「復元」で戻せます。「完全削除」すると履歴と添付ファイルも消え、元に戻せません。</li>
            <li>「共有中の記事」で、だれかが共有している記事を確かめて「共有を止める」ことができます。</li>
            <li>「タグ」の「名前を変更」と削除ができます。</li>
          </ul>
        </Section>
      )}

      <p className="muted small">
        <Link to="/">記事の一覧へ戻る</Link>
      </p>
    </div>
  );
}

export function HelpPage() {
  const { user } = useAuth();
  return <HelpContent admin={user?.role === "admin"} />;
}
