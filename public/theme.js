// 画面を描く前に、この端末で選んだ表示（ライト・ダーク）を当てる。白く光らないよう <head> で同期的に読む。
// キーと値は src/theme.ts と同じ。CSP（script-src 'self'）のため、インラインではなくファイルにしている
try {
  const theme = localStorage.getItem("wiki:theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch {
  // 保存先が使えないときは OS の設定に従う
}
