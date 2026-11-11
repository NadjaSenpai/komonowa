import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        // API: Workers ランタイム上で実行（D1/R2 はテストごとに初期化）
        plugins: [
          cloudflareTest(async () => {
            const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
            return {
              main: "./worker/index.ts",
              wrangler: { configPath: "./wrangler.jsonc" },
              miniflare: {
                bindings: {
                  TEST_MIGRATIONS: migrations,
                  SETUP_TOKEN: "test-setup-token-0123456789abcdefghij",
                },
              },
            };
          }),
        ],
        test: {
          name: "worker",
          include: ["test/**/*.test.ts"],
          setupFiles: ["./test/apply-migrations.ts"],
        },
      },
      {
        // UI のロジック: DOM が必要なものを jsdom で（happy-dom は DOMPurify が正しく動かない）実行
        test: {
          name: "ui",
          include: ["src/**/*.test.ts"],
          environment: "jsdom",
        },
      },
    ],
  },
});
