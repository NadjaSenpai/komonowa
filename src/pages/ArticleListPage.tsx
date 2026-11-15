import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { api, errorMessage, formatDate, type Tag } from "../api";
import { Byline } from "../Avatar";
import { thumbnailUrl } from "../embeds";
import { markdownToText } from "../markdown";
import { PinIcon } from "../PinIcon";
import { FavoriteButton } from "../FavoriteButton";
import { SearchHighlight } from "../SearchHighlight";
import { WelcomeNotice } from "../WelcomeNotice";
import { tagHue } from "../tagColor";
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
  /** 本文の最初の画像（添付 ID） */
  cover: string | null;
  /** 本文で画像より先に YouTube の動画があるとき、その動画 ID。あれば cover より優先して出す */
  cover_video: string | null;
  /** ピン留め中（絞り込んでいないときは一覧の先頭に並ぶ） */
  pinned: boolean;
  favorite: boolean;
}

export function ArticleListPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const selected = params.getAll("tag");
  const favoritesOnly = params.get("favorite") === "1";
  const page = Number(params.get("page")) || 1;
  const [draft, setDraft] = useState(q);
  const [items, setItems] = useState<ListItem[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState("");

  useEffect(() => setDraft(q), [q]);

  useEffect(() => {
    let current = true;
    setItems(null);
    setError("");
    api
      .get<{ articles: ListItem[]; hasMore: boolean }>(`/articles?${params.toString()}`)
      .then((r) => {
        if (!current) return;
        setItems(r.articles);
        setHasMore(r.hasMore);
      })
      .catch((err) => {
        if (current) setError(errorMessage(err));
      });
    return () => {
      current = false;
    };
  }, [params]);

  useEffect(() => {
    api
      .get<{ tags: Tag[] }>("/articles/tags")
      .then((r) => setTags(r.tags.filter((t) => t.count > 0)))
      .catch(() => undefined);
  }, []);

  /** 一覧からピン留めを付け外しする。並びが変わるので、読み込み中の表示は出さずに一覧を取り直す */
  async function togglePin(a: ListItem) {
    setError("");
    try {
      await (a.pinned ? api.del(`/articles/${a.id}/pin`) : api.post(`/articles/${a.id}/pin`));
      const r = await api.get<{ articles: ListItem[]; hasMore: boolean }>(`/articles?${params.toString()}`);
      setItems(r.articles);
      setHasMore(r.hasMore);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function update(next: { q?: string; tags?: string[]; page?: number; favorite?: boolean }) {
    const p = new URLSearchParams();
    const nq = next.q ?? q;
    if (nq) p.set("q", nq);
    if (next.favorite ?? favoritesOnly) p.set("favorite", "1");
    for (const t of next.tags ?? selected) p.append("tag", t);
    if (next.page && next.page > 1) p.set("page", String(next.page));
    setParams(p);
  }

  // タグの大きさは、付いている記事の数で決める（いちばん少ないタグといちばん多いタグの間で）
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
      <div className="list-controls">
        <div className="list-heading">
          <h1>記事</h1>
        </div>
        <WelcomeNotice />
        <div className="list-views" role="group" aria-label="記事の表示">
          <button type="button" className="secondary small" aria-pressed={!favoritesOnly} onClick={() => update({ favorite: false })}>
            すべての記事
          </button>
          <button type="button" className="secondary small" aria-pressed={favoritesOnly} onClick={() => update({ favorite: true })}>
            お気に入り
          </button>
        </div>
        <form onSubmit={submit} className="search">
          <input
            type="search"
            placeholder="キーワードで検索"
            title="空白で区切ると、すべてを含む記事を探します"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="検索"
          />
          <button type="submit" className="secondary">
            検索
          </button>
        </form>
        {(q || selected.length > 0) && (
          <div className="active-filters" role="group" aria-label="絞り込み条件">
            <span className="small muted">絞り込み中</span>
            {q && <span className="small">「{q}」</span>}
            {selected.map((t) => (
              <button key={t} type="button" className="filter-chip" aria-label={`タグ「${t}」の絞り込みを解除`} onClick={() => toggleTag(t)}>
                <span>#{t}</span>
                <span aria-hidden="true">×</span>
              </button>
            ))}
            <button type="button" className="link" onClick={() => setParams(new URLSearchParams())}>
              すべて解除
            </button>
          </div>
        )}
      </div>
      <aside className="sidebar">
        <h2>タグで絞り込み</h2>
        <p className="muted small hint">複数選ぶとすべてを含む記事に絞り込みます</p>
        <div className="tag-scroll">
          <div className="tags tag-cloud" role="group" aria-label="タグで絞り込み">
            {tags.map((t) => (
              <button
                key={t.id}
                type="button"
                className={selected.includes(t.name) ? "tag active" : "tag"}
                // よく使われているタグほど大きく濃くする（--w は 0〜1）
                style={{ "--w": tagWeight(t.count, minCount, maxCount).toFixed(2), "--tag-hue": tagHue(t.name) } as CSSProperties}
                aria-pressed={selected.includes(t.name)}
                aria-label={`${t.name}（${t.count}件）`}
                onClick={() => toggleTag(t.name)}
              >
                {t.name}
                <span className="count" aria-hidden="true">
                  {t.count}
                </span>
              </button>
            ))}
            {tags.length === 0 && <p className="muted small">タグはまだありません</p>}
          </div>
        </div>
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
          ) : favoritesOnly ? (
            <p className="muted">お気に入りはまだありません。記事の星ボタンから、自分用に保存できます。</p>
          ) : (
            <p className="muted">
              記事がありません。<Link to="/articles/new">新しく作成</Link>しましょう。
            </p>
          ))}
        <ul className="article-list tinted">
          {items?.map((a) => (
            <li
              key={a.id}
              className={a.cover || a.cover_video ? "has-cover" : undefined}
              // 行の左の色の線。最初のタグの色にする（タグがなければ CSS の既定の灰色）
              style={a.tags[0] ? ({ "--tag-hue": tagHue(a.tags[0]) } as CSSProperties) : undefined}
            >
              {a.cover_video ? (
                // 動画のサムネイル。ふつうの画像と見分けられるよう、再生の印を重ねる
                <Link to={`/articles/${a.id}`} className="cover video" tabIndex={-1} aria-hidden="true">
                  <img src={thumbnailUrl(a.cover_video, "mqdefault")} alt="" loading="lazy" decoding="async" />
                </Link>
              ) : (
                a.cover && (
                  <Link to={`/articles/${a.id}`} className="cover" tabIndex={-1} aria-hidden="true">
                    <img src={`/api/attachments/${a.cover}/thumb`} alt="" loading="lazy" decoding="async" />
                  </Link>
                )
              )}
              <Link to={`/articles/${a.id}`} className="title">
                <SearchHighlight text={a.title} query={q} />
              </Link>
              {/* 抜粋を押しても記事を開く。タイトルと同じリンク先なので、読み上げとキーボードの移動からは外す */}
              <p className="excerpt">
                <Link to={`/articles/${a.id}`} className="excerpt-link" tabIndex={-1} aria-hidden="true">
                  <SearchHighlight text={markdownToText(a.excerpt, !!q).slice(0, q ? 162 : 120)} query={q} />
                </Link>
              </p>
              <div className="list-item-meta">
                <div className="tags article-tags">
                  {a.tags.map((t) => (
                    <button key={t} type="button" className="tag small" onClick={() => toggleTag(t)}>
                      #{t}
                    </button>
                  ))}
                </div>
                <p className="meta article-update">
                  <FavoriteButton
                    articleId={a.id}
                    title={a.title}
                    favorite={a.favorite}
                    onError={setError}
                    onChange={(favorite) => {
                      setItems(
                        (current) =>
                          current?.flatMap((item) => (item.id !== a.id ? [item] : favoritesOnly && !favorite ? [] : [{ ...item, favorite }])) ?? null,
                      );
                    }}
                  />
                  <button
                    type="button"
                    className={a.pinned ? "pin-toggle pinned" : "pin-toggle"}
                    aria-pressed={a.pinned}
                    aria-label={a.pinned ? `「${a.title}」のピン留めを外す` : `「${a.title}」をピン留めする`}
                    title={a.pinned ? "ピン留めを外す" : "ピン留めする（一覧の先頭に出します）"}
                    onClick={() => togglePin(a)}
                  >
                    <PinIcon filled={a.pinned} />
                  </button>
                  <Byline userId={a.updated_by} name={a.updated_by_name} avatarId={a.updated_by_avatar} />
                  <span className="meta-item">{formatDate(a.updated_at)}</span>
                </p>
              </div>
            </li>
          ))}
        </ul>
        <div className="pager">
          {page > 1 && (
            <button type="button" onClick={() => update({ page: page - 1 })}>
              前へ
            </button>
          )}
          {hasMore && (
            <button type="button" onClick={() => update({ page: page + 1 })}>
              次へ
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
