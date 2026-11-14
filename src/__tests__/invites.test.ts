import { describe, expect, it } from "vitest";
import { inviteStatus, openInvites, type Invite } from "../invites";

const NOW = 1_000_000;
function inv(id: string, email: string, over: Partial<Invite> = {}): Invite {
  return { id, email, role: "member", expires_at: NOW + 1, used_at: null, revoked_at: null, created_at: NOW - 10, created_by_name: "管理者", ...over };
}

describe("inviteStatus", () => {
  it("登録済み・取り消し・期限切れ・未使用", () => {
    expect(inviteStatus(inv("a", "a@x", { used_at: 1 }), NOW)).toBe("登録済み");
    expect(inviteStatus(inv("a", "a@x", { revoked_at: 1 }), NOW)).toBe("取り消し");
    expect(inviteStatus(inv("a", "a@x", { expires_at: NOW - 1 }), NOW)).toBe("期限切れ");
    expect(inviteStatus(inv("a", "a@x"), NOW)).toBe("未使用");
  });
});

describe("openInvites（まだ何かする必要がある招待）", () => {
  it("未使用と、アドレスごとに最新の期限切れだけ残す（一覧は新しい順）", () => {
    const list = [
      inv("new", "a@x"),
      inv("old-expired", "a@x", { expires_at: NOW - 1 }),
      inv("expired", "b@x", { expires_at: NOW - 1 }),
      inv("revoked", "c@x", { revoked_at: 1 }),
      inv("used", "d@x", { used_at: 1 }),
    ];
    expect(openInvites(list, NOW).map((i) => i.id)).toEqual(["new", "expired"]);
  });

  it("取り消したあとに古い期限切れがあっても出さない", () => {
    const list = [inv("revoked", "a@x", { revoked_at: 1 }), inv("old-expired", "a@x", { expires_at: NOW - 1 })];
    expect(openInvites(list, NOW)).toEqual([]);
  });
});
