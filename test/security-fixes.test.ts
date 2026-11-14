import { describe, expect, it } from "vitest";
import { sha256 } from "../worker/crypto";
import { Client, adminClient, createArticle, json, memberClient } from "./helpers";

async function lockedShare() {
  const admin = await adminClient();
  const article = await createArticle(admin);
  const { share } = await json(await admin.post(`/api/articles/${article.id}/share`));
  const token = share.url.split("/s/")[1] as string;
  const passcode = (await json(await admin.post(`/api/articles/${article.id}/share/passcode`))).share.passcode as string;
  return { admin, article, token, passcode };
}

describe("共有パスワードの鍵", () => {
  it("URL とパスワードから計算した鍵では読めない（unlock を通した鍵だけ）", async () => {
    const { token, passcode } = await lockedShare();
    const forged = new Client();
    forged.cookie = `share_key=${await sha256(`${token}:${passcode}`)}`;
    expect((await forged.get(`/api/share/${token}`)).status).toBe(403);

    const friend = new Client();
    expect((await friend.post(`/api/share/${token}/unlock`, { passcode })).status).toBe(200);
    expect(friend.cookie).toMatch(/^share_key=/);
    expect(friend.cookie).not.toBe(forged.cookie);
    expect((await friend.get(`/api/share/${token}`)).status).toBe(200);
  });
});

describe("回数制限を同時に送ってもすり抜けない", () => {
  it("共有パスワード：同時に 30 回送っても、確かめるのは 5 回まで", async () => {
    const { token, passcode } = await lockedShare();
    const wrong = (i: number) => String((Number(passcode) + 1 + i) % 1_000_000).padStart(6, "0");
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => new Client().post(`/api/share/${token}/unlock`, { passcode: wrong(i) })));
    expect(results.filter((r) => r.status === 403)).toHaveLength(5);
    expect(results.filter((r) => r.status === 429)).toHaveLength(25);
    // 止められた試しは数に入れない（制限が延々と延びないように）。正しくても待たされる
    expect((await new Client().post(`/api/share/${token}/unlock`, { passcode })).status).toBe(429);
  });

  it("ログイン：同時に 30 回送っても、確かめるのは 10 回まで", async () => {
    const admin = await adminClient();
    const member = await memberClient(admin);
    const results = await Promise.all(
      Array.from({ length: 30 }, () => new Client().post("/api/auth/login", { email: member.email, password: "wrong-password-0" })),
    );
    expect(results.filter((r) => r.status === 401)).toHaveLength(10);
    expect(results.filter((r) => r.status === 429)).toHaveLength(20);
    expect((await new Client().post("/api/auth/login", { email: member.email, password: member.password })).status).toBe(429);
  });
});
