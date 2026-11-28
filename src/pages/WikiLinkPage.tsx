import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, errorMessage } from "../api";

/** [[タイトル]] の行き先。未作成なら参照元と作成ボタンを表示する */
export function WikiLinkPage() {
  const { title = "" } = useParams();
  const navigate = useNavigate();
  const [result, setResult] = useState<{ title: string; references: { id: string; title: string }[] } | { title: string; error: string }>();

  useEffect(() => {
    let cancelled = false;
    setResult(undefined);
    api
      .get<{ id: string } | { id: null; references: { id: string; title: string }[] }>(`/articles/by-title/${encodeURIComponent(title)}?references=1`)
      .then((response) => {
        if (cancelled) return;
        if (response.id === null) setResult({ title, references: response.references });
        else navigate(`/articles/${response.id}`, { replace: true });
      })
      .catch((err) => {
        if (!cancelled) setResult({ title, error: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [title, navigate]);

  if (!result || result.title !== title) return <p className="muted">読み込み中…</p>;
  if ("error" in result) return <p className="error">{result.error}</p>;
  return (
    <section>
      <h1>{title}</h1>
      <p className="muted">この記事はまだありません。</p>
      <Link className="button" to={`/articles/new?title=${encodeURIComponent(title)}`}>
        このタイトルで記事を作る
      </Link>
      <h2>このページにリンクしているページ</h2>
      {result.references.length ? (
        <ul>
          {result.references.map((article) => (
            <li key={article.id}>
              <Link to={`/articles/${article.id}`}>{article.title}</Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">参照元の記事はありません。</p>
      )}
    </section>
  );
}
