import { describe, expect, it } from "vitest";
import { extractWikiLinks, titleKey, wikiPath } from "./wikilinks";

describe("titleKey", () => {
  it("全角・大文字・前後や連続の空白をそろえる", () => {
    expect(titleKey("  Ｄｏｃｋｅｒ　 入門 ")).toBe("docker 入門");
    expect(titleKey("Docker 入門")).toBe(titleKey("docker　入門"));
  });
});

describe("extractWikiLinks", () => {
  it("[[ ]] を順に拾い、キーが同じものは最初の表記だけ残す", () => {
    expect(extractWikiLinks("[[手順書]] と [[ Docker ]] と [[docker]]")).toEqual(["手順書", "Docker"]);
  });

  it("コードの中、空、改行や角かっこを含むもの、201文字以上は拾わない", () => {
    const md = "`[[a]]`\n\n```\n[[b]]\n```\n\n[[ ]] [[　]] [[c\nd]] [[e[f]]] [[" + "x".repeat(201) + "]]";
    expect(extractWikiLinks(md)).toEqual([]);
  });

  it("見出し・リスト・表の中も拾う", () => {
    expect(extractWikiLinks("# [[A]]\n\n- [[B]]\n\n| x |\n|---|\n| [[C]] |")).toEqual(["A", "B", "C"]);
  });
});

describe("wikiPath", () => {
  it("タイトルを符号化する", () => {
    expect(wikiPath("a/b?c#d%")).toBe("/wiki/a%2Fb%3Fc%23d%25");
  });
});
