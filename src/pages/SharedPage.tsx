import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { ApiError, api, errorMessage, formatDate } from "../api";
import { cleanPasscode, sharedHtml } from "../share";

interface SharedArticle {
  title: string;
  body: string;
  updated_at: number;
}

/** 外部共有された記事（/s/:token）。ログイン不要で、読むだけ。パスワード付きなら先に入れてもらう */
export function SharedPage() {
  const { token = "" } = useParams();
  const [article, setArticle] = useState<SharedArticle | null>(null);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState("");
  const [passcode, setPasscode] = useState("");
  const [passError, setPassError] = useState("");
  const [busy, setBusy] = useState(false);
  const path = `/share/${encodeURIComponent(token)}`;

  const load = useCallback(() => {
    setError("");
    api
      .get<{ article: SharedArticle }>(path)
      .then((r) => {
        setLocked(false);
        setArticle(r.article);
        document.title = `${r.article.title} - komonowa`;
      })
      .catch((err) => {
        if (err instanceof ApiError && err.data.needsPasscode) setLocked(true);
        else setError(errorMessage(err));
      });
  }, [path]);

  useEffect(() => {
    setArticle(null);
    setLocked(false);
    load();
  }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPassError("");
    setBusy(true);
    try {
      await api.post(`${path}/unlock`, { passcode });
      setPasscode("");
      load();
    } catch (err) {
      setPassError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const html = useMemo(() => (article ? sharedHtml(article.body, token) : ""), [article, token]);

  // パスワードを聞くときは、ログイン画面と同じく画面の真ん中のカードにする
  if (locked) {
    return (
      <div className="auth">
        <div className="card">
          <p className="brand">komonowa</p>
          <h1>パスワードを入れてください</h1>
          <form onSubmit={submit} className="stack">
            <p>この記事はパスワードで守られています。共有した人から聞いた6桁の数字を入れてください。</p>
            <label>
              パスワード
              <input
                className="passcode-input"
                value={passcode}
                onChange={(e) => setPasscode(cleanPasscode(e.target.value))}
                inputMode="numeric"
                autoComplete="off"
                pattern="\d{6}"
                maxLength={6}
                required
                // biome-ignore lint/a11y/noAutofocus: パスワードを入れるだけの画面なので、すぐ打てるようにする
                autoFocus
              />
            </label>
            {passError && (
              <p className="error" role="alert">
                {passError}
              </p>
            )}
            <button type="submit" disabled={busy || passcode.length !== 6}>
              開く
            </button>
          </form>
        </div>
      </div>
    );
  }

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
