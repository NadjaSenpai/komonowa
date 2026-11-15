import { describe, expect, it } from "vitest";
import { applySuggestion, findTrigger, matchKey } from "../completion";
import { applyEdit } from "../markup";
import type { Member } from "../members";
import { decorateMentions, hasMentions } from "../mentions";
import { renderMarkdown } from "../markdown";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

/** | をカーソルの位置として、本文とカーソルを作る */
function at(marked: string) {
  const caret = marked.indexOf("|");
  return { text: marked.replace("|", ""), caret };
}

function trigger(marked: string) {
  const { text, caret } = at(marked);
  return findTrigger(text, caret);
}

describe("候補を出すきっかけ", () => {
  it("[[ のあとは記事の候補。打った文字で絞り込む", () => {
    expect(trigger("前に [[|")).toEqual({ kind: "article", from: 3, query: "" });
    expect(trigger("前に [[デプ|")).toEqual({ kind: "article", from: 3, query: "デプ" });
    expect(trigger("[[空白 入り|]] あと")).toEqual({ kind: "article", from: 0, query: "空白 入り" });
  });

  it("書き終えたリンクや、行をまたいだ [[ は対象外", () => {
    expect(trigger("[[できた]] の|")).toBeNull();
    expect(trigger("[[前の行\n次の行|")).toBeNull();
    expect(trigger("[リンク](https://example.com)|")).toBeNull();
    expect(trigger("ふつうの文|")).toBeNull();
  });

  it("@ のあとはメンバーの候補。日本語の文の途中でも出す", () => {
    expect(trigger("@|")).toEqual({ kind: "member", from: 0, query: "" });
    expect(trigger("担当は@な|")).toEqual({ kind: "member", from: 3, query: "な" });
    expect(trigger("- @Nad|")).toEqual({ kind: "member", from: 2, query: "Nad" });
  });

  it("メールアドレスの途中や、空白をはさんだあとは対象外", () => {
    expect(trigger("mail@exa|")).toBeNull();
    expect(trigger("@なまえ のあと|")).toBeNull();
  });
});

describe("候補を入れる", () => {
  it("記事は [[タイトル]] にして、カーソルをその後ろに置く", () => {
    const { text, caret } = at("前に [[デプ| あと");
    const edit = applySuggestion(text, caret, findTrigger(text, caret)!, { kind: "article", title: "デプロイ手順" });
    expect(applyEdit(text, edit)).toBe("前に [[デプロイ手順]] あと");
    expect(edit.selectFrom).toBe("前に [[デプロイ手順]]".length);
  });

  it("先に ]] を閉じていたら二重にしない", () => {
    const { text, caret } = at("[[デプ|]]");
    const edit = applySuggestion(text, caret, findTrigger(text, caret)!, { kind: "article", title: "デプロイ手順" });
    expect(applyEdit(text, edit)).toBe("[[デプロイ手順]]");
  });

  it("メンバーはユーザーページへのリンクにする。名前の [ ] は除く", () => {
    const { text, caret } = at("担当は@な|");
    const edit = applySuggestion(text, caret, findTrigger(text, caret)!, { kind: "member", id: ID, name: "な[か]の", avatar_id: null });
    expect(applyEdit(text, edit)).toBe(`担当は[@なかの](/users/${ID}) `);
  });

  it("名前の絞り込みは全角半角・大文字小文字を区別しない", () => {
    expect(matchKey("Ｎａｄｊａ")).toBe(matchKey("nadja"));
  });
});

describe("本文中の人へのリンク", () => {
  const member: Member = { id: ID, name: "なかの", avatar_id: null, bio: "", article_count: 0 };

  function mount(markdown: string, members = [member]) {
    const root = document.createElement("div");
    root.innerHTML = decorateMentions(renderMarkdown(markdown), members);
    return root;
  }

  it("メンバーへのリンクにアイコンを付ける。文字は書いたまま", () => {
    const root = mount(`担当は [@なかの](/users/${ID}) です`);
    const link = root.querySelector("a")!;
    expect(link.className).toBe("mention");
    expect(link.getAttribute("href")).toBe(`/users/${ID}`);
    expect(link.querySelector(".avatar")?.textContent).toBe("な");
    expect(link.textContent).toBe("な@なかの");
  });

  it("画像のアイコンがある人は、その画像を出す", () => {
    const root = mount(`[@なかの](/users/${ID})`, [{ ...member, avatar_id: "11111111-2222-3333-4444-555555555555" }]);
    expect(root.querySelector("img.avatar")?.getAttribute("src")).toBe("/api/avatars/11111111-2222-3333-4444-555555555555");
  });

  it("一覧にいない人（無効化・退会）や、ほかのリンクはそのまま", () => {
    const root = mount(`[@いない人](/users/${ID}) と [外](https://example.com) と [[記事]]`, []);
    expect(root.querySelector(".mention")).toBeNull();
    expect(root.querySelector(".avatar")).toBeNull();
    expect(root.querySelectorAll("a")).toHaveLength(3);
  });

  it("人へのリンクがあるかどうかを見分ける", () => {
    expect(hasMentions(renderMarkdown(`[@なかの](/users/${ID})`))).toBe(true);
    expect(hasMentions(renderMarkdown("[[記事]] と [外](https://example.com/users/x)"))).toBe(false);
  });
});
