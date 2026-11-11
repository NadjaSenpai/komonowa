import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { Client, adminClient, createArticle, json, memberClient } from "./helpers";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const PDF = new TextEncoder().encode("%PDF-1.7\n%test");

function upload(c: Client, articleId: string, bytes: Uint8Array, name: string, type = "application/octet-stream") {
  const form = new FormData();
  form.append("file", new File([bytes], name, { type }));
  return c.request(`/api/articles/${articleId}/attachments`, { method: "POST", body: form });
}

describe("添付ファイル", () => {
  it("認証済みのときだけ取得でき、R2 には非公開で保存する", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    const article = await createArticle(client);
    const res = await upload(client, article.id, PNG, "図 1.png", "text/html");
    expect(res.status).toBe(201);
    const { attachment } = await json(res);
    expect(attachment.content_type).toBe("image/png");

    const got = await client.get(attachment.url);
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/png");
    expect(got.headers.get("x-content-type-options")).toBe("nosniff");
    expect(got.headers.get("cache-control")).toContain("private");
    expect(got.headers.get("content-disposition")).toContain("filename*=UTF-8''%E5%9B%B3%201.png");
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(PNG);

    expect((await new Client().get(attachment.url)).status).toBe(401);
    const listed = await json(await client.get(`/api/articles/${article.id}`));
    expect(listed.attachments).toHaveLength(1);
  });

  it("未ログインではアップロードできない", async () => {
    const admin = await adminClient();
    const article = await createArticle(admin);
    expect((await upload(new Client(), article.id, PNG, "a.png")).status).toBe(401);
  });

  it("10MB を超えるファイルを拒否する", async () => {
    const admin = await adminClient();
    const article = await createArticle(admin);
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(PDF);
    expect((await upload(admin, article.id, big, "big.pdf")).status).toBe(413);
    const exact = new Uint8Array(10 * 1024 * 1024);
    exact.set(PDF);
    expect((await upload(admin, article.id, exact, "ok.pdf")).status).toBe(201);
  });

  it("許可しない種類や中身が一致しないファイルを拒否する", async () => {
    const admin = await adminClient();
    const article = await createArticle(admin);
    const svg = new TextEncoder().encode("<svg onload=alert(1)>");
    expect((await upload(admin, article.id, svg, "x.svg", "image/svg+xml")).status).toBe(415);
    expect((await upload(admin, article.id, svg, "x.html")).status).toBe(415);
    expect((await upload(admin, article.id, svg, "fake.png", "image/png")).status).toBe(415);
    expect((await upload(admin, article.id, new Uint8Array([0x61, 0, 0x62]), "bin.txt")).status).toBe(415);
    expect((await upload(admin, article.id, new Uint8Array(), "empty.txt")).status).toBe(400);
    expect((await upload(admin, article.id, new TextEncoder().encode("a,b\n1,2"), "data.csv")).status).toBe(201);
    expect((await upload(admin, article.id, new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1]), "doc.docx")).status).toBe(201);
  });

  it("文書はダウンロード扱い、PDF は表示扱いで返す", async () => {
    const admin = await adminClient();
    const article = await createArticle(admin);
    const csv = (await json(await upload(admin, article.id, new TextEncoder().encode("a,b"), "表.csv"))).attachment;
    expect((await admin.get(csv.url)).headers.get("content-disposition")).toMatch(/^attachment;/);
    const pdf = (await json(await upload(admin, article.id, PDF, "資料.pdf"))).attachment;
    expect((await admin.get(pdf.url)).headers.get("content-disposition")).toMatch(/^inline;/);
  });

  it("削除済み記事の添付はメンバーから見えず、完全削除で R2 からも消える", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    const article = await createArticle(client);
    const { attachment } = await json(await upload(client, article.id, PDF, "a.pdf"));
    const row = await env.DB.prepare("SELECT r2_key FROM attachments WHERE id = ?").bind(attachment.id).first<{ r2_key: string }>();

    await client.del(`/api/articles/${article.id}`);
    expect((await client.get(attachment.url)).status).toBe(404);
    expect((await upload(client, article.id, PDF, "b.pdf")).status).toBe(404);
    expect((await admin.get(attachment.url)).status).toBe(200);

    expect((await admin.del(`/api/admin/trash/${article.id}`)).status).toBe(200);
    expect(await env.FILES.get(row!.r2_key)).toBeNull();
    expect((await admin.get(attachment.url)).status).toBe(404);
  });

  it("添付の削除は本人か管理者のみ", async () => {
    const admin = await adminClient();
    const a = await memberClient(admin);
    const b = await memberClient(admin);
    const article = await createArticle(a.client);
    const { attachment } = await json(await upload(a.client, article.id, PDF, "a.pdf"));
    expect((await b.client.del(attachment.url)).status).toBe(403);
    expect((await a.client.del(attachment.url)).status).toBe(200);
    expect((await a.client.get(attachment.url)).status).toBe(404);
  });
});
