import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { api, errorMessage, formatDate } from "../api";
import { sharedHtml } from "../share";

interface SharedArticle {
  title: string;
  body: string;
  updated_at: number;
}

/** 外部共有された記事（/s/:token）。ログイン不要で、読むだけ */
export function SharedPage() {
  const { token = "" } = useParams();
  const [article, setArticle] = useState<SharedArticle | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setArticle(null);
    setError("");
    api
      .get<{ article: SharedArticle }>(`/share/${encodeURIComponent(token)}`)
      .then((r) => {
        setArticle(r.article);
        document.title = `${r.article.title} - komonowa`;
      })
      .catch((err) => setError(errorMessage(err)));
  }, [token]);

  const html = useMemo(() => (article ? sharedHtml(article.body, token) : ""), [article, token]);

  return (
    <div className="shared">
      <p className="shared-label small">komonowa で共有された記事</p>
      {error && <p className="error">{error}</p>}
      {!error && !article && <p className="muted">読み込み中…</p>}
      {article && (
        <article className="article-page">
          <h1>{article.title}</h1>
          <p className="meta">
            <span className="meta-item">{formatDate(article.updated_at)} 更新</span>
          </p>
          <div className="markdown article-body" dangerouslySetInnerHTML={{ __html: html }} />
        </article>
      )}
    </div>
  );
}
