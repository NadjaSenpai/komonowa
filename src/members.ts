import { api } from "./api";

/** メンバー一覧の1人（GET /api/users）。bio は自己紹介の冒頭だけ */
export interface Member {
  id: string;
  name: string;
  avatar_id: string | null;
  bio: string;
  article_count: number;
}

const FRESH_MS = 60 * 1000;
let cached: { at: number; members: Promise<Member[]> } | null = null;

/**
 * いまログインできるメンバー。編集画面の @ の候補と、本文中の人へのリンクにアイコンを付けるのに使う。
 * 画面を移るたびに取り直さないよう、1分は同じ結果を使う。失敗したら次の呼び出しで取り直す
 */
export function loadMembers(): Promise<Member[]> {
  if (cached && Date.now() - cached.at < FRESH_MS) return cached.members;
  const members = api.get<{ users: Member[] }>("/users").then((r) => r.users);
  cached = { at: Date.now(), members };
  members.catch(() => {
    if (cached?.members === members) cached = null;
  });
  return members;
}
