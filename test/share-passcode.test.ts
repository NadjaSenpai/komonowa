import { describe, expect, it } from "vitest";
import { randomPasscode } from "../worker/crypto";
import { Client, adminClient, createArticle, json, memberClient } from "./helpers";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 5]);
const WAIT = "間違いが続いたため、15分ほど待ってからもう一度試してください";

async function setup() {
  const admin = await adminClient();
  const member = await memberClient(admin);
  const article = await createArticle(member.client, { title: "鍵付き" });
  const form = new FormData();
  form.append("file", new File([PNG], "図.png"));
  const { attachment } = await json(await member.client.request(`/api/articles/${article.id}/attachments`, { method: "POST", body: form }));
  const { share } = await json(await member.client.post(`/api/articles/${article.id}/share`));
  const token = share.url.split("/s/")[1] as string;
  return { admin, member, article, attachment, token };
}

const lock = async (c: Client, id: string) => (await json(await c.post(`/api/articles/${id}/share/passcode`))).share.passcode as string;
const unlock = (c: Client, token: string, passcode: string) => c.post(`/api/share/${token}/unlock`, { passcode });
const read = (c: Client, token: string) => c.get(`/api/share/${token}`);
const file = (c: Client, token: string, id: string) => c.get(`/api/share/${token}/attachments/${id}`);
/** 正しいパスワードと違う 6 桁 */
const wrongOf = (p: string) => String((Number(p) + 1) % 1_000_000).padStart(6, "0");

describe("パスワードの付け外し", () => {
  it("6 桁の数字を作る", () => {
    for (let i = 0; i < 200; i++) expect(randomPasscode()).toMatch(/^\d{6}$/);
  });

  it("未ログインでは付け外しできず、共有していない記事は 404", async () => {
    const { article } = await setup();
    expect((await new Client().post(`/api/articles/${article.id}/share/passcode`)).status).toBe(401);
    expect((await new Client().del(`/api/articles/${article.id}/share/passcode`)).status).toBe(401);
    const admin = await adminClient();
    const plain = await createArticle(admin);
    expect((await admin.post(`/api/articles/${plain.id}/share/passcode`)).status).toBe(404);
  });

  it("メンバーも管理者も付けられ、作り直すと変わり、外すと null", async () => {
    const { admin, member, article } = await setup();
    const first = await lock(member.client, article.id);
    expect(first).toMatch(/^\d{6}$/);
    expect((await json(await member.client.get(`/api/articles/${article.id}`))).share.passcode).toBe(first);
    let second = await lock(admin, article.id);
    for (let i = 0; second === first && i < 5; i++) second = await lock(admin, article.id);
    expect(second).not.toBe(first);
    const removed = await member.client.del(`/api/articles/${article.id}/share/passcode`);
    expect((await json(removed)).share.passcode).toBeNull();
    expect((await json(await admin.get("/api/admin/shares"))).shares[0].has_passcode).toBe(false);
    await lock(member.client, article.id);
    expect((await json(await admin.get("/api/admin/shares"))).shares[0].has_passcode).toBe(true);
  });
});

describe("パスワード付きの共有ページ", () => {
  it("鍵がなければ本文も添付も 403 で、401 にはしない", async () => {
    const { member, article, attachment, token } = await setup();
    await lock(member.client, article.id);
    for (const res of [await read(new Client(), token), await file(new Client(), token, attachment.id), await read(member.client, token)]) {
      expect(res.status).toBe(403);
      expect(await json(res)).toEqual({ error: "パスワードを入れてください", needsPasscode: true });
    }
  });

  it("違うパスワードは断り、正しいと鍵のクッキーで本文と添付が読める", async () => {
    const { member, article, attachment, token } = await setup();
    const passcode = await lock(member.client, article.id);
    const friend = new Client();
    const wrong = await unlock(friend, token, wrongOf(passcode));
    expect(wrong.status).toBe(403);
    expect(await json(wrong)).toEqual({ error: "パスワードが違います", needsPasscode: true });

    const ok = await unlock(friend, token, passcode);
    expect(ok.status).toBe(200);
    const cookie = ok.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^share_key=/);
    expect(cookie).toContain(`Path=/api/share/${token}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Max-Age=2592000");

    expect((await read(friend, token)).status).toBe(200);
    expect((await file(friend, token, attachment.id)).status).toBe(200);
  });

  it("作り直すと古い鍵では読めず、外すと誰でも読め、止めると 404", async () => {
    const { member, article, token } = await setup();
    const friend = new Client();
    await unlock(friend, token, await lock(member.client, article.id));
    expect((await read(friend, token)).status).toBe(200);

    await lock(member.client, article.id);
    expect((await read(friend, token)).status).toBe(403);

    await member.client.del(`/api/articles/${article.id}/share/passcode`);
    expect((await read(new Client(), token)).status).toBe(200);
    expect((await unlock(new Client(), token, "000000")).status).toBe(200);

    await member.client.del(`/api/articles/${article.id}/share`);
    expect((await read(friend, token)).status).toBe(404);
    expect((await unlock(new Client(), token, "000000")).status).toBe(404);
  });

  it("5 回間違えると正しいパスワードでも待たされ、作り直すと解ける", async () => {
    const { member, article, token } = await setup();
    const passcode = await lock(member.client, article.id);
    const stranger = new Client();
    for (let i = 0; i < 5; i++) expect((await unlock(stranger, token, wrongOf(passcode))).status).toBe(403);
    const blocked = await unlock(new Client(), token, passcode);
    expect(blocked.status).toBe(429);
    expect((await json(blocked)).error).toBe(WAIT);

    const fresh = await lock(member.client, article.id);
    expect((await unlock(new Client(), token, fresh)).status).toBe(200);
  });
});
