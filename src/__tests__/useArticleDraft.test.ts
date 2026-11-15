import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftKey, loadDraft, saveDraft, type DraftContent } from "../articleDraft";
import { useArticleDraft } from "../useArticleDraft";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const initial: DraftContent = { title: "題", body: "本文", tags: "運用", baseVersion: 3, draftIds: [] };
let controller: ReturnType<typeof useArticleDraft>;
function Probe({ value, storageKey, dirty }: { value: DraftContent; storageKey: string; dirty: boolean }) {
  controller = useArticleDraft(storageKey, value, true, dirty);
  return null;
}
describe("下書きの復元と退避", () => {
  let root: Root;
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    root = createRoot(document.createElement("div"));
  });
  afterEach(async () => {
    await act(() => root.unmount());
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  async function render(value: DraftContent, dirty = true, storageKey = draftKey("alice", "article")) {
    await act(() => root.render(createElement(Probe, { value, dirty, storageKey })));
  }
  async function tick() {
    await act(() => vi.advanceTimersByTime(600));
  }
  it("復元の選択前は上書きせず、復元後も元の版を維持する", async () => {
    const key = draftKey("alice", "article");
    saveDraft(key, initial);
    await render({ ...initial, body: "サーバーの最新版", baseVersion: 4 }, false);
    await tick();
    expect(controller.pending).toMatchObject(initial);
    expect(loadDraft(key)?.body).toBe("本文");
    await act(() => controller.resolve());
    await render(initial);
    await tick();
    expect(controller.pending).toBeNull();
    expect(loadDraft(key)?.baseVersion).toBe(3);
  });
  it("入力変更後は未退避になり、保存成功後のclearで再生成しない", async () => {
    const key = draftKey("alice", "article");
    await render(initial);
    await tick();
    expect(controller.savedAt).not.toBeNull();
    await render({ ...initial, body: "変更" });
    expect(controller.savedAt).toBeNull();
    await act(() => controller.clear());
    await tick();
    expect(loadDraft(key)).toBeNull();
  });
  it("容量不足を表示し、退避成功とは表示しない", async () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    await render(initial);
    await tick();
    expect(controller.error).toBe(true);
    expect(controller.savedAt).toBeNull();
  });
});
