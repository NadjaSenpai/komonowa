import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { WelcomeNotice } from "../WelcomeNotice";

function render(state: unknown) {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: [{ pathname: "/", state }] }, createElement(WelcomeNotice)),
  );
  return root;
}

describe("登録直後の一言", () => {
  it("招待から登録した直後はヘルプへの案内を出す", () => {
    const root = render({ welcome: true });
    expect(root.textContent).toContain("ようこそ");
    expect(root.querySelector('a[href="/help"]')).not.toBeNull();
    expect(root.querySelector("button")?.textContent).toBe("閉じる");
  });

  it("ふだんは出さない", () => {
    expect(render(null).innerHTML).toBe("");
    expect(render({ from: "/" }).innerHTML).toBe("");
    expect(render({ welcome: "yes" }).innerHTML).toBe("");
  });
});
