import { useRef, useState } from "react";
import { api, errorMessage, formatDate } from "./api";

export interface Share {
  url: string;
  created_at: number;
  created_by_name: string;
}

/** 記事画面の「共有」で開く欄。共有を始める・URL をコピーする・止める（docs/superpowers/specs/2026-11-15-article-sharing-design.md） */
export function SharePanel({ articleId, share, onChange }: { articleId: string; share: Share | null; onChange: (share: Share | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const start = () => run(async () => onChange((await api.post<{ share: Share }>(`/articles/${articleId}/share`)).share));
  const stop = () => {
    if (!confirm("共有を止めますか？この URL では見られなくなります。もう一度共有すると、新しい URL になります。")) return;
    void run(async () => {
      await api.del(`/articles/${articleId}/share`);
      onChange(null);
    });
  };

  async function copy() {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(share.url);
      setCopied(true);
    } catch {
      // クリップボードが使えないときは選んだ状態にして、手でコピーしてもらう
      urlRef.current?.select();
    }
  }

  return (
    <section className="share-panel" aria-label="共有">
      {share ? (
        <>
          <p className="small">この URL を知っている人は、ログインなしでこの記事を読めます。</p>
          <div className="share-url">
            <input ref={urlRef} readOnly value={share.url} aria-label="共有 URL" onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="secondary" onClick={copy}>{copied ? "コピーしました" : "コピー"}</button>
          </div>
          <p className="muted small">
            {share.created_by_name} さんが {formatDate(share.created_at)} に共有を始めました。
          </p>
          <button type="button" className="danger small" disabled={busy} onClick={stop}>共有を止める</button>
        </>
      ) : (
        <>
          <p className="small">
            共有すると、URL を知っている人はログインなしでこの記事を読めます。書いた人の名前やタグは表示されません。記事に貼った画像や添付ファイルも見られます。
          </p>
          <button type="button" disabled={busy} onClick={start}>共有を始める</button>
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
