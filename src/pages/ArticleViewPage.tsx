import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useAuth } from "../App";
import { api, errorMessage, formatDate, formatSize, type Article, type Attachment } from "../api";
import { renderMarkdown } from "../markdown";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.pdf,.docx,.xlsx,.pptx,.odt,.ods,.odp,.doc,.xls,.ppt,.txt,.md,.csv";

export function attachmentMarkdown(a: { id: string; filename: string; content_type: string }) {
  const url = `/api/attachments/${a.id}`;
  const label = a.filename.replace(/[[\]]/g, "");
  return a.content_type.startsWith("image/") ? `![${label}](${url})` : `[${label}](${url})`;
}

export function ArticleViewPage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [article, setArticle] = useState<Article | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api
      .get<{ article: Article; attachments: Attachment[] }>(`/articles/${id}`)
      .then((r) => {
        setArticle(r.article);
        setAttachments(r.attachments);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [id]);

  useEffect(load, [load]);
  const html = useMemo(() => (article ? renderMarkdown(article.body) : ""), [article]);

  if (error) return <p className="error">{error}</p>;
  if (!article) return <p className="muted">読み込み中…</p>;

  async function remove() {
    if (!confirm(`「${article!.title}」を削除しますか？（管理者はごみ箱から復元できます）`)) return;
    try {
      await api.del(`/articles/${id}`);
      navigate("/");
    } catch (err) {
      alert(errorMessage(err));
    }
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploadError("");
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name}: ファイルは10MBまでです`);
        const form = new FormData();
        form.append("file", file);
        await api.post(`/articles/${id}/attachments`, form);
      }
      load();
    } catch (err) {
      setUploadError(errorMessage(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeAttachment(a: Attachment) {
    if (!confirm(`添付「${a.filename}」を削除しますか？元に戻せません。`)) return;
    try {
      await api.del(`/attachments/${a.id}`);
      load();
    } catch (err) {
      setUploadError(errorMessage(err));
    }
  }

  return (
    <article>
      <div className="article-head">
        <h1>{article.title}</h1>
        <div className="actions">
          <Link className="button" to={`/articles/${id}/edit`}>編集</Link>
          <Link className="button secondary" to={`/articles/${id}/history`}>履歴</Link>
          <button type="button" className="danger" onClick={remove}>削除</button>
        </div>
      </div>
      <p className="meta">
        {article.tags.map((t) => (
          <Link key={t} className="tag small" to={`/?tag=${encodeURIComponent(t)}`}>#{t}</Link>
        ))}
        <span>
          第{article.version}版 · {formatDate(article.updated_at)} {article.updated_by_name} が更新 · 作成 {article.created_by_name}
        </span>
      </p>
      <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />

      <section className="attachments">
        <h2>添付ファイル</h2>
        {attachments.length === 0 && <p className="muted small">添付はありません</p>}
        <ul>
          {attachments.map((a) => (
            <li key={a.id}>
              <a href={`/api/attachments/${a.id}`} target="_blank" rel="noopener">{a.filename}</a>
              <span className="muted small"> {formatSize(a.size)} · {a.uploaded_by_name}</span>
              <button type="button" className="link small" onClick={() => navigator.clipboard?.writeText(attachmentMarkdown(a))}>
                Markdown をコピー
              </button>
              {(a.uploaded_by === user?.id || user?.role === "admin") && (
                <button type="button" className="link small danger-text" onClick={() => removeAttachment(a)}>削除</button>
              )}
            </li>
          ))}
        </ul>
        <label className="upload">
          {uploading ? "アップロード中…" : "ファイルを添付（画像・PDF・Office 文書・テキスト、10MBまで）"}
          <input ref={fileRef} type="file" multiple accept={ACCEPT} disabled={uploading} onChange={(e) => upload(e.target.files)} />
        </label>
        {uploadError && <p className="error" role="alert">{uploadError}</p>}
      </section>
    </article>
  );
}
