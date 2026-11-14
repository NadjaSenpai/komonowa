/** 管理画面の招待一覧の1行（GET /api/admin/invites） */
export interface Invite {
  id: string;
  email: string;
  role: string;
  expires_at: number;
  used_at: number | null;
  revoked_at: number | null;
  created_at: number;
  created_by_name: string;
}

export type InviteStatus = "登録済み" | "取り消し" | "期限切れ" | "未使用";

export function inviteStatus(i: Invite, now = Date.now()): InviteStatus {
  if (i.used_at) return "登録済み";
  if (i.revoked_at) return "取り消し";
  if (i.expires_at < now) return "期限切れ";
  return "未使用";
}

/**
 * まだ何かする必要がある招待：未使用（取り消し・再送できる）と期限切れ（再送できる）。
 * 一覧は新しい順なので、アドレスごとに最初の1件（最新）だけを見る。登録済み・取り消し・置き換わった古い招待は隠す
 */
export function openInvites(invites: Invite[], now = Date.now()): Invite[] {
  const seen = new Set<string>();
  return invites.filter((i) => {
    if (seen.has(i.email)) return false;
    seen.add(i.email);
    const status = inviteStatus(i, now);
    return status === "未使用" || status === "期限切れ";
  });
}
