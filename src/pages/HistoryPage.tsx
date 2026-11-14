import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, errorMessage, formatDate, type Article } from "../api";
import { Byline } from "../Avatar";
import { renderMarkdown } from "../markdown";
import { useInternalLinks } from "../useInternalLinks";

interface RevisionSummary {
  version: number;
  title: string;
  action: "create" | "edit" | "restore";
  created_at: number;
  edited_by: string;
  edited_by_name: string;
  edited_by_avatar: string | null;
}

interface Revision extends RevisionSummary {
  body: string;
  tags: string[];
}

const ACTIONS = { create: "作成", edit: "編集", restore: "復元" };

export function HistoryPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const onBodyClick = useInternalLinks();
  const [article, setArticle] = useState<Article | null>(null);
  const [revisions, setRevisions] = useState<RevisionSummary[]>([]);
  const [selected, setSelected] = useState<Revision | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [a, r] = await Promise.all([
        api.get<{ article: Article }>(`/articles/${id}`),
        api.get<{ revisions: RevisionSummary[] }>(`/articles/${id}/revisions`),
      ]);
      setArticle(a.article);
      setRevisions(r.revisions);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const html = useMemo(() => (selected ? renderMarkdown(selected.body) : ""), [selected]);

  async function show(version: number) {
    try {
      setSelected((await api.get<{ revision: Revision }>(`/articles/${id}/revisions/${version}`)).revision);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function restore(version: number) {
    if (!article || !confirm(`第${version}版の内容を新しい版として復元しますか？`)) return;
    try {
      await api.post(`/articles/${id}/revisions/${version}/restore`, { baseVersion: article.version });
      navigate(`/articles/${id}`);
    } catch (err) {
      setError(errorMessage(err));
      void load();
    }
  }

  if (error && !article) return <p className="error">{error}</p>;
  if (!article) return <p className="muted">読み込み中…</p>;

  return (
    <div>
      <h1 className="history-title">
        変更履歴：<Link to={`/articles/${id}`}>{article.title}</Link>
      </h1>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="history">
        <table>
          <thead>
            <tr><th>版</th><th>操作</th><th>日時</th><th>編集者</th><th>タイトル</th><th /></tr>
          </thead>
          <tbody>
            {revisions.map((r) => (
              <tr key={r.version} className={selected?.version === r.version ? "selected" : ""}>
                <td>{r.version}</td>
                <td>{ACTIONS[r.action]}</td>
                <td>{formatDate(r.created_at)}</td>
                <td><Byline userId={r.edited_by} name={r.edited_by_name} avatarId={r.edited_by_avatar} /></td>
                <td>{r.title}</td>
                <td>
                  <div className="actions">
                    <button type="button" className="secondary small" onClick={() => show(r.version)}>表示</button>
                    {r.version !== article.version && (
                      <button type="button" className="small" onClick={() => restore(r.version)}>復元</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {selected && (
          <section className="revision">
            <h2>第{selected.version}版：{selected.title}</h2>
            <p className="meta">{selected.tags.map((t) => `#${t}`).join(" ")}</p>
            <div className="markdown" onClick={onBodyClick} dangerouslySetInnerHTML={{ __html: html }} />
          </section>
        )}
      </div>
    </div>
  );
}
