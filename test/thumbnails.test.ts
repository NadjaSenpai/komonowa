import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { DRAFT_TTL_MS } from "../shared/drafts";
import { Client, adminClient, createArticle, json, memberClient } from "./helpers";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 1, 1, 1]);
const THUMB = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7]);
const WEBP_THUMB = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 9]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0]);
const PDF = new TextEncoder().encode("%PDF-1.7\n%test");
const VIDEO = "jNQXAC9IVRw";

function form(bytes: Uint8Array, name: string, thumb?: Uint8Array | string, thumbName = "thumb.png") {
  const f = new FormData();
  f.append("file", new File([bytes], name));
  if (typeof thumb === "string") f.append("thumb", thumb);
  else if (thumb) f.append("thumb", new File([thumb], thumbName));
  return f;
}

function upload(c: Client, articleId: string, bytes: Uint8Array, name: string, thumb?: Uint8Array | string, thumbName?: string) {
  return c.request(`/api/articles/${articleId}/attachments`, { method: "POST", body: form(bytes, name, thumb, thumbName) });
}

function uploadDraft(c: Client, bytes: Uint8Array, name: string, thumb?: Uint8Array) {
  return c.request("/api/attachments", { method: "POST", body: form(bytes, name, thumb) });
}

const bytesOf = async (res: Response) => new Uint8Array(await res.arrayBuffer());
const keyOf = async (id: string) => (await env.DB.prepare("SELECT r2_key FROM attachments WHERE id = ?").bind(id).first<{ r2_key: string }>())!.r2_key;

