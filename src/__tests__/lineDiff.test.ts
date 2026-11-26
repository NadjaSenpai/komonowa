import { describe, expect, it } from "vitest";
import { diffChars, diffLines, diffTags, foldContext, type DiffLine } from "../lineDiff";

const kinds = (lines: DiffLine[]) => lines.map((l) => `${l.kind}:${l.text}`);
const changed = (parts: { text: string; changed: boolean }[] | undefined) =>
  (parts ?? [])
    .filter((p) => p.changed)
    .map((p) => p.text)
    .join("|");

describe("diffLines", () => {
  it("同じ本文は全部 same", () => {
    expect(kinds(diffLines("a\nb", "a\nb"))).toEqual(["same:a", "same:b"]);
  });

  it("書き換えた行は del と add が並び、変わった文字だけが changed", () => {
    const lines = diffLines("前\n管理画面から招待を押す\n後", "前\n管理画面からメンバーを招待を押す\n後");
    expect(kinds(lines)).toEqual(["same:前", "del:管理画面から招待を押す", "add:管理画面からメンバーを招待を押す", "same:後"]);
    expect(changed(lines[1]!.parts)).toBe("");
    expect(changed(lines[2]!.parts)).toBe("メンバーを");
  });

  it("改行コードの違いだけなら全部 same", () => {
    expect(kinds(diffLines("a\r\nb\r\n", "a\nb\n"))).toEqual(["same:a", "same:b", "same:"]);
  });

  it("末尾の改行を足すと add が 1 行だけ", () => {
    expect(kinds(diffLines("a\nb", "a\nb\n"))).toEqual(["same:a", "same:b", "add:"]);
  });

  it("追加と削除の数が違う区間には行内の強調を付けない", () => {
    const lines = diffLines("a\nx\nb", "a\ny\nz\nb");
    expect(kinds(lines)).toEqual(["same:a", "del:x", "add:y", "add:z", "same:b"]);
    expect(lines.every((l) => l.parts === undefined)).toBe(true);
  });

  it("長い本文の全面書き換えも短い時間で終わる", () => {
    const before = Array.from({ length: 2001 }, (_, i) => `前${i}`).join("\n");
    const after = Array.from({ length: 2001 }, (_, i) => `後${i}`).join("\n");
    const start = performance.now();
    const lines = diffLines(before, after);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(lines.filter((l) => l.kind === "del")).toHaveLength(2001);
    expect(lines.filter((l) => l.kind === "add")).toHaveLength(2001);
  });
});

describe("diffChars", () => {
  it("両側の変わった部分を返す", () => {
    const d = diffChars("abcdef", "abXdef")!;
    expect(changed(d.before)).toBe("c");
    expect(changed(d.after)).toBe("X");
    expect(d.before.map((p) => p.text).join("")).toBe("abcdef");
    expect(d.after.map((p) => p.text).join("")).toBe("abXdef");
  });

  it("長すぎる行は null", () => {
    expect(diffChars("a".repeat(1001), "b".repeat(1000))).toBeNull();
  });
});

describe("foldContext", () => {
  it("変更の前後 3 行だけ残し、ほかはたたむ", () => {
    const same = (t: string): DiffLine => ({ kind: "same", text: t });
    const lines = [...["1", "2", "3", "4", "5"].map(same), { kind: "add" as const, text: "x" }, ...["6", "7", "8", "9", "10"].map(same)];
    expect(foldContext(lines).map((b) => (b.kind === "skip" ? `skip:${b.count}` : b.text))).toEqual(["skip:2", "3", "4", "5", "x", "6", "7", "8", "skip:2"]);
  });

  it("変更がなければ全部たたむ", () => {
    expect(foldContext([{ kind: "same", text: "a" }])).toEqual([{ kind: "skip", count: 1 }]);
  });
});

describe("diffTags", () => {
  it("足したタグと外したタグ", () => {
    expect(diffTags(["a", "b"], ["b", "c"])).toEqual({ added: ["c"], removed: ["a"] });
  });
});
