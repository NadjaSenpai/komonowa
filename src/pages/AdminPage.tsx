import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../App";
import { api, errorMessage, formatDate } from "../api";
import { Byline } from "../Avatar";

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  status: "active" | "disabled";
  avatar_id: string | null;
  created_at: number;
}

interface Invite {
  id: string;
  email: string;
  role: string;
  expires_at: number;
  used_at: number | null;
  revoked_at: number | null;
  created_by_name: string;
}

interface TrashItem {
  id: string;
  title: string;
  deleted_at: number;
  deleted_by_name: string | null;
}

interface Tag {
  id: string;
  name: string;
  count: number;
}

/** 発行したリンクは一度しか表示しない（サーバーにはハッシュしか残らない） */
function IssuedLink({ label, url, onClose }: { label: string; url: string; onClose: () => void }) {
  return (
    <div className="notice" role="status">
      <p>{label}（この画面を閉じると再表示できません。安全な方法で本人に渡してください）</p>
      <div className="copy-row">
        <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label={label} />
        <button type="button" onClick={() => navigator.clipboard?.writeText(url)}>コピー</button>
        <button type="button" className="secondary" onClick={onClose}>閉じる</button>
      </div>
    </div>
  );
}

function inviteStatus(i: Invite) {
  if (i.used_at) return "登録済み";
  if (i.revoked_at) return "取り消し";
  if (i.expires_at < Date.now()) return "期限切れ";
  return "未使用";
}

