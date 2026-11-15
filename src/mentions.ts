import type { Member } from "./members";
import { avatarInitial, avatarTone } from "./userAvatar";

const USER_PATH = /^\/users\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** 描画した本文に、人へのリンク（/users/<id>）があるか。あるときだけメンバーを読み込めば済む */
export function hasMentions(html: string): boolean {
  return html.includes('href="/users/');
}

/**
 * 本文中の人へのリンク（編集画面で @ から入れる [@名前](/users/<id>)）に、その人のアイコンを付ける。
 * 文字は書いたときのまま変えない。いまログインできない人（無効化・退会）は一覧にいないので、アイコンなしのリンクのまま
 */
export function decorateMentions(html: string, members: Member[]): string {
  if (!hasMentions(html)) return html;
  const byId = new Map(members.map((m) => [m.id, m]));
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const a of doc.body.querySelectorAll("a[href^='/users/']")) {
    const member = byId.get(USER_PATH.exec(a.getAttribute("href") ?? "")?.[1] ?? "");
    if (!member) continue;
    a.classList.add("mention");
    // Avatar（src/Avatar.tsx）と同じ見た目。名前は隣に書いてあるので読み上げない
    const icon = doc.createElement(member.avatar_id ? "img" : "span");
    icon.setAttribute("aria-hidden", "true");
    if (member.avatar_id) {
      icon.className = "avatar s";
      icon.setAttribute("src", `/api/avatars/${member.avatar_id}`);
      icon.setAttribute("alt", "");
      icon.setAttribute("loading", "lazy");
      icon.setAttribute("decoding", "async");
    } else {
      icon.className = `avatar s tone-${avatarTone(member.id)}`;
      icon.textContent = avatarInitial(member.name);
    }
    a.prepend(icon);
  }
  return doc.body.innerHTML;
}
