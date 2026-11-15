import { useState } from "react";
import { api, errorMessage } from "./api";

export function FavoriteButton({
  articleId,
  title,
  favorite,
  onChange,
  onError,
  showLabel = false,
}: {
  articleId: string;
  title: string;
  favorite: boolean;
  onChange: (favorite: boolean) => void;
  onError: (message: string) => void;
  showLabel?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const label = favorite ? `「${title}」をお気に入りから外す` : `「${title}」をお気に入りに追加`;
  return (
    <button
      type="button"
      className={`favorite-toggle${favorite ? " active" : ""}${showLabel ? " with-label" : ""}`}
      disabled={busy}
      aria-label={label}
      aria-pressed={favorite}
      title={label}
      onClick={async () => {
        setBusy(true);
        try {
          await (favorite ? api.del(`/articles/${articleId}/favorite`) : api.post(`/articles/${articleId}/favorite`));
          onChange(!favorite);
        } catch (err) {
          onError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill={favorite ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      >
        <path d="m12 3 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9Z" />
      </svg>
      {showLabel && <span>お気に入り{favorite ? "済み" : ""}</span>}
    </button>
  );
}
