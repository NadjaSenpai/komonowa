import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import themeScript from "../../public/theme.js?raw";
import { THEME_KEY, applyTheme, getTheme, setTheme } from "../theme";
import css from "../tokens.css?raw";

function addMetas() {
  document.head.innerHTML = `
    <meta name="color-scheme" content="light dark" />
    <meta name="theme-color" content="#365d4e" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#1b1a18" media="(prefers-color-scheme: dark)" />`;
}
const barColors = () => [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((m) => m.content);
const colorScheme = () => document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')?.content;

describe("画面の明るさ", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    addMetas();
  });
  afterEach(() => vi.restoreAllMocks());

  it("何も選んでいなければ OS に合わせる", () => {
    expect(getTheme()).toBe("system");
    localStorage.setItem(THEME_KEY, "sepia");
    expect(getTheme()).toBe("system");
  });

  it("ダークを選ぶと html とブラウザのバーに当て、覚える", () => {
    setTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(getTheme()).toBe("dark");
    expect(barColors()).toEqual(["#1b1a18", "#1b1a18"]);
    expect(colorScheme()).toBe("dark");
  });

  it("OS に合わせるに戻すと、覚えた値を消して元のバーの色に戻す", () => {
    setTheme("light");
    expect(barColors()).toEqual(["#365d4e", "#365d4e"]);
    setTheme("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    expect(barColors()).toEqual(["#365d4e", "#1b1a18"]);
    expect(colorScheme()).toBe("light dark");
  });

  it("localStorage が使えなくても、いまの画面は切り替わる", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    setTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(getTheme()).toBe("system");
  });

  it("applyTheme は保存しない", () => {
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });

  it("描画前に当てる public/theme.js と同じキーを使う", () => {
    expect(themeScript).toContain(`"${THEME_KEY}"`);
  });
});

describe("tokens.css のダークの色", () => {
  const block = (selector: string): string[] => {
    const start = css.indexOf(`${selector} {`);
    expect(start).toBeGreaterThan(-1);
    const body = css.slice(start + selector.length + 2, css.indexOf("}", start));
    return body
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean);
  };

  it("OS に合わせるときと、ダークを選んだときで同じ色を使う", () => {
    const os = block(':root:not([data-theme="light"])');
    const chosen = block(':root[data-theme="dark"]');
    expect(chosen).toEqual(os);
    expect(os.length).toBeGreaterThan(20);
  });

  it("ライトで使う色の名前は、すべてダークでも決めている", () => {
    const light = css.slice(0, css.indexOf("}"));
    const colorNames = [...light.matchAll(/(--(?:color|avatar-\d)-[a-z0-9-]+|--shadow-pop):/g)].map((m) => m[1] ?? "");
    const dark = block(':root[data-theme="dark"]').map((d) => d.slice(0, d.indexOf(":")).trim());
    expect(colorNames.filter((n) => !dark.includes(n))).toEqual([]);
  });
});
