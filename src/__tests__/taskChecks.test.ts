import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderMarkdown } from "../markdown";
import { anyTaskChecked, clearTaskChecks, prepareTaskBoxes, toggleTaskBox } from "../taskChecks";

const KEY = "komonowa:task-checks:a1";

function mount(markdown: string) {
  const root = document.createElement("div");
  root.innerHTML = renderMarkdown(markdown);
  prepareTaskBoxes(root, "a1");
  return { root, boxes: [...root.querySelectorAll(".task-box")] };
}

const stored = () => JSON.parse(localStorage.getItem(KEY) ?? "null");

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("チェックリストの付け外し", () => {
  it("操作できる形にする", () => {
    const { boxes } = mount("- [ ] 牛乳");
    expect(boxes[0]!.getAttribute("role")).toBe("checkbox");
    expect(boxes[0]!.getAttribute("aria-checked")).toBe("false");
    expect(boxes[0]!.getAttribute("tabindex")).toBe("0");
    expect(boxes[0]!.getAttribute("title")).toBe("このブラウザにだけ保存されます");
  });

  it("切り替えると印・aria・done が変わり、覚える", () => {
    const { root, boxes } = mount("- [ ] 牛乳");
    toggleTaskBox(boxes[0]!, root, "a1");
    expect(boxes[0]!.textContent).toBe("☑");
    expect(boxes[0]!.getAttribute("aria-checked")).toBe("true");
    expect(boxes[0]!.closest("li")!.classList.contains("done")).toBe(true);
    expect(stored()).toEqual({ "牛乳#0": true });
  });

  it("同じ文字の項目は何番目かで区別する", () => {
    const { root, boxes } = mount("- [ ] 牛乳\n- [ ] 牛乳");
    toggleTaskBox(boxes[1]!, root, "a1");
    expect(boxes.map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "true"]);
    expect(stored()).toEqual({ "牛乳#1": true });
  });

  it("覚えた状態は順番が変わっても文字についていく", () => {
    const first = mount("- [ ] 牛乳\n- [ ] たまご");
    toggleTaskBox(first.boxes[0]!, first.root, "a1");
    const { boxes } = mount("- [ ] たまご\n- [ ] 牛乳");
    expect(boxes.map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "true"]);
  });

  it("覚えていない項目は本文どおり、[x] も外せる", () => {
    const { root, boxes } = mount("- [x] 済み");
    expect(boxes[0]!.getAttribute("aria-checked")).toBe("true");
    toggleTaskBox(boxes[0]!, root, "a1");
    expect(boxes[0]!.textContent).toBe("☐");
    expect(stored()).toEqual({ "済み#0": false });
  });

  it("すべて外す", () => {
    const { root, boxes } = mount("- [ ] a\n- [ ] b");
    boxes.forEach((b) => toggleTaskBox(b, root, "a1"));
    expect(anyTaskChecked(root)).toBe(true);
    clearTaskChecks(root, "a1");
    expect(boxes.map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "false"]);
    expect(anyTaskChecked(root)).toBe(false);
    expect(stored()).toEqual({ "a#0": false, "b#0": false });
  });

  it("空行をはさんだリスト（項目が段落に包まれる）でも付け外しできる", () => {
    const { root, boxes } = mount("- [ ] 1\n- [ ] 2\n\n- [ ] 3");
    expect(boxes[0]!.parentElement!.tagName).toBe("P");
    toggleTaskBox(boxes[2]!, root, "a1");
    expect(boxes[2]!.closest("li")!.classList.contains("done")).toBe(true);
    expect(stored()).toEqual({ "3#0": true });
  });

  it("入れ子の子の文字は親の項目キーに含めない", () => {
    const { root, boxes } = mount("- [ ] 親\n  - [ ] 子");
    toggleTaskBox(boxes[0]!, root, "a1");
    expect(stored()).toEqual({ "親#0": true });
  });

  it("localStorage が使えなくても切り替わる", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { root, boxes } = mount("- [ ] 牛乳");
    expect(() => toggleTaskBox(boxes[0]!, root, "a1")).not.toThrow();
    expect(boxes[0]!.textContent).toBe("☑");
  });

  it("壊れた記録は無視する", () => {
    localStorage.setItem(KEY, "{壊れ");
    const { boxes } = mount("- [ ] 牛乳\n- [x] 済み");
    expect(boxes.map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "true"]);
  });
});
