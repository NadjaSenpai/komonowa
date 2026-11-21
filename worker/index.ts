import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { purgeExpired } from "./cleanup";
import type { AppEnv } from "./env";
import { admin } from "./routes/admin";
import { articles } from "./routes/articles";
import { MAX_FILE_BYTES, MAX_THUMB_BYTES, attachments } from "./routes/attachments";
import { auth } from "./routes/auth";
import { share } from "./routes/share";
import { avatars, profile } from "./routes/profile";
import { users } from "./routes/users";
import { xPreview } from "./routes/x-preview";

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", secureHeaders({ crossOriginResourcePolicy: "same-origin" }));
// フォーム系の Content-Type を使う他サイトからの書き込みを拒否する（JSON は CORS プリフライトで守られる）
app.use("*", csrf());
app.use("*", async (c, next) => {
  await next();
  if (!c.res.headers.has("cache-control")) c.res.headers.set("cache-control", "no-store");
});
// 添付（10MB）に一覧用の小さい版（200KB）を添えて送るので、その分も含める
app.use("*", bodyLimit({ maxSize: MAX_FILE_BYTES + MAX_THUMB_BYTES + 64 * 1024, onError: (c) => c.json({ error: "ファイルは10MBまでです" }, 413) }));

app.route("/auth", auth);
app.route("/auth", profile);
app.route("/avatars", avatars);
app.route("/users", users);
app.route("/admin", admin);
app.route("/articles", articles);
app.route("/share", share);
app.route("/x-preview", xPreview);
app.route("/", attachments);

app.notFound((c) => c.json({ error: "見つかりません" }, 404));
app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.json({ error: "サーバーでエラーが発生しました" }, 500);
});

export default {
  fetch: app.fetch,
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(purgeExpired(env.DB));
  },
} satisfies ExportedHandler<Env>;
