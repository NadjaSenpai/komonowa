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

const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 0, 0]);

function uploadDraft(c: Client, bytes: Uint8Array, name: string) {
  const form = new FormData();
  form.append("file", new File([bytes], name));
  return c.request("/api/attachments", { method: "POST", body: form });
}

describe("下書き添付（保存前の記事への差し込み）", () => {
  it("未ログインではアップロードできない", async () => {
    expect((await uploadDraft(new Client(), PNG, "a.png")).status).toBe(401);
  });

  it("保存前は本人だけが見られ、記事を作るとひもづいてほかの人も見られる", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    const other = await memberClient(admin);

    const res = await uploadDraft(client, PNG, "スクショ.png");
    expect(res.status).toBe(201);
    const { attachment } = await json(res);
    expect(attachment.url).toBe(`/api/attachments/${attachment.id}`);
    expect((await client.get(attachment.url)).status).toBe(200);
    expect((await other.client.get(attachment.url)).status).toBe(404);
    expect((await admin.get(attachment.url)).status).toBe(404);

    const article = await createArticleWith(client, `![図](${attachment.url})`, [attachment.id]);
    const view = await json(await other.client.get(`/api/articles/${article.id}`));
    expect(view.attachments.map((a: { id: string }) => a.id)).toEqual([attachment.id]);
    expect((await other.client.get(attachment.url)).status).toBe(200);
  });

  it("他人の下書きはひもづけられず、削除もできない", async () => {
    const admin = await adminClient();
    const owner = await memberClient(admin);
    const thief = await memberClient(admin);
    const { attachment } = await json(await uploadDraft(owner.client, PNG, "a.png"));

    const article = await createArticleWith(thief.client, "盗用", [attachment.id]);
    expect((await json(await thief.client.get(`/api/articles/${article.id}`))).attachments).toEqual([]);
    expect((await thief.client.get(attachment.url)).status).toBe(404);
    expect((await thief.client.del(attachment.url)).status).toBe(404);
    expect((await owner.client.del(attachment.url)).status).toBe(200);
    expect((await owner.client.get(attachment.url)).status).toBe(404);
  });

  it("ID の形式が正しくなければ 400", async () => {
    const admin = await adminClient();
    const res = await admin.post("/api/articles", { title: "x", body: "", attachmentIds: ["../etc"] });
    expect(res.status).toBe(400);
  });

  it("1日たっても使われなかった下書きは、次のアップロードのついでに消える", async () => {
    const admin = await adminClient();
    const old = (await json(await uploadDraft(admin, PNG, "old.png"))).attachment;
    await env.DB.prepare("UPDATE attachments SET created_at = ? WHERE id = ?").bind(Date.now() - 25 * 60 * 60 * 1000, old.id).run();
    const fresh = (await json(await uploadDraft(admin, PNG, "new.png"))).attachment;

    let gone = false;
    for (let i = 0; i < 20 && !gone; i++) {
      gone = (await env.DB.prepare("SELECT 1 FROM attachments WHERE id = ?").bind(old.id).first()) === null;
      if (!gone) await new Promise((r) => setTimeout(r, 50));
    }
    expect(gone).toBe(true);
    expect(await env.FILES.head(`attachments/${old.id}`)).toBeNull();
    expect((await admin.get(fresh.url)).status).toBe(200);
  });
});

describe("ZIP", () => {
  it("ZIP を添付でき、ダウンロードとして返す", async () => {
    const admin = await adminClient();
    const article = await createArticle(admin);
    const res = await upload(admin, article.id, ZIP, "資料.zip");
    expect(res.status).toBe(201);
    const { attachment } = await json(res);
    const got = await admin.get(attachment.url);
    expect(got.headers.get("content-type")).toBe("application/zip");
    expect(got.headers.get("content-disposition")).toMatch(/^attachment;/);
  });

  it("空の ZIP も添付できるが、空の Office 文書は中身が不正として拒否する", async () => {
    const admin = await adminClient();
    const article = await createArticle(admin);
    const empty = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]);
    expect((await upload(admin, article.id, empty, "空.zip")).status).toBe(201);
    expect((await upload(admin, article.id, empty, "空.docx")).status).toBe(415);
  });

  it("中身が ZIP でなければ拒否する", async () => {
    const admin = await adminClient();
    const article = await createArticle(admin);
    expect((await upload(admin, article.id, PDF, "偽物.zip")).status).toBe(415);
  });
});

async function createArticleWith(c: Client, body: string, attachmentIds: string[]) {
  const res = await c.post("/api/articles", { title: "差し込み", body, tags: [], attachmentIds });
  if (res.status !== 201) throw new Error(`create failed: ${res.status} ${await res.text()}`);
  return (await json(res)).article;
}