describe("添付画像の小さい版", () => {
  it("小さい版を付けて添付すると /thumb で返し、元の URL は元の画像のまま", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    const article = await createArticle(client);
    const { attachment } = await json(await upload(client, article.id, PNG, "写真.png", THUMB));

    const thumb = await client.get(`${attachment.url}/thumb`);
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get("content-type")).toBe("image/png");
    expect(thumb.headers.get("cache-control")).toContain("private");
    expect(await bytesOf(thumb)).toEqual(THUMB);
    expect(await bytesOf(await client.get(attachment.url))).toEqual(PNG);

    const webp = (await json(await upload(client, article.id, PNG, "b.png", WEBP_THUMB, "thumb.webp"))).attachment;
    const got = await client.get(`${webp.url}/thumb`);
    expect(got.headers.get("content-type")).toBe("image/webp");

    // WebP を作れないブラウザは JPEG で送る
    const jpeg = (await json(await upload(client, article.id, PNG, "c.png", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1]), "thumb.jpg"))).attachment;
    expect((await client.get(`${jpeg.url}/thumb`)).headers.get("content-type")).toBe("image/jpeg");
  });

  it("小さい版がなければ元の画像を返す（R2 から消えていても）", async () => {
    const admin = await adminClient();
    const article = await createArticle(admin);
    const plain = (await json(await upload(admin, article.id, PNG, "a.png"))).attachment;
    expect(await bytesOf(await admin.get(`${plain.url}/thumb`))).toEqual(PNG);

    const withThumb = (await json(await upload(admin, article.id, PNG, "b.png", THUMB))).attachment;
    await env.FILES.delete(`${await keyOf(withThumb.id)}.thumb`);
    const fallback = await admin.get(`${withThumb.url}/thumb`);
    expect(fallback.status).toBe(200);
    expect(await bytesOf(fallback)).toEqual(PNG);
  });

  it("画像以外や、WebP・JPEG・PNG 以外、大きすぎる小さい版は断る", async () => {
    const admin = await adminClient();
    const article = await createArticle(admin);
    expect((await upload(admin, article.id, PDF, "a.pdf", THUMB)).status).toBe(400);
    expect((await upload(admin, article.id, PNG, "a.png", "not a file")).status).toBe(400);
    expect((await upload(admin, article.id, PNG, "a.png", GIF, "thumb.gif")).status).toBe(415);
    const svg = new TextEncoder().encode("<svg onload=alert(1)>");
    expect((await upload(admin, article.id, PNG, "a.png", svg, "thumb.svg")).status).toBe(415);
    const big = new Uint8Array(200 * 1024 + 1);
    big.set(THUMB);
    expect((await upload(admin, article.id, PNG, "a.png", big)).status).toBe(413);
    const exact = new Uint8Array(200 * 1024);
    exact.set(THUMB);
    expect((await upload(admin, article.id, PNG, "a.png", exact)).status).toBe(201);
    // 断ったときは何も残さない
    const { results } = await env.DB.prepare("SELECT id FROM attachments WHERE article_id = ?").bind(article.id).all();
    expect(results).toHaveLength(1);
  });

  it("10MB ちょうどの画像に、上限いっぱいの小さい版を添えても受け付ける", async () => {
    const admin = await adminClient();
    const article = await createArticle(admin);
    const big = new Uint8Array(10 * 1024 * 1024);
    big.set(PNG);
    const thumb = new Uint8Array(200 * 1024);
    thumb.set(THUMB);
    expect((await upload(admin, article.id, big, "big.png", thumb)).status).toBe(201);
  });

  it("見える人の判定は元の添付と同じ", async () => {
    const admin = await adminClient();
    const a = await memberClient(admin);
    const b = await memberClient(admin);
    const article = await createArticle(a.client);
    const { attachment } = await json(await upload(a.client, article.id, PNG, "a.png", THUMB));
    expect((await new Client().get(`${attachment.url}/thumb`)).status).toBe(401);
    expect((await b.client.get(`${attachment.url}/thumb`)).status).toBe(200);

    const draft = (await json(await uploadDraft(a.client, PNG, "d.png", THUMB))).attachment;
    expect((await a.client.get(`${draft.url}/thumb`)).status).toBe(200);
    expect(await bytesOf(await a.client.get(`${draft.url}/thumb`))).toEqual(THUMB);
    expect((await b.client.get(`${draft.url}/thumb`)).status).toBe(404);

    await a.client.del(`/api/articles/${article.id}`);
    expect((await b.client.get(`${attachment.url}/thumb`)).status).toBe(404);
    expect((await admin.get(`${attachment.url}/thumb`)).status).toBe(200);
    expect((await admin.get("/api/attachments/00000000-0000-0000-0000-000000000000/thumb")).status).toBe(404);
  });

  it("添付の削除・記事の完全削除で小さい版も消える", async () => {
    const admin = await adminClient();
    const article = await createArticle(admin);
    const one = (await json(await upload(admin, article.id, PNG, "a.png", THUMB))).attachment;
    const oneKey = await keyOf(one.id);
    expect(await env.FILES.head(`${oneKey}.thumb`)).not.toBeNull();
    expect((await admin.del(one.url)).status).toBe(200);
    expect(await env.FILES.head(`${oneKey}.thumb`)).toBeNull();

    const two = (await json(await upload(admin, article.id, PNG, "b.png", THUMB))).attachment;
    const twoKey = await keyOf(two.id);
    await admin.del(`/api/articles/${article.id}`);
    expect((await admin.del(`/api/admin/trash/${article.id}`)).status).toBe(200);
    expect(await env.FILES.head(twoKey)).toBeNull();
    expect(await env.FILES.head(`${twoKey}.thumb`)).toBeNull();
  });

  it("使われなかった下書きの掃除で小さい版も消える", async () => {
    const admin = await adminClient();
    const old = (await json(await uploadDraft(admin, PNG, "old.png", THUMB))).attachment;
    await env.DB.prepare("UPDATE attachments SET created_at = ? WHERE id = ?")
      .bind(Date.now() - DRAFT_TTL_MS - 60 * 60 * 1000, old.id)
      .run();
    await uploadDraft(admin, PNG, "new.png");
    let gone = false;
    for (let i = 0; i < 20 && !gone; i++) {
      gone = (await env.FILES.head(`attachments/${old.id}.thumb`)) === null;
      if (!gone) await new Promise((r) => setTimeout(r, 50));
    }
    expect(gone).toBe(true);
    expect(await env.FILES.head(`attachments/${old.id}`)).toBeNull();
  });
});

