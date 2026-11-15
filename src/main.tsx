import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router";
import { App } from "./App";
import { watchVideoEmbeds } from "./embeds";
import { watchImages } from "./lightbox";
import "@fontsource/line-seed-jp/400.css";
import "@fontsource/line-seed-jp/700.css";
import "@fontsource-variable/jetbrains-mono";
// ロゴ専用（英字の太字だけ）
import "@fontsource/comfortaa/latin-700.css";
import "./styles.css";

// 本文中の YouTube の再生ボタン。押されたときにだけプレーヤーを読み込む
watchVideoEmbeds();
// 本文の画像を押すと大きく表示する
watchImages();

// useBlocker（未保存の変更の警告）を使うためデータルーターにする
const router = createBrowserRouter([{ path: "*", element: <App /> }]);

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
