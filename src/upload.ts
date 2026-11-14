import { api } from "./api";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.pdf,.docx,.xlsx,.pptx,.odt,.ods,.odp,.doc,.xls,.ppt,.txt,.md,.csv,.zip";

export interface UploadedAttachment {
  id: string;
  filename: string;
  content_type: string;
  size: number;
  url: string;
}

/** 本文に差し込む Markdown。画像は埋め込み、それ以外はリンク */
export function attachmentMarkdown(a: { id: string; filename: string; content_type: string }) {
  const url = `/api/attachments/${a.id}`;
  const label = a.filename.replace(/[[\]]/g, "");
  return a.content_type.startsWith("image/") ? `![${label}](${url})` : `[${label}](${url})`;
}

/** 貼り付けた画像は名前が "image.png" になりがちなので、日時の名前に付け替える */
export function namePastedFile(file: File, now = new Date()): File {
  if (!/^image\.(png|jpe?g|gif|webp)$/i.test(file.name)) return file;
  const ext = file.name.split(".").pop()!.toLowerCase();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return new File([file], `貼り付け-${stamp}.${ext}`, { type: file.type });
}

/** 記事に添付する。articleId がなければ、保存時にひもづける下書き添付になる */
export async function uploadAttachment(file: File, articleId?: string): Promise<UploadedAttachment> {
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name}: ファイルは10MBまでです`);
  const form = new FormData();
  form.append("file", file);
  const path = articleId ? `/articles/${articleId}/attachments` : "/attachments";
  return (await api.post<{ attachment: UploadedAttachment }>(path, form)).attachment;
}

/** 本文中で参照されている下書き添付の ID だけを返す */
export function referencedIds(body: string, ids: string[]): string[] {
  return ids.filter((id) => body.includes(`/api/attachments/${id}`));
}