describe("一覧の cover", () => {
  async function coverOf(c: Client, id: string) {
    const { articles } = await json(await c.get("/api/articles"));
    return articles.find((a: { id: string }) => a.id === id).cover;
  }
  const save = (c: Client, id: string, body: string) => c.put(`/api/articles/${id}`, { title: `記事${id.slice(0, 6)}`, body, tags: [], baseVersion: 1 });

  it("本文で最初に出てくる、その記事の画像添付を選ぶ", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    const other = await createArticle(client, { title: "ほかの記事" });
    const foreign = (await json(await upload(client, other.id, PNG, "x.png"))).attachment;
    const article = await createArticle(client, { title: "写真の記事" });
    const pdf = (await json(await upload(client, article.id, PDF, "a.pdf"))).attachment;
    const first = (await json(await upload(client, article.id, PNG, "1.png", THUMB))).attachment;
    const second = (await json(await upload(client, article.id, PNG, "2.png"))).attachment;
    const body = [
      `[資料](${pdf.url})`,
      `![資料を画像として](${pdf.url})`,
      `![外](https://example.com/a.png)`,
      `![よそ](${foreign.url})`,
      `![一枚目](${first.url})`,
      `![二枚目](${second.url})`,
    ].join("\n");
    expect((await save(client, article.id, body)).status).toBe(200);
    expect(await coverOf(client, article.id)).toBe(first.id);
    expect(await coverOf(client, other.id)).toBeNull();
    const { articles } = await json(await client.get("/api/articles"));
    expect(articles[0]).not.toHaveProperty("body");
  });

  it("下書き添付で作った記事でも選び、編集・復元のたびに選び直す", async () => {
    const admin = await adminClient();
    const draft = (await json(await uploadDraft(admin, PNG, "d.png", THUMB))).attachment;
    const res = await admin.post("/api/articles", { title: "下書きの写真", body: `![写真](${draft.url})`, tags: [], attachmentIds: [draft.id] });
    const { article } = await json(res);
    expect(await coverOf(admin, article.id)).toBe(draft.id);

    const put = await admin.put(`/api/articles/${article.id}`, { title: "下書きの写真", body: "写真を外した", tags: [], baseVersion: 1 });
    expect(put.status).toBe(200);
    expect(await coverOf(admin, article.id)).toBeNull();

    expect((await admin.post(`/api/articles/${article.id}/revisions/1/restore`, { baseVersion: 2 })).status).toBe(200);
    expect(await coverOf(admin, article.id)).toBe(draft.id);
  });

  it("画像より先に YouTube の動画の行があれば、動画を選ぶ", async () => {
    const admin = await adminClient();
    const article = await createArticle(admin, { title: "動画の記事" });
    const image = (await json(await upload(admin, article.id, PNG, "1.png", THUMB))).attachment;
    const pdf = (await json(await upload(admin, article.id, PDF, "a.pdf"))).attachment;
    const videoOf = async () => (await json(await admin.get("/api/articles"))).articles.find((a: { id: string }) => a.id === article.id).cover_video;
    const put = (body: string, baseVersion: number) => admin.put(`/api/articles/${article.id}`, { title: "動画の記事", body, tags: [], baseVersion });

    // 動画が先。画像でない添付や外部の画像が前にあっても動画
    const videoFirst = `![資料](${pdf.url})\n![外](https://example.com/a.png)\n\nhttps://youtu.be/${VIDEO}?t=90\n\n![写真](${image.url})`;
    expect((await put(videoFirst, 1)).status).toBe(200);
    expect(await videoOf()).toBe(VIDEO);
    expect(await coverOf(admin, article.id)).toBe(image.id);

    // 画像が先なら画像
    expect((await put(`![写真](${image.url})\n\nhttps://youtu.be/${VIDEO}`, 2)).status).toBe(200);
    expect(await videoOf()).toBeNull();
    expect(await coverOf(admin, article.id)).toBe(image.id);

    // 動画を外すと消え、復元すると戻る
    expect((await put("文字だけ", 3)).status).toBe(200);
    expect(await videoOf()).toBeNull();
    expect((await admin.post(`/api/articles/${article.id}/revisions/2/restore`, { baseVersion: 4 })).status).toBe(200);
    expect(await videoOf()).toBe(VIDEO);
  });

  it("文中の URL やコードブロックの中の URL は動画として選ばない", async () => {
    const admin = await adminClient();
    const fence = "```";
    const bodies = [
      `この動画 https://youtu.be/${VIDEO} を見て`,
      `https://youtu.be/${VIDEO}\n続きの行`,
      `${fence}\n\nhttps://youtu.be/${VIDEO}\n\n${fence}`,
      "https://example.com/watch?v=jNQXAC9IVRw",
    ];
    for (const [i, body] of bodies.entries()) {
      const article = await createArticle(admin, { title: `動画なし${i}`, body });
      const { articles } = await json(await admin.get("/api/articles"));
      expect(articles.find((a: { id: string }) => a.id === article.id).cover_video, body).toBeNull();
    }
  });

  it("画像がなければ null", async () => {
    const admin = await adminClient();
    const article = await createArticle(admin, { body: "文字だけ" });
    expect(await coverOf(admin, article.id)).toBeNull();
  });
});
