import { describe, expect, it } from "vitest";
import type { ConvertedPage } from "../../shared/cosense";
import { titleKey } from "../../shared/wikilinks";
import { buildRows, renameRow } from "../cosenseImport";

const page = (title: string, body = "本文"): ConvertedPage => ({ title, body, tags: [], created: 0, updated: 0, images: 0 });

describe("buildRows", () => {
  it("問題のないページはチェック済み", () => {
    expect(buildRows([page("新規")], new Set()).map((r) => [r.title, r.checked, r.problem])).toEqual([["新規", true, null]]);
  });

  it("既存と同名のページはチェックを外し taken にする", () => {
    const [row] = buildRows([page("ＭＥＭＯ")], new Set([titleKey("memo")]));
    expect(row).toMatchObject({ checked: false, problem: "taken" });
  });

  it("JSON の中で同じ titleKey になる 2 つ目以降は duplicate", () => {
    const rows = buildRows([page("Memo"), page("memo"), page("ＭＥＭＯ")], new Set());
    expect(rows.map((r) => r.problem)).toEqual([null, "duplicate", "duplicate"]);
    expect(rows.map((r) => r.checked)).toEqual([true, false, false]);
  });

  it("本文が 200,000 文字を超えるページは too-long", () => {
    const [row] = buildRows([page("長い", "あ".repeat(200_001))], new Set());
    expect(row).toMatchObject({ checked: false, problem: "too-long" });
  });
});

describe("renameRow", () => {
  it("重ならない名前にすると問題が消える（チェックは利用者が付ける）", () => {
    const taken = new Set([titleKey("手順書")]);
    const rows = buildRows([page("手順書")], taken);
    const [row] = renameRow(rows, rows[0]!.key, "手順書（Cosense）", taken);
    expect(row).toMatchObject({ title: "手順書（Cosense）", problem: null, checked: false });
  });

  it("ほかの行と重なる名前にすると duplicate", () => {
    const rows = buildRows([page("A"), page("B")], new Set());
    const renamed = renameRow(rows, rows[1]!.key, "a", new Set());
    expect(renamed[1]).toMatchObject({ problem: "duplicate", checked: false });
  });

  it("長すぎる本文は名前を変えても too-long のまま", () => {
    const rows = buildRows([page("長い", "あ".repeat(200_001))], new Set());
    expect(renameRow(rows, rows[0]!.key, "別名", new Set())[0]!.problem).toBe("too-long");
  });
});
