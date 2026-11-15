/**
 * 書きかけの保存期間。ブラウザの下書き（src/articleDraft.ts、最後の編集から）と、
 * 保存前の添付（worker/routes/attachments.ts、アップロードから）で同じ値を使う
 */
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
