import { useCallback, type MouseEvent } from "react";
import { useNavigate } from "react-router";

/**
 * 描画した本文（dangerouslySetInnerHTML）の中のアプリ内リンクを、ページを読み込み直さずに開く。
 * 本文を包む要素の onClick に付ける。修飾キー付きのクリック（新しいタブで開くなど）はブラウザに任せる
 */
export function useInternalLinks() {
  const navigate = useNavigate();
  return useCallback(
    (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element).closest?.("a");
      const href = link?.getAttribute("href");
      if (!link || !href || link.target || !href.startsWith("/") || href.startsWith("//") || href.startsWith("/api/")) return;
      e.preventDefault();
      navigate(href);
    },
    [navigate],
  );
}
