import { describe, expect, it } from "vitest";
import { adminClient, createArticle, json, memberClient } from "./helpers";

describe("関連ページ（2ホップ）", () => {
  it("同じリンク先を持つ記事を、共通のリンク先ごとに返す。自分・ごみ箱の記事は含めない", async () => {
    const admin = await adminClient();
    const { client } = await memberClient(admin);
    await createArticle(admin, { title: "Cloudflare" });
    const me = await createArticle(client, { title: "デプロイ手順", body: "[[Cloudflare]] と [[まだない記事]] を見る" });
    const sameTarget = await createArticle(admin, { title: "料金メモ", body: "[[cloudflare]] の料金" });
    const sameMissing = await createArticle(admin, { title: "宿題", body: "[[まだない記事]] を書く" });
    const trashed = await createArticle(admin, { title: "捨てるメモ", body: "[[Cloudflare]]" });
    await createArticle(admin, { title: "関係ない", body: "[[べつの話]]" });
    await admin.del(`/api/articles/${trashed.id}`);

    const { related } = await json(await client.get(`/api/articles/${me.id}`));
    expect(related).toEqual([
      { id: sameTarget.id, title: "料金メモ", updated_at: expect.any(Number), via: "Cloudflare" },
      { id: sameMissing.id, title: "宿題", updated_at: expect.any(Number), via: "まだない記事" },
    ]);
  });

  it("リンクのない記事では空", async () => {
    const admin = await adminClient();
    const article = await createArticle(admin, { body: "リンクなし" });
    expect((await json(await admin.get(`/api/articles/${article.id}`))).related).toEqual([]);
  });
});
