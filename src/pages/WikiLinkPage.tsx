import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ApiError, api, errorMessage } from "../api";

/** [[タイトル]] の行き先。記事があれば開き、なければそのタイトルで新規作成画面を開く */
export function WikiLinkPage() {
  const { title = "" } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    api
      .get<{ id: string }>(`/articles/by-title/${encodeURIComponent(title)}`)
      .then(({ id }) => !cancelled && navigate(`/articles/${id}`, { replace: true }))
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) navigate(`/articles/new?title=${encodeURIComponent(title)}`, { replace: true });
        else setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [title, navigate]);

  return error ? <p className="error">{error}</p> : <p className="muted">読み込み中…</p>;
}
