import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router";
import { App } from "./App";
import { watchVideoEmbeds } from "./embeds";
import "@fontsource/line-seed-jp/400.css";
import "@fontsource/line-seed-jp/700.css";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";

// 本文中の YouTube の再生ボタン。押されたときにだけプレーヤーを読み込む
watchVideoEmbeds();

// useBlocker（未保存の変更の警告）を使うためデータルーターにする
const router = createBrowserRouter([{ path: "*", element: <App /> }]);

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
