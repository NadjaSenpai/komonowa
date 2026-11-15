import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { useAuth } from "../App";
import { api, errorMessage, formatDate, type Backlink } from "../api";
import { Avatar } from "../Avatar";
import { renderMarkdown } from "../markdown";
import { useInternalLinks } from "../useInternalLinks";

/** ユーザーページに出す利用者（GET /api/users/:id）。メールアドレスや権限は含まない */
export interface Profile {
  id: string;
  name: string;
  avatar_id: string | null;
  /** 自己紹介（Markdown）。未記入なら空 */
  bio: string;
  created_at: number;
}

/** ユーザーページ（/users/:id）。名前・アイコン・自己紹介と、その人が作成した記事 */
export function UserPage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const onBioClick = useInternalLinks();
  const [page, setPage] = useState<{ user: Profile; articles: Backlink[] } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setPage(null);
    setError("");
    let cancelled = false;
    api
      .get<{ user: Profile; articles: Backlink[] }>(`/users/${id}`)
      .then((r) => !cancelled && setPage(r))
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const bio = useMemo(() => (page?.user.bio ? renderMarkdown(page.user.bio) : ""), [page]);

  if (error) return <p className="error">{error}</p>;
  if (!page) return <p className="muted">読み込み中…</p>;
  const mine = page.user.id === user?.id;

  return (
    <div className="user-page">
      <header className="user-head">
        <Avatar userId={page.user.id} name={page.user.name} avatarId={page.user.avatar_id} size="l" />
        <div>
          <h1>{page.user.name}</h1>
          <p className="meta">
            <span className="meta-item">{formatDate(page.user.created_at)} 登録</span>
          </p>
        </div>
        {mine && (
          <Link className="button secondary" to="/account">
            プロフィールを編集
          </Link>
        )}
      </header>

      {bio ? (
        // biome-ignore lint/a11y/noStaticElementInteractions: 描画した自己紹介の中のリンクの操作を、包む要素でまとめて受ける
        // biome-ignore lint/a11y/useKeyWithClickEvents: リンクそのものはキーボードで開ける。ここはページを読み込み直さないための処理
        <div className="markdown article-body user-bio" onClick={onBioClick} dangerouslySetInnerHTML={{ __html: bio }} />
      ) : (
        mine && (
          <p className="muted">
            自己紹介はまだありません。<Link to="/account">アカウント</Link>の画面で書けます。
          </p>
        )
      )}

      <section className="user-articles">
        <h2>書いた記事</h2>
        {page.articles.length === 0 && <p className="muted small">まだ記事を書いていません</p>}
        <ul className="article-list">
          {page.articles.map((a) => (
            <li key={a.id}>
              <Link to={`/articles/${a.id}`} className="title">
                {a.title}
              </Link>
              <p className="meta">
                <span className="meta-item">{formatDate(a.updated_at)} 更新</span>
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
