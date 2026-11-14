import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { api, errorMessage, formatDate } from "../api";
import { Byline } from "../Avatar";
import { markdownToText } from "../markdown";
import { WelcomeNotice } from "../WelcomeNotice";

interface ListItem {
  id: string;
  title: string;
  excerpt: string;
  updated_at: number;
  updated_by: string;
  updated_by_name: string;
  updated_by_avatar: string | null;
  tags: string[];
  /** 本文の最初の画像（添付 ID） */
  cover: string | null;
}

interface Tag {
  id: string;
  name: string;
  count: number;
}

export function ArticleListPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const selected = params.getAll("tag");
  const page = Number(params.get("page")) || 1;
  const [draft, setDraft] = useState(q);
  const [items, setItems] = useState<ListItem[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState("");

  useEffect(() => setDraft(q), [q]);

  useEffect(() => {
    setItems(null);
    setError("");
    api
      .get<{ articles: ListItem[]; hasMore: boolean }>(`/articles?${params.toString()}`)
      .then((r) => {
        setItems(r.articles);
        setHasMore(r.hasMore);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [params]);

  useEffect(() => {
    api.get<{ tags: Tag[] }>("/articles/tags").then((r) => setTags(r.tags.filter((t) => t.count > 0))).catch(() => undefined);
  }, []);

  function update(next: { q?: string; tags?: string[]; page?: number }) {
    const p = new URLSearchParams();
    const nq = next.q ?? q;
    if (nq) p.set("q", nq);
    for (const t of next.tags ?? selected) p.append("tag", t);
    if (next.page && next.page > 1) p.set("page", String(next.page));
    setParams(p);
  }

  function toggleTag(name: string) {
    update({ tags: selected.includes(name) ? selected.filter((t) => t !== name) : [...selected, name] });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    update({ q: draft.trim() });
  }

  return (
    <div className="list-layout">
      <div className="list-controls">
        <div className="list-heading">
          <h1>記事</h1>
        </div>
        <WelcomeNotice />
        <form onSubmit={submit} className="search">
          <input type="search" placeholder="キーワードで検索" title="空白で区切ると、すべてを含む記事を探します" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="検索" />
          <button type="submit" className="secondary">検索</button>
        </form>
        {(q || selected.length > 0) && (
          <div className="active-filters" aria-label="絞り込み条件">
            <span className="small muted">絞り込み中</span>
            {q && <span className="small">「{q}」</span>}
            {selected.map((t) => (
              <button key={t} type="button" className="filter-chip" aria-label={`タグ「${t}」の絞り込みを解除`} onClick={() => toggleTag(t)}>
                <span>#{t}</span><span aria-hidden="true">×</span>
              </button>
            ))}
            <button type="button" className="link" onClick={() => setParams(new URLSearchParams())}>すべて解除</button>
          </div>
        )}
      </div>
      <aside className="sidebar">
        <h2>タグで絞り込み</h2>
        <p className="muted small hint">複数選ぶとすべてを含む記事に絞り込みます</p>
        <div className="tag-scroll"><div className="tags tag-cloud" tabIndex={0} aria-label="タグで絞り込み">
          {tags.map((t) => (
            <button
              key={t.id}
              type="button"
              className={selected.includes(t.name) ? "tag active" : "tag"}
              aria-pressed={selected.includes(t.name)}
              aria-label={`${t.name}（${t.count}件）`}
              onClick={() => toggleTag(t.name)}
            >
              {t.name}<span className="count" aria-hidden="true">{t.count}</span>
            </button>
          ))}
          {tags.length === 0 && <p className="muted small">タグはまだありません</p>}
        </div></div>
      </aside>
      <section aria-label="記事一覧">
        {error && <p className="error">{error}</p>}
        {items === null && !error && <p className="muted">読み込み中…</p>}
        {items?.length === 0 &&
          (q ? (
            // キーワードで見つからなければ、その言葉をタイトルにして書き始められるようにする（[[まだない記事]] と同じ）
            <p className="muted">
              「{q}」に一致する記事はありません。
              <br />
              <Link to={`/articles/new?title=${encodeURIComponent(q)}`}>「{q}」という記事を作る</Link>
            </p>
          ) : selected.length > 0 ? (
            <p className="muted">条件に一致する記事はありません。</p>
          ) : (
            <p className="muted">
              記事がありません。<Link to="/articles/new">新しく作成</Link>しましょう。
            </p>
          ))}
        <ul className="article-list">
          {items?.map((a) => (
            <li key={a.id} className={a.cover ? "has-cover" : undefined}>
              {a.cover && (
                <Link to={`/articles/${a.id}`} className="cover" tabIndex={-1} aria-hidden="true">
                  <img src={`/api/attachments/${a.cover}/thumb`} alt="" loading="lazy" decoding="async" />
                </Link>
              )}
              <Link to={`/articles/${a.id}`} className="title">{a.title}</Link>
              {/* 抜粋を押しても記事を開く。タイトルと同じリンク先なので、読み上げとキーボードの移動からは外す */}
              <p className="excerpt">
                <Link to={`/articles/${a.id}`} className="excerpt-link" tabIndex={-1} aria-hidden="true">
                  {markdownToText(a.excerpt).slice(0, 120)}
                </Link>
              </p>
              <div className="list-item-meta">
                <div className="tags article-tags">
                {a.tags.map((t) => (
                  <button key={t} type="button" className="tag small" onClick={() => toggleTag(t)}>#{t}</button>
                ))}
                </div>
                <p className="meta article-update">
                  <Byline userId={a.updated_by} name={a.updated_by_name} avatarId={a.updated_by_avatar} />
                  <span className="meta-item">{formatDate(a.updated_at)}</span>
                </p>
              </div>
            </li>
          ))}
        </ul>
        <div className="pager">
          {page > 1 && <button type="button" onClick={() => update({ page: page - 1 })}>前へ</button>}
          {hasMore && <button type="button" onClick={() => update({ page: page + 1 })}>次へ</button>}
        </div>
      </section>
    </div>
  );
}
