import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useAuth } from "../App";
import { api, errorMessage, formatDate, formatSize, type Article, type Attachment, type Backlink, type WikiLink } from "../api";
import { Byline } from "../Avatar";
import { renderMarkdown } from "../markdown";
import { ACCEPT, uploadAttachment } from "../upload";
import { anyTaskChecked, clearTaskChecks, prepareTaskBoxes, toggleTaskBox } from "../taskChecks";
import { buildToc, type TocItem } from "../toc";
import { useInternalLinks } from "../useInternalLinks";
import { titleKey } from "../../shared/wikilinks";

/** リンク先の記事がない [[タイトル]] に missing を付ける（Cosense の未作成リンクのように薄く見せる） */
function markMissingLinks(html: string, links: WikiLink[]): string {
  const missing = new Set(links.filter((l) => l.id === null).map((l) => l.key));
  if (missing.size === 0) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("a.wikilink").forEach((a) => {
    if (missing.has(titleKey(a.textContent ?? ""))) a.classList.add("missing");
  });
  return doc.body.innerHTML;
}

export function ArticleViewPage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [article, setArticle] = useState<Article | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [links, setLinks] = useState<WikiLink[]>([]);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [error, setError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const onBodyClick = useInternalLinks();

  const load = useCallback(() => {
    setError("");
    api
      .get<{ article: Article; attachments: Attachment[]; links: WikiLink[]; backlinks: Backlink[] }>(`/articles/${id}`)
      .then((r) => {
        setArticle(r.article);
        setAttachments(r.attachments);
        setLinks(r.links);
        setBacklinks(r.backlinks);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [id]);

  useEffect(load, [load]);
  const { html, toc } = useMemo(
    () => (article ? buildToc(markMissingLinks(renderMarkdown(article.body), links)) : { html: "", toc: [] as TocItem[] }),
    [article, links],
  );
  // 見出しが2つ以上あるときだけ目次を出す
  const tocLinks =
    toc.length >= 2 ? (
      <ol className="toc-list">
        {toc.map((t) => (
          <li key={t.id} className={`toc-level-${t.level}`}>
            <a
              href={`#${t.id}`}
              onClick={(e) => {
                // ルーターに URL を触らせず、見出しまでスクロールするだけにする
                e.preventDefault();
                document.getElementById(t.id)?.scrollIntoView();
              }}
            >
              {t.text}
            </a>
          </li>
        ))}
      </ol>
    ) : null;

  // チェックリスト：描画し直すたびに、このブラウザに覚えている付け外しを当て直す
  const bodyRef = useRef<HTMLDivElement>(null);
  const [anyChecked, setAnyChecked] = useState(false);
  useEffect(() => {
    if (!bodyRef.current) return;
    prepareTaskBoxes(bodyRef.current, id);
    setAnyChecked(anyTaskChecked(bodyRef.current));
  }, [html, id]);

  function onBodyClickWithTasks(e: MouseEvent<HTMLDivElement>) {
    const box = (e.target as Element).closest?.(".task-box[role='checkbox']");
    if (!box) return onBodyClick(e);
    toggleTaskBox(box, e.currentTarget, id);
    setAnyChecked(anyTaskChecked(e.currentTarget));
  }

  function onBodyKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== " " && e.key !== "Enter") return;
    const box = (e.target as Element).closest?.(".task-box[role='checkbox']");
    if (!box) return;
    e.preventDefault();
    toggleTaskBox(box, e.currentTarget, id);
    setAnyChecked(anyTaskChecked(e.currentTarget));
  }

  function clearChecks() {
    if (!bodyRef.current) return;
    clearTaskChecks(bodyRef.current, id);
    setAnyChecked(false);
  }

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
        await uploadAttachment(file, id);
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
    <article className="article-page">
      <div className="article-layout">
      <div className="article-main">
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
        <span className="meta-item">
          <Byline userId={article.updated_by} name={article.updated_by_name} avatarId={article.updated_by_avatar} />
          {formatDate(article.updated_at)} 更新
        </span>
        {article.created_by !== article.updated_by && (
          <span className="meta-item">
            作成
            <Byline userId={article.created_by} name={article.created_by_name} avatarId={article.created_by_avatar} />
          </span>
        )}
        <span className="meta-item">第{article.version}版</span>
      </p>
      {tocLinks && (
        <details className="toc-inline">
          <summary>目次</summary>
          {tocLinks}
        </details>
      )}
      <div
        ref={bodyRef}
        className="markdown article-body"
        onClick={onBodyClickWithTasks}
        onKeyDown={onBodyKeyDown}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {anyChecked && (
        <p className="task-actions">
          <button type="button" className="link small" onClick={clearChecks}>チェックをすべて外す</button>
        </p>
      )}
      </div>

      {/* 広い画面では本文の右に並び、狭い画面では本文の下に続く */}
      <aside className="article-aside">
      {tocLinks && (
        <nav className="toc-side" aria-label="目次">
          <h2>目次</h2>
          {tocLinks}
        </nav>
      )}

      {backlinks.length > 0 && (
        <section className="backlinks">
          <h2>このページにリンクしているページ</h2>
          <ul className="article-list">
            {backlinks.map((b) => (
              <li key={b.id}>
                <Link to={`/articles/${b.id}`} className="title">{b.title}</Link>
                <p className="meta"><span className="meta-item">{formatDate(b.updated_at)} 更新</span></p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="attachments">
        <h2>添付ファイル</h2>
        {attachments.length === 0 && <p className="muted small">添付はありません</p>}
        <ul>
          {attachments.map((a) => (
            <li key={a.id}>
              <a href={`/api/attachments/${a.id}`} target="_blank" rel="noopener">{a.filename}</a>
              <span className="muted small"> {formatSize(a.size)} · {a.uploaded_by_name}</span>
              {article.body.includes(`/api/attachments/${a.id}`) ? (
                <span className="muted small" title="本文から外すと削除できます"> · 本文で使用中</span>
              ) : (a.uploaded_by === user?.id || user?.role === "admin") && (
                <button type="button" className="link small danger-text" onClick={() => removeAttachment(a)}>削除</button>
              )}
            </li>
          ))}
        </ul>
        <label className="upload">
          {uploading ? "アップロード中…" : "ファイルを添付（画像・PDF・Office 文書・テキスト・ZIP、10MBまで）"}
          <input ref={fileRef} type="file" multiple accept={ACCEPT} disabled={uploading} onChange={(e) => upload(e.target.files)} />
        </label>
        {uploadError && <p className="error" role="alert">{uploadError}</p>}
      </section>
      </aside>
      </div>
    </article>
  );
}
