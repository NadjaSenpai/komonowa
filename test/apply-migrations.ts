import { applyD1Migrations, env, reset } from "cloudflare:test";
import { beforeEach } from "vitest";

// テストごとに D1 / R2 を空にしてからマイグレーションを適用する
beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
