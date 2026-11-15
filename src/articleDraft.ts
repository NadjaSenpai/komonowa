export interface DraftContent {
  title: string;
  body: string;
  tags: string;
  baseVersion: number;
  draftIds: string[];
}
export interface ArticleDraft extends DraftContent {
  savedAt: number;
}
const TTL = 7 * 86400000;
export const draftKey = (userId: string, articleId = "new") => `wiki:draft:v1:${userId}:${articleId}`;
export function loadDraft(key: string): ArticleDraft | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as ArticleDraft;
    if (
      typeof d.title === "string" &&
      d.title.length <= 200 &&
      typeof d.body === "string" &&
      d.body.length <= 200000 &&
      typeof d.tags === "string" &&
      Number.isInteger(d.baseVersion) &&
      d.baseVersion >= 0 &&
      Array.isArray(d.draftIds) &&
      d.draftIds.every((id) => typeof id === "string") &&
      Number.isFinite(d.savedAt) &&
      d.savedAt <= Date.now() &&
      Date.now() - d.savedAt < TTL
    )
      return d;
  } catch {
    /* 古い・壊れた退避は破棄 */
  }
  removeDraft(key);
  return null;
}
export function saveDraft(key: string, value: DraftContent): boolean {
  try {
    localStorage.setItem(key, JSON.stringify({ ...value, savedAt: Date.now() }));
    return true;
  } catch {
    return false;
  }
}
export function removeDraft(key: string) {
  localStorage.removeItem(key);
}
