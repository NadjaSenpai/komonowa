import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { api, errorMessage, formatDate } from "../api";
import { Byline } from "../Avatar";
import { markdownToText } from "../markdown";
import { tagWeight } from "../tagWeight";

interface ListItem {
  id: string;
  title: string;
  excerpt: string;
  updated_at: number;
  updated_by: string;
  updated_by_name: string;
  updated_by_avatar: string | null;
  tags: string[];
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

  const counts = tags.map((t) => t.count);
  const minCount = Math.min(...counts);
  const maxCount = Math.max(...counts);

  function toggleTag(name: string) {
    update({ tags: selected.includes(name) ? selected.filter((t) => t !== name) : [...selected, name] });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    update({ q: draft.trim() });
  }

  return (
    <div className="list-layout">
      <aside className="sidebar">
        <h2>タグ</h2>
        <p className="muted small hint">複数選ぶとすべてを含む記事に絞り込みます</p>
        <div className="tags tag-cloud">
          {tags.map((t) => (
            <button
              key={t.id}
              type="button"
              className={selected.includes(t.name) ? "tag active" : "tag"}
              style={{ "--w": tagWeight(t.count, minCount, maxCount).toFixed(2) } as CSSProperties}
              aria-pressed={selected.includes(t.name)}
              aria-label={`${t.name}（${t.count}件）`}
              onClick={() => toggleTag(t.name)}
            >
              {t.name}<span className="count" aria-hidden="true">{t.count}</span>
            </button>
          ))}
          {tags.length === 0 && <p className="muted small">タグはまだありません</p>}
        </div>
      </aside>
      <section>
        <div className="list-heading">
          <h1>記事</h1>
        </div>
        <form onSubmit={submit} className="search">
          <input type="search" placeholder="キーワードで検索" title="空白で区切ると、すべてを含む記事を探します" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="検索" />
          <button type="submit" className="secondary">検索</button>
        </form>
        {(q || selected.length > 0) && (
          <p className="small">
            {q && <>「{q}」</>} {selected.map((t) => `#${t}`).join(" ")} の絞り込み中{" "}
            <button type="button" className="link" onClick={() => setParams(new URLSearchParams())}>解除</button>
          </p>
        )}
        {error && <p className="error">{error}</p>}
        {items === null && !error && <p className="muted">読み込み中…</p>}
        {items?.length === 0 && (
          <p className="muted">
            記事がありません。<Link to="/articles/new">新しく作成</Link>しましょう。
          </p>
        )}
        <ul className="article-list">
          {items?.map((a) => (
            <li key={a.id}>
              <Link to={`/articles/${a.id}`} className="title">{a.title}</Link>
              <p className="excerpt">{markdownToText(a.excerpt).slice(0, 120)}</p>
              <p className="meta">
                {a.tags.map((t) => (
                  <button key={t} type="button" className="tag small" onClick={() => toggleTag(t)}>#{t}</button>
                ))}
                <Byline userId={a.updated_by} name={a.updated_by_name} avatarId={a.updated_by_avatar} />
                <span className="meta-item">{formatDate(a.updated_at)}</span>
              </p>
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
