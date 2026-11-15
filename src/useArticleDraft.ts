import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadDraft, removeDraft, saveDraft, type ArticleDraft, type DraftContent } from "./articleDraft";

export function useArticleDraft(key: string, value: DraftContent, enabled: boolean, dirty: boolean) {
  const { title, body, tags, baseVersion, draftIds } = value;
  const content = useMemo(() => ({ title, body, tags, baseVersion, draftIds }), [title, body, tags, baseVersion, draftIds]);
  const [state, setState] = useState<{ key: string; pending: ArticleDraft | null; resolved: boolean }>({ key: "", pending: null, resolved: false });
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState<{ content: DraftContent; at: number } | null>(null);
  const cleared = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    cleared.current = false;
    setSaved(null);
    setError(false);
    try {
      const pending = loadDraft(key);
      setState({ key, pending, resolved: !pending });
    } catch {
      setState({ key, pending: null, resolved: true });
      setError(true);
    }
  }, [key, enabled]);
  const writable = enabled && state.key === key && state.resolved;
  const flush = useCallback(() => {
    const d = { key, value: content, writable, dirty };
    if (!d.writable || cleared.current) return;
    try {
      // 未編集のタブから、別タブが書いた下書きを消さない。削除は保存成功・明示的な破棄だけで行う。
      if (!d.dirty) return;
      const ok = saveDraft(d.key, d.value);
      setError(!ok);
      if (ok) setSaved({ content, at: Date.now() });
    } catch {
      setError(true);
    }
  }, [key, content, writable, dirty]);
  useEffect(() => {
    const timer = setTimeout(flush, 500);
    return () => clearTimeout(timer);
  }, [flush]);
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const save = () => flushRef.current();
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("pagehide", save);
      save();
    };
  }, []);
  function clear() {
    cleared.current = true;
    try {
      removeDraft(key);
    } catch {
      setError(true);
    }
  }
  function resolve() {
    setState({ key, pending: null, resolved: true });
  }
  function discard() {
    try {
      removeDraft(key);
    } catch {
      setError(true);
    }
    resolve();
  }
  return { pending: state.key === key ? state.pending : null, resolve, discard, clear, error, savedAt: saved?.content === content ? saved.at : null };
}
