import { useRef, useState } from "react";
import { api, errorMessage, formatDate } from "./api";
import { ErrorAlert } from "./ErrorAlert";

export interface Share {
  url: string;
  /** 6 桁の合言葉。null ならパスワードなし */
  passcode: string | null;
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

  const lock = (again: boolean) => {
    if (again && !confirm("パスワードを作り直しますか？前のパスワードで見ていた人も入れ直しになります。")) return;
    void run(async () => onChange((await api.post<{ share: Share }>(`/articles/${articleId}/share/passcode`)).share));
  };
  const unlockAll = () => {
    if (!confirm("パスワードを外しますか？URL を知っている人は誰でも読めるようになります。")) return;
    void run(async () => onChange((await api.del<{ share: Share }>(`/articles/${articleId}/share/passcode`)).share));
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
            <button type="button" className="secondary" onClick={copy}>
              {copied ? "コピーしました" : "コピー"}
            </button>
          </div>
          <p className="muted small">
            {share.created_by_name} さんが {formatDate(share.created_at)} に共有を始めました。
          </p>
          {share.passcode ? (
            <div className="share-passcode">
              <p className="small">
                パスワード：<strong className="passcode">{share.passcode}</strong>
                <br />
                <span className="muted">URL とは別に伝えてください。入れた人だけが読めます。</span>
              </p>
              <div className="actions">
                <button type="button" className="secondary small" disabled={busy} onClick={() => lock(true)}>
                  作り直す
                </button>
                <button type="button" className="secondary small" disabled={busy} onClick={unlockAll}>
                  外す
                </button>
              </div>
            </div>
          ) : (
            <div className="share-passcode">
              <p className="small muted">パスワードを付けると、URL を知っていても、パスワード（6桁の数字）を入れた人しか読めなくなります。</p>
              <button type="button" className="secondary small" disabled={busy} onClick={() => lock(false)}>
                パスワードを付ける
              </button>
            </div>
          )}
          <button type="button" className="danger small" disabled={busy} onClick={stop}>
            共有を止める
          </button>
        </>
      ) : (
        <>
          <p className="small">
            共有すると、URL を知っている人はログインなしでこの記事を読めます。書いた人の名前やタグは表示されません。記事に貼った画像や添付ファイルも見られます。
          </p>
          <button type="button" disabled={busy} onClick={start}>
            共有を始める
          </button>
        </>
      )}
      <ErrorAlert message={error} />
    </section>
  );
}
