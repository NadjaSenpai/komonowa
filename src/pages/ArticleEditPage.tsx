import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useBlocker, useNavigate, useParams } from "react-router";
import { ApiError, api, errorMessage, type Article } from "../api";
import { renderMarkdown } from "../markdown";

function parseTags(input: string) {
  return input
    .split(/[,、\s]+/)
    .map((t) => t.replace(/^#/, "").trim())
    .filter(Boolean);
}

export function ArticleEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [baseVersion, setBaseVersion] = useState(0);
  const [original, setOriginal] = useState({ title: "", body: "", tags: "" });
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<Article | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!id) return;
    api
      .get<{ article: Article }>(`/articles/${id}`)
      .then(({ article }) => {
        setTitle(article.title);
        setBody(article.body);
        setTags(article.tags.join(", "));
        setBaseVersion(article.version);
        setOriginal({ title: article.title, body: article.body, tags: article.tags.join(", ") });
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [id]);

  const dirty = !saved && (title !== original.title || body !== original.body || tags !== original.tags);
  const blocker = useBlocker(dirty);
  useEffect(() => {
    if (blocker.state === "blocked") {
      if (confirm("保存していない変更があります。破棄して移動しますか？")) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const preview = useMemo(() => (tab === "preview" ? renderMarkdown(body) : ""), [tab, body]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const payload = { title, body, tags: parseTags(tags) };
    try {
      const r = id
        ? await api.put<{ article: Article }>(`/articles/${id}`, { ...payload, baseVersion })
        : await api.post<{ article: Article }>("/articles", payload);
      setSaved(true);
      setTimeout(() => navigate(`/articles/${r.article.id}`), 0);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.data.current) {
        setConflict(err.data.current as Article);
      }
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  /** 競合時: 自分の編集内容は残したまま、最新版を基準にして保存し直せるようにする */
  function rebase() {
    if (!conflict) return;
    setBaseVersion(conflict.version);
    setOriginal({ title: conflict.title, body: conflict.body, tags: conflict.tags.join(", ") });
    setConflict(null);
    setError("");
  }

  function discardMine() {
    if (!conflict) return;
    setTitle(conflict.title);
    setBody(conflict.body);
    setTags(conflict.tags.join(", "));
    rebase();
  }

  if (loading) return <p className="muted">読み込み中…</p>;

  return (
    <form onSubmit={submit} className="editor">
      <h1>{id ? "記事を編集" : "新しい記事"}</h1>
      <label>
        タイトル
        <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
      </label>
      <label>
        タグ（カンマ・空白区切り）
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="例: 手順, ネットワーク" />
      </label>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "edit"} className={tab === "edit" ? "active" : ""} onClick={() => setTab("edit")}>
          Markdown
        </button>
        <button type="button" role="tab" aria-selected={tab === "preview"} className={tab === "preview" ? "active" : ""} onClick={() => setTab("preview")}>
          プレビュー
        </button>
      </div>
      {tab === "edit" ? (
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={24} aria-label="本文" spellCheck={false} />
      ) : (
        <div className="markdown preview" dangerouslySetInnerHTML={{ __html: preview || "<p class='muted'>（本文なし）</p>" }} />
      )}
      <p className="muted small">添付ファイルは保存後の記事ページから追加でき、「Markdown をコピー」で本文に貼り付けられます。</p>

      {conflict && (
        <div className="conflict" role="alert">
          <p>
            <strong>{conflict.updated_by_name}</strong> さんが先に第{conflict.version}版を保存しました。最新版の本文：
          </p>
          <pre>{conflict.body}</pre>
          <div className="actions">
            <button type="button" onClick={rebase}>自分の内容で上書きする</button>
            <button type="button" className="secondary" onClick={discardMine}>自分の変更を捨てて最新版を読み込む</button>
          </div>
        </div>
      )}
      {error && !conflict && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button type="submit" disabled={saving || Boolean(conflict)}>{saving ? "保存中…" : "保存"}</button>
        <button type="button" className="secondary" onClick={() => navigate(id ? `/articles/${id}` : "/")}>キャンセル</button>
      </div>
    </form>
  );
}
