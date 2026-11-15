import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useAuth } from "../App";
import { api, errorMessage, formatDate, formatSize, type Article, type Attachment, type Backlink, type Related, type WikiLink } from "../api";
import { loadMembers, type Member } from "../members";
import { decorateMentions, hasMentions } from "../mentions";
import { Byline } from "../Avatar";
import { renderMarkdown } from "../markdown";
import { SharePanel, type Share } from "../SharePanel";
import { ACCEPT, uploadAttachment } from "../upload";
import { anyTaskChecked, clearTaskChecks, prepareTaskBoxes, toggleTaskBox } from "../taskChecks";
import { buildToc } from "../toc";
import { useInternalLinks } from "../useInternalLinks";
import { titleKey } from "../../shared/wikilinks";
import { ErrorAlert } from "../ErrorAlert";
import { FavoriteButton } from "../FavoriteButton";

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
  const [favorite, setFavorite] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [links, setLinks] = useState<WikiLink[]>([]);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [related, setRelated] = useState<Related[]>([]);
  // 本文に人へのリンクがあるときだけ読み込む（アイコンを付けるため）
  const [members, setMembers] = useState<Member[]>([]);
  const [share, setShare] = useState<Share | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 記事が変わったら閉じる（id は合図として使う）
  useEffect(() => setShareOpen(false), [id]);
  const [error, setError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const onBodyClick = useInternalLinks();

  const load = useCallback(() => {
    setError("");
    api
      .get<{
        article: Article;
        attachments: Attachment[];
        links: WikiLink[];
        backlinks: Backlink[];
        related: Related[];
        share: Share | null;
        favorite: boolean;
      }>(`/articles/${id}`)
      .then((r) => {
        setArticle(r.article);
        setFavorite(r.favorite);
        setAttachments(r.attachments);
        setLinks(r.links);
        setBacklinks(r.backlinks);
        setRelated(r.related);
        setShare(r.share);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [id]);

  useEffect(load, [load]);
  const rendered = useMemo(() => (article ? markMissingLinks(renderMarkdown(article.body), links) : ""), [article, links]);
  const mentioned = hasMentions(rendered);
  useEffect(() => {
    if (!mentioned) return;
    // 読み込めなくても、アイコンが付かないだけで本文は読める
    loadMembers()
      .then(setMembers)
      .catch(() => undefined);
  }, [mentioned]);
  const { html, toc } = useMemo(() => buildToc(decorateMentions(rendered, members)), [rendered, members]);
  // 関連ページ（2ホップ）を、共通のリンク先ごとにまとめる
  const relatedGroups = useMemo(() => {
    const groups = new Map<string, Related[]>();
    for (const r of related) groups.set(r.via, [...(groups.get(r.via) ?? []), r]);
    return [...groups];
  }, [related]);
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: 本文を描画し直すたびに当て直す（html は合図として使う）
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

  /** ピン留めの付け外し。一覧の先頭に出るかどうかだけが変わり、版は進まない */
  async function togglePin() {
    const pinned = article!.pinned_at !== null;
    try {
      await (pinned ? api.del(`/articles/${id}/pin`) : api.post(`/articles/${id}/pin`));
      setArticle({ ...article!, pinned_at: pinned ? null : Date.now() });
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
              <Link className="button" to={`/articles/${id}/edit`}>
                編集
              </Link>
              <Link className="button secondary" to={`/articles/${id}/history`}>
                履歴
              </Link>
              <button
                type="button"
                className="secondary"
                aria-pressed={article.pinned_at !== null}
                title="記事の一覧の先頭に出します。誰でも付け外しできます"
                onClick={togglePin}
              >
                {article.pinned_at !== null ? "ピン留めを外す" : "ピン留め"}
              </button>
              <button type="button" className="secondary" aria-expanded={shareOpen} onClick={() => setShareOpen((o) => !o)}>
                共有
              </button>
              <button type="button" className="danger" onClick={remove}>
                削除
              </button>
            </div>
          </div>
          {shareOpen && <SharePanel articleId={id} share={share} onChange={setShare} />}
          <FavoriteButton articleId={id} title={article.title} favorite={favorite} onChange={setFavorite} onError={setError} showLabel />
          <p className="meta">
            {article.pinned_at !== null && (
              <span className="shared-badge" title="記事の一覧の先頭に出ます">
                ピン留め
              </span>
            )}
            {share && (
              <span className="shared-badge" title="URL を知っている人はログインなしで読めます">
                共有中
              </span>
            )}
            {article.tags.map((t) => (
              <Link key={t} className="tag small" to={`/?tag=${encodeURIComponent(t)}`}>
                #{t}
              </Link>
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
          {/* biome-ignore lint/a11y/noStaticElementInteractions: 描画した本文の中のリンクとチェックの操作を、包む要素でまとめて受ける */}
          <div
            ref={bodyRef}
            className="markdown article-body"
            onClick={onBodyClickWithTasks}
            onKeyDown={onBodyKeyDown}
            dangerouslySetInnerHTML={{ __html: html }}
          />
          {anyChecked && (
            <p className="task-actions">
              <button type="button" className="link small" onClick={clearChecks}>
                チェックをすべて外す
              </button>
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
                    <Link to={`/articles/${b.id}`} className="title">
                      {b.title}
                    </Link>
                    <p className="meta">
                      <span className="meta-item">{formatDate(b.updated_at)} 更新</span>
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {relatedGroups.length > 0 && (
            <section className="backlinks related">
              <h2>関連ページ</h2>
              {relatedGroups.map(([via, pages]) => (
                <div key={via} className="related-group">
                  <h3>「{via}」にリンクしているページ</h3>
                  <ul className="article-list">
                    {pages.map((p) => (
                      <li key={p.id}>
                        <Link to={`/articles/${p.id}`} className="title">
                          {p.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}

          <section className="attachments">
            <h2>添付ファイル</h2>
            {attachments.length === 0 && <p className="muted small">添付はありません</p>}
            <ul>
              {attachments.map((a) => (
                <li key={a.id}>
                  <a href={`/api/attachments/${a.id}`} target="_blank" rel="noopener">
                    {a.filename}
                  </a>
                  <span className="muted small">
                    {" "}
                    {formatSize(a.size)} · {a.uploaded_by_name}
                  </span>
                  {article.body.includes(`/api/attachments/${a.id}`) ? (
                    <span className="muted small" title="本文から外すと削除できます">
                      {" "}
                      · 本文で使用中
                    </span>
                  ) : (
                    (a.uploaded_by === user?.id || user?.role === "admin") && (
                      <button type="button" className="link small danger-text" onClick={() => removeAttachment(a)}>
                        削除
                      </button>
                    )
                  )}
                </li>
              ))}
            </ul>
            {/* ブラウザ標準のファイル選択欄は狭い欄で「選択さ…いません」と切れるので隠し、欄全体を押して選ぶ形にする */}
            <label className="upload">
              <span className="upload-title">{uploading ? "アップロード中…" : "ファイルを添付"}</span>
              <span className="upload-hint">画像・PDF・Office 文書・テキスト・ZIP（10MBまで）</span>
              <input
                ref={fileRef}
                className="visually-hidden"
                type="file"
                multiple
                accept={ACCEPT}
                disabled={uploading}
                onChange={(e) => upload(e.target.files)}
              />
            </label>
            <ErrorAlert message={uploadError} />
          </section>
        </aside>
      </div>
    </article>
  );
}
