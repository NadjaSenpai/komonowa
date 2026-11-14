/**
 * 記事の表示画面でのチェックリストの付け外し（docs/superpowers/specs/2026-11-14-task-checks-design.md）。
 * 本文には保存せず、このブラウザの localStorage に記事ごと・項目の文字ごとに覚える
 */

type Checks = Record<string, boolean>;

const storageKey = (articleId: string) => `komonowa:task-checks:${articleId}`;

function load(articleId: string): Checks {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey(articleId)) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Checks) : {};
  } catch {
    return {}; // 使えない・壊れているときは本文どおりに表示する
  }
}

function save(articleId: string, checks: Checks) {
  try {
    localStorage.setItem(storageKey(articleId), JSON.stringify(checks));
  } catch {
    // プライベートブラウズなどで保存できなくても、画面上では切り替わる
  }
}

/** 項目の文字（印と入れ子のリストを除く） */
function itemText(box: Element): string {
  const li = box.closest("li");
  if (!li) return "";
  const copy = li.cloneNode(true) as Element;
  copy.querySelectorAll(".task-box, ul, ol").forEach((el) => el.remove());
  return (copy.textContent ?? "").trim();
}

/** 各チェックの項目キー（文字＋同じ文字の何番目か）。本文の順番が変わっても文字についていく */
function itemKeys(root: ParentNode): [Element, string][] {
  const seen = new Map<string, number>();
  return [...root.querySelectorAll(".task-box")].map((box) => {
    const text = itemText(box);
    const n = seen.get(text) ?? 0;
    seen.set(text, n + 1);
    return [box, `${text}#${n}`];
  });
}

const isChecked = (box: Element) => box.getAttribute("aria-checked") === "true";

function setBox(box: Element, checked: boolean) {
  box.textContent = checked ? "☑" : "☐";
  box.setAttribute("aria-checked", String(checked));
  box.closest("li")?.classList.toggle("done", checked);
}

/** 描画した本文のチェックを操作できる形にし、覚えている状態を当てる */
export function prepareTaskBoxes(root: ParentNode, articleId: string): void {
  const checks = load(articleId);
  for (const [box, key] of itemKeys(root)) {
    // 覚えていない項目は本文どおり（描画時の印で判断する）
    const fromBody = box.textContent === "☑";
    box.setAttribute("role", "checkbox");
    box.setAttribute("tabindex", "0");
    box.setAttribute("title", "このブラウザにだけ保存されます");
    box.removeAttribute("aria-label");
    setBox(box, checks[key] ?? fromBody);
  }
}

/** 1つ切り替えて覚える */
export function toggleTaskBox(box: Element, root: ParentNode, articleId: string): void {
  const entry = itemKeys(root).find(([b]) => b === box);
  if (!entry) return;
  const checked = !isChecked(box);
  setBox(box, checked);
  save(articleId, { ...load(articleId), [entry[1]]: checked });
}

/** すべて外して覚える */
export function clearTaskChecks(root: ParentNode, articleId: string): void {
  const checks = load(articleId);
  for (const [box, key] of itemKeys(root)) {
    setBox(box, false);
    checks[key] = false;
  }
  save(articleId, checks);
}

export function anyTaskChecked(root: ParentNode): boolean {
  return [...root.querySelectorAll(".task-box")].some(isChecked);
}
