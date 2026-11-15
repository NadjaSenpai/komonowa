/**
 * ピン留めの印（画びょう）。色は文字色に従う。filled なら中を塗る（ピン留め中）。
 * ボタンの中で使い、意味はボタンの aria-label で伝えるので、これ自体は読み上げない
 */
export function PinIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg
      className="pin-icon"
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {/* 頭と胴 */}
      <path d="M8 3h8M9.5 3v6.5L6 15h12l-3.5-5.5V3" fill={filled ? "currentColor" : "none"} />
      {/* 針 */}
      <path d="M12 15v6" />
    </svg>
  );
}
