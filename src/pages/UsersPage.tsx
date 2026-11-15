import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, errorMessage } from "../api";
import { Avatar } from "../Avatar";
import { markdownToText } from "../markdown";
import type { Member } from "../members";

/** メンバー一覧（/users）。いまログインできる人を並べ、それぞれのユーザーページへ行ける */
export function UsersPage() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get<{ users: Member[] }>("/users")
      .then((r) => setMembers(r.users))
      .catch((err) => setError(errorMessage(err)));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!members) return <p className="muted">読み込み中…</p>;

  return (
    <div className="members">
      <h1>メンバー</h1>
      <p className="muted small">{members.length}人</p>
      <ul className="member-list">
        {members.map((m) => {
          const intro = markdownToText(m.bio).slice(0, 80);
          return (
            <li key={m.id}>
              <Link to={`/users/${m.id}`} className="member">
                <Avatar userId={m.id} name={m.name} avatarId={m.avatar_id} size="m" />
                <span className="member-text">
                  <span className="member-name">{m.name}</span>
                  {intro && <span className="member-intro">{intro}</span>}
                  <span className="member-count">記事 {m.article_count}件</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
