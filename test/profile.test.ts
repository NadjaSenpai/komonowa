import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { Client, adminClient, createArticle, json, memberClient } from "./helpers";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const GIF = new TextEncoder().encode("GIF89a....");
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

function uploadAvatar(c: Client, bytes: Uint8Array, name = "icon.png", type = "image/png") {
  const form = new FormData();
  form.append("file", new File([bytes], name, { type }));
  return c.request("/api/auth/avatar", { method: "PUT", body: form });
}

describe("表示名の変更", () => {
  it("未ログインでは変更できない", async () => {
    expect((await new Client().patch("/api/auth/profile", { name: "だれか" })).status).toBe(401);
  });

  it("メンバーは自分の名前を変えられ、過去の記事と履歴の表示も新しい名前になる", async () => {
    const admin = await adminClient();
    const { client, user } = await memberClient(admin);
    const article = await createArticle(client);

    const res = await client.patch("/api/auth/profile", { name: "  新しい名前  " });
    expect(res.status).toBe(200);
    expect((await json(res)).user).toMatchObject({ id: user.id, name: "新しい名前" });

    expect((await json(await client.get("/api/auth/me"))).user.name).toBe("新しい名前");
    const view = await json(await client.get(`/api/articles/${article.id}`));
    expect(view.article).toMatchObject({ created_by: user.id, created_by_name: "新しい名前", updated_by_name: "新しい名前" });
    const revs = await json(await client.get(`/api/articles/${article.id}/revisions`));
    expect(revs.revisions[0]).toMatchObject({ edited_by: user.id, edited_by_name: "新しい名前" });
  });

  it("管理者も自分の名前を変えられる", async () => {
    const admin = await adminClient();
    expect((await admin.patch("/api/auth/profile", { name: "管理人" })).status).toBe(200);
    expect((await json(await admin.get("/api/auth/me"))).user.name).toBe("管理人");
  });

  it("空や長すぎる名前は拒否する", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    expect((await client.patch("/api/auth/profile", { name: "   " })).status).toBe(400);
    expect((await client.patch("/api/auth/profile", { name: "あ".repeat(51) })).status).toBe(400);
    expect((await client.patch("/api/auth/profile", {})).status).toBe(400);
  });
});

describe("アイコン", () => {
  it("未ログインでは登録・削除・取得できない", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    const { user } = await json(await uploadAvatar(client, PNG));
    const anon = new Client();
    expect((await uploadAvatar(anon, PNG)).status).toBe(401);
    expect((await anon.del("/api/auth/avatar")).status).toBe(401);
    expect((await anon.get(`/api/avatars/${user.avatar_id}`)).status).toBe(401);
  });

  it("メンバーが登録すると、ほかのメンバーも中身から決めた形式で取得できる", async () => {
    const admin = await adminClient();
    const { client, user } = await memberClient(admin);
    const other = await memberClient(admin);

    const res = await uploadAvatar(client, PNG, "icon.webp", "text/html");
    expect(res.status).toBe(200);
    const avatarId = (await json(res)).user.avatar_id as string;
    expect(avatarId).toMatch(/^[0-9a-f-]{36}$/);
    expect((await json(await client.get("/api/auth/me"))).user.avatar_id).toBe(avatarId);
    expect(await env.FILES.head(`avatars/${user.id}/${avatarId}`)).not.toBeNull();

    const got = await other.client.get(`/api/avatars/${avatarId}`);
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/png");
    expect(got.headers.get("x-content-type-options")).toBe("nosniff");
    expect(got.headers.get("content-security-policy")).toContain("sandbox");
    expect(got.headers.get("cache-control")).toContain("private");
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(PNG);
  });

  it("記事・一覧・利用者一覧にアイコンの ID が載る", async () => {
    const admin = await adminClient();
    const { client, user } = await memberClient(admin);
    const article = await createArticle(client, { title: "アイコン確認" });
    const avatarId = (await json(await uploadAvatar(client, JPEG, "me.jpg", "image/jpeg"))).user.avatar_id;

    const view = await json(await client.get(`/api/articles/${article.id}`));
    expect(view.article).toMatchObject({ created_by_avatar: avatarId, updated_by_avatar: avatarId, updated_by: user.id });
    const list = await json(await client.get(`/api/articles?q=${encodeURIComponent("アイコン確認")}`));
    expect(list.articles[0]).toMatchObject({ updated_by: user.id, updated_by_avatar: avatarId });
    const users = await json(await admin.get("/api/admin/users"));
    expect(users.users.find((u: { id: string }) => u.id === user.id).avatar_id).toBe(avatarId);
  });

  it("差し替えると古い画像は消え、削除すると頭文字表示（null）に戻る", async () => {
    const admin = await adminClient();
    const { user } = await json(await uploadAvatar(admin, PNG));
    const first = user.avatar_id as string;
    const second = (await json(await uploadAvatar(admin, JPEG, "b.jpg"))).user.avatar_id as string;
    expect(second).not.toBe(first);
    expect((await admin.get(`/api/avatars/${first}`)).status).toBe(404);
    expect(await env.FILES.head(`avatars/${user.id}/${first}`)).toBeNull();

    const del = await admin.del("/api/auth/avatar");
    expect(del.status).toBe(200);
    expect((await json(del)).user.avatar_id).toBeNull();
    expect((await json(await admin.get("/api/auth/me"))).user.avatar_id).toBeNull();
    expect((await admin.get(`/api/avatars/${second}`)).status).toBe(404);
    expect(await env.FILES.head(`avatars/${user.id}/${second}`)).toBeNull();
  });

  it("PNG・JPEG・WebP 以外や大きすぎる画像は拒否する", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    expect((await uploadAvatar(client, SVG, "x.svg", "image/svg+xml")).status).toBe(415);
    expect((await uploadAvatar(client, GIF, "x.gif", "image/gif")).status).toBe(415);
    expect((await uploadAvatar(client, new Uint8Array(0))).status).toBe(400);
    const big = new Uint8Array(1024 * 1024 + 1);
    big.set(PNG);
    expect((await uploadAvatar(client, big)).status).toBe(413);
    expect((await json(await client.get("/api/auth/me"))).user.avatar_id).toBeNull();
  });

  it("存在しない ID は 404", async () => {
    const admin = await adminClient();
    expect((await admin.get(`/api/avatars/${crypto.randomUUID()}`)).status).toBe(404);
  });
});
