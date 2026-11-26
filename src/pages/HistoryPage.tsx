import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, errorMessage, formatDate, type Article } from "../api";
import { Byline } from "../Avatar";
import { renderMarkdown } from "../markdown";
import { useInternalLinks } from "../useInternalLinks";
import { ErrorAlert } from "../ErrorAlert";
import { HistoryDiff } from "../HistoryDiff";

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
  // 差分を出しているときの 1 つ前の版（null なら selected の全文を出す）
  const [previous, setPrevious] = useState<Revision | null>(null);
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

  const html = useMemo(() => (selected && !previous ? renderMarkdown(selected.body) : ""), [selected, previous]);

  const fetchRevision = async (version: number) => (await api.get<{ revision: Revision }>(`/articles/${id}/revisions/${version}`)).revision;

  async function show(version: number) {
    try {
      setSelected(await fetchRevision(version));
      setPrevious(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function showDiff(version: number) {
    try {
      const [before, after] = await Promise.all([fetchRevision(version - 1), fetchRevision(version)]);
      setSelected(after);
      setPrevious(before);
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
      <ErrorAlert message={error} />
      <div className="history">
        <table>
          <thead>
            <tr>
              <th>版</th>
              <th>操作</th>
              <th>日時</th>
              <th>編集者</th>
              <th>タイトル</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {revisions.map((r) => (
              <tr key={r.version} className={selected?.version === r.version ? "selected" : ""}>
                <td>{r.version}</td>
                <td>{ACTIONS[r.action]}</td>
                <td>{formatDate(r.created_at)}</td>
                <td>
                  <Byline userId={r.edited_by} name={r.edited_by_name} avatarId={r.edited_by_avatar} />
                </td>
                <td>{r.title}</td>
                <td>
                  <div className="actions">
                    <button type="button" className="secondary small" onClick={() => show(r.version)}>
                      表示
                    </button>
                    {r.version > 1 && (
                      <button type="button" className="secondary small" onClick={() => showDiff(r.version)}>
                        差分
                      </button>
                    )}
                    {r.version !== article.version && (
                      <button type="button" className="small" onClick={() => restore(r.version)}>
                        復元
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {selected && (
          <section className="revision">
            <h2>
              第{selected.version}版：{selected.title}
              {previous && <span className="muted small">（第{previous.version}版との差分）</span>}
            </h2>
            {previous ? (
              <HistoryDiff before={previous} after={selected} />
            ) : (
              <>
                <p className="meta">{selected.tags.map((t) => `#${t}`).join(" ")}</p>
                {/* biome-ignore lint/a11y/noStaticElementInteractions: 描画した本文の中のリンクのクリックを、包む要素でまとめて受ける */}
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: リンクは Enter でもクリックとして届くので、キー操作は別に要らない */}
                <div className="markdown" onClick={onBodyClick} dangerouslySetInnerHTML={{ __html: html }} />
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