export function AdminPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [trash, setTrash] = useState<TrashItem[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [issued, setIssued] = useState<{ label: string; url: string } | null>(null);
  const [error, setError] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [inviteHours, setInviteHours] = useState(72);

  const load = useCallback(async () => {
    try {
      const [u, i, t, g] = await Promise.all([
        api.get<{ users: AdminUser[] }>("/admin/users"),
        api.get<{ invites: Invite[] }>("/admin/invites"),
        api.get<{ articles: TrashItem[] }>("/admin/trash"),
        api.get<{ tags: Tag[] }>("/articles/tags"),
      ]);
      setUsers(u.users);
      setInvites(i.invites);
      setTrash(t.articles);
      setTags(g.tags);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function invite(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const r = await api.post<{ token: string }>("/admin/invites", { email: inviteEmail, role: inviteRole, expiresInHours: inviteHours });
      setIssued({ label: `${inviteEmail} への招待リンク`, url: `${location.origin}/invite#${r.token}` });
      setInviteEmail("");
    });
  }

  async function resetLink(u: AdminUser) {
    await run(async () => {
      const r = await api.post<{ token: string }>(`/admin/users/${u.id}/reset-link`);
      setIssued({ label: `${u.name} さんのパスワード再設定リンク（24時間有効）`, url: `${location.origin}/reset#${r.token}` });
    });
  }

  return (
    <div className="admin">
      <h1>管理</h1>
      {error && <p className="error" role="alert">{error}</p>}
      {issued && <IssuedLink {...issued} onClose={() => setIssued(null)} />}

      <section>
        <h2>メンバーを招待</h2>
        <form onSubmit={invite} className="inline-form">
          <input type="email" placeholder="メールアドレス" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required />
          <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as "member" | "admin")} aria-label="権限">
            <option value="member">メンバー</option>
            <option value="admin">管理者</option>
          </select>
          <select value={inviteHours} onChange={(e) => setInviteHours(Number(e.target.value))} aria-label="有効期限">
            <option value={24}>24時間</option>
            <option value={72}>3日</option>
            <option value={168}>7日</option>
          </select>
          <button type="submit">招待リンクを発行</button>
        </form>
        {invites.length === 0 && <p className="muted small">発行中の招待はありません</p>}
        {invites.length > 0 && (
          <table>
            <thead><tr><th>メール</th><th>権限</th><th>状態</th><th>期限</th><th>発行者</th><th /></tr></thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.id}>
                  <td>{i.email}</td>
                  <td>{i.role === "admin" ? "管理者" : "メンバー"}</td>
                  <td>{inviteStatus(i)}</td>
                  <td>{formatDate(i.expires_at)}</td>
                  <td>{i.created_by_name}</td>
                  <td>
                    {inviteStatus(i) === "未使用" && (
                      <button type="button" className="secondary small" onClick={() => run(() => api.del(`/admin/invites/${encodeURIComponent(i.id)}`))}>
                        取り消し
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>メンバー</h2>
        <table>
          <thead><tr><th>名前</th><th>メール</th><th>権限</th><th>状態</th><th>登録日</th><th /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.status === "disabled" ? "muted" : ""}>
                <td>
                  <Byline userId={u.id} name={u.name} avatarId={u.avatar_id}>
                    {u.name}{u.id === user?.id && <span className="muted small">（自分）</span>}
                  </Byline>
                </td>
                <td>{u.email}</td>
                <td>
                  <select
                    value={u.role}
                    disabled={u.id === user?.id}
                    title={u.id === user?.id ? "自分の権限は変更できません" : undefined}
                    aria-label={`${u.name} の権限`}
                    onChange={(e) => run(() => api.patch(`/admin/users/${u.id}`, { role: e.target.value }))}
                  >
                    <option value="member">メンバー</option>
                    <option value="admin">管理者</option>
                  </select>
                </td>
                <td>{u.status === "active" ? "有効" : "無効"}</td>
                <td>{formatDate(u.created_at)}</td>
                <td>
                  <div className="actions">
                    {u.id !== user?.id && u.status === "active" && (
                      <>
                        <button type="button" className="secondary small" onClick={() => resetLink(u)}>再設定リンク</button>
                        <button
                          type="button"
                          className="danger small"
                          onClick={() => confirm(`${u.name} さんを無効化しますか？ログイン中のセッションも切断されます。記事は残ります。`) && run(() => api.patch(`/admin/users/${u.id}`, { status: "disabled" }))}
                        >
                          無効化
                        </button>
                      </>
                    )}
                    {u.status === "disabled" && (
                      <button type="button" className="secondary small" onClick={() => run(() => api.patch(`/admin/users/${u.id}`, { status: "active" }))}>
                        再有効化
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>ごみ箱</h2>
        {trash.length === 0 && <p className="muted small">削除された記事はありません</p>}
        {trash.length > 0 && (
          <table>
            <tbody>
              {trash.map((a) => (
                <tr key={a.id}>
                  <td>{a.title}</td>
                  <td>{formatDate(a.deleted_at)} {a.deleted_by_name} が削除</td>
                  <td>
                    <div className="actions">
                      <button type="button" className="small" onClick={() => run(() => api.post(`/admin/trash/${a.id}/restore`))}>復元</button>
                      <button
                        type="button"
                        className="danger small"
                        onClick={() => confirm(`「${a.title}」を完全に削除しますか？履歴と添付ファイルも消え、元に戻せません。`) && run(() => api.del(`/admin/trash/${a.id}`))}
                      >
                        完全削除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>タグ</h2>
        {tags.length === 0 && <p className="muted small">タグはまだありません</p>}
        {tags.length > 0 && (
          <table>
            <tbody>
              {tags.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{t.count} 件</td>
                  <td>
                    <div className="actions">
                      <button
                        type="button"
                        className="secondary small"
                        onClick={() => {
                          const name = prompt("新しいタグ名", t.name);
                          if (name && name !== t.name) void run(() => api.patch(`/admin/tags/${t.id}`, { name }));
                        }}
                      >
                        名前を変更
                      </button>
                      <button
                        type="button"
                        className="danger small"
                        onClick={() => confirm(`タグ「${t.name}」を削除しますか？記事からも外れます。`) && run(() => api.del(`/admin/tags/${t.id}`))}
                      >
                        削除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
