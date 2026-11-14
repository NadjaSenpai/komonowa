import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** @fontsource の CSS から woff を外す（woff2 を読めないブラウザは対象外。配るファイルと CSS が減る） */
const woff2Only: Plugin = {
  name: "woff2-only",
  enforce: "pre",
  transform(code, id) {
    if (!/@fontsource\/.+\.css/.test(id)) return;
    return code.replace(/,\s*url\([^)]+\.woff\)\s*format\('woff'\)/g, "");
  },
};

export default defineConfig({
  plugins: [woff2Only, react(), cloudflare()],
  // 小さいフォントを CSS に埋め込まない（unicode-range で必要な分だけ読ませる）
  build: { assetsInlineLimit: 0 },
});
