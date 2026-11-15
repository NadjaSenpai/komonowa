import { beforeEach, describe, expect, it } from "vitest";
import { draftKey, loadDraft, saveDraft, removeDraft } from "../articleDraft";

describe("記事の下書き退避", () => {
  beforeEach(() => localStorage.clear());
  const value = { title: "手順", body: "書きかけ", tags: "運用", baseVersion: 3, draftIds: ["file-id"] };
  it("利用者と記事で分離し、版と添付も復元する", () => {
    const key = draftKey("alice", "article");
    expect(saveDraft(key, value)).toBe(true);
    expect(loadDraft(key)).toMatchObject(value);
    expect(loadDraft(draftKey("bob", "article"))).toBeNull();
    expect(loadDraft(draftKey("alice"))).toBeNull();
    removeDraft(key);
    expect(loadDraft(key)).toBeNull();
  });
  it("壊れたデータと7日以上前の退避を復元しない", () => {
    const key = draftKey("alice");
    localStorage.setItem(key, "{");
    expect(loadDraft(key)).toBeNull();
    localStorage.setItem(key, JSON.stringify({ ...value, savedAt: Date.now() - 7 * 86400000 }));
    expect(loadDraft(key)).toBeNull();
    localStorage.setItem(key, JSON.stringify({ ...value, baseVersion: "3", savedAt: Date.now() }));
    expect(loadDraft(key)).toBeNull();
  });
});
