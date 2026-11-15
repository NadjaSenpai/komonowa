/**
 * 表示の明るさ（ライト・ダーク）。この端末のブラウザにだけ覚える。
 * 画面を描く前の適用は public/theme.js が同じキーで行い、ここはアカウント設定での切り替えと、ほかのタブへの反映を受け持つ
 */
export type Theme = "system" | "light" | "dark";

export const THEME_KEY = "wiki:theme";
/** ブラウザのバーの色。index.html の theme-color と同じ値 */
const BAR_COLORS = { light: "#365d4e", dark: "#1b1a18" } as const;

export function getTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

/** html の data-theme と、ブラウザのバー・フォーム部品の配色を合わせる */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const own = meta.getAttribute("media")?.includes("dark") ? "dark" : "light";
    meta.setAttribute("content", BAR_COLORS[theme === "system" ? own : theme]);
  }
  document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')?.setAttribute("content", theme === "system" ? "light dark" : theme);
}

/** 選んだ表示を覚えて当てる。保存できないブラウザでも、いま開いている画面には当てる */
export function setTheme(theme: Theme) {
  try {
    if (theme === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* 保存できなくても切り替えは続ける */
  }
  applyTheme(theme);
}

/** ほかのタブで切り替えたら、このタブにも反映する */
export function watchTheme() {
  applyTheme(getTheme());
  window.addEventListener("storage", (e) => {
    if (e.key === THEME_KEY || e.key === null) applyTheme(getTheme());
  });
}
