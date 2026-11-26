import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useAuth } from "../App";
import { api, errorMessage, formatDate, roleLabel, type Tag } from "../api";
import { Byline } from "../Avatar";
import { inviteStatus, openInvites, type Invite } from "../invites";
import { DELETED_EMAIL_DOMAIN, DELETED_NAME } from "../../shared/accounts";
import { ErrorAlert } from "../ErrorAlert";

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  status: "active" | "disabled";
  is_owner: 0 | 1;
  avatar_id: string | null;
  created_at: number;
}

interface TrashItem {
  id: string;
  title: string;
  deleted_at: number;
  deleted_by_name: string | null;
}

interface SharedItem {
  article_id: string;
  title: string;
  created_at: number;
  created_by_name: string;
  has_passcode: boolean;
}

const HOUR = 60 * 60 * 1000;
/** 送信元の実績が少ないうちは迷惑メールに入りやすいので、送ったあとに添える */
const SPAM_HINT = "届かないときは、迷惑メールのフォルダも見てもらってください";

export function AdminPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [trash, setTrash] = useState<TrashItem[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [shares, setShares] = useState<SharedItem[]>([]);
  const [sent, setSent] = useState("");
  // 招待一覧は、ふだんはまだ何かする必要がある招待だけ出す
  const [showAllInvites, setShowAllInvites] = useState(false);
  // 送信中は送るボタンを止める（二度押しで2通届き、先のリンクが無効になるのを防ぐ）
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [inviteHours, setInviteHours] = useState(72);

  const load = useCallback(async () => {
    try {
      const [u, i, t, g, s] = await Promise.all([
        api.get<{ users: AdminUser[] }>("/admin/users"),
        api.get<{ invites: Invite[] }>("/admin/invites"),
        api.get<{ articles: TrashItem[] }>("/admin/trash"),
        api.get<{ tags: Tag[] }>("/articles/tags"),
        api.get<{ shares: SharedItem[] }>("/admin/shares"),
      ]);
      setUsers(u.users);
      setInvites(i.invites);
      setTrash(t.articles);
      setTags(g.tags);
      setShares(s.shares);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 成功したら true（一覧は読み直す）、失敗したらエラーを出して false */
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setError("");
    try {
      await action();
      await load();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  }

  // リンクはサーバーが本人にメールで送る（画面には出さない）
  async function sendMail(action: () => Promise<string>): Promise<boolean> {
    setSent("");
    setSending(true);
    try {
      return await run(async () => setSent(await action()));
    } finally {
      setSending(false);
    }
  }

  function sendInvite(email: string, role: string, hours: number) {
    return sendMail(async () => {
      const r = await api.post<{ expiresAt: number }>("/admin/invites", { email, role, expiresInHours: hours });
      return `${email} に招待メールを送りました（期限：${formatDate(r.expiresAt)}）。${SPAM_HINT}`;
    });
  }

  async function invite(e: FormEvent) {
    e.preventDefault();
    if (await sendInvite(inviteEmail, inviteRole, inviteHours)) setInviteEmail("");
  }

  const open = openInvites(invites);
  const openIds = new Set(open.map((i) => i.id));
  const shownInvites = showAllInvites ? invites : open;

  /** 同じアドレス・権限・期限の長さで送り直す。古いリンクはサーバー側で無効になる */
  async function resendInvite(i: Invite) {
    await sendInvite(i.email, i.role, Math.max(1, Math.round((i.expires_at - i.created_at) / HOUR)));
  }

  async function resetLink(u: AdminUser) {
    await sendMail(async () => {
      await api.post(`/admin/users/${u.id}/reset-link`);
      return `${u.name} さんにパスワード再設定メールを送りました（24時間有効）。${SPAM_HINT}`;
    });
  }

  return (
    <div className="admin">
      <h1>サイト管理</h1>
      <ErrorAlert message={error} />
      {sent && (
        <p className="notice" role="status">
          {sent}{" "}
          <button type="button" className="link small" onClick={() => setSent("")}>
            閉じる
          </button>
        </p>
      )}

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
          <button type="submit" disabled={sending}>
            {sending ? "送信中…" : "招待メールを送る"}
          </button>
        </form>
        {shownInvites.length === 0 && <p className="muted small">返事待ちの招待はありません</p>}
        {shownInvites.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>メール</th>
                <th>権限</th>
                <th>状態</th>
                <th>期限</th>
                <th>発行者</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shownInvites.map((i) => (
                <tr key={i.id}>
                  <td>{i.email.endsWith(DELETED_EMAIL_DOMAIN) ? DELETED_NAME : i.email}</td>
                  <td>{roleLabel(i.role)}</td>
                  <td>{inviteStatus(i)}</td>
                  <td>{formatDate(i.expires_at)}</td>
                  <td>{i.created_by_name}</td>
                  <td>
                    <div className="actions">
                      {/* 届かなかった・期限が切れたときは送り直す（同じアドレスの最新の未使用・期限切れだけ） */}
                      {openIds.has(i.id) && (
                        <button type="button" className="secondary small" disabled={sending} onClick={() => resendInvite(i)}>
                          再送
                        </button>
                      )}
                      {inviteStatus(i) === "未使用" && (
                        <button type="button" className="secondary small" onClick={() => run(() => api.del(`/admin/invites/${encodeURIComponent(i.id)}`))}>
                          取り消し
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {invites.length > open.length && (
          <p className="small">
            <button type="button" className="link small" onClick={() => setShowAllInvites((v) => !v)}>
              {showAllInvites ? "返事待ちの招待だけ表示" : `終わった招待も表示（${invites.length - open.length}件）`}
            </button>
          </p>
        )}
      </section>

      <section>
        <h2>メンバー</h2>
        <table>
          <thead>
            <tr>
              <th>名前</th>
              <th>メール</th>
              <th>権限</th>
              <th>状態</th>
              <th>登録日</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.status === "disabled" ? "muted" : ""}>
                <td>
                  <Byline userId={u.id} name={u.name} avatarId={u.avatar_id}>
                    {u.name}
                    {u.id === user?.id && <span className="muted small">（自分）</span>}
                  </Byline>
                </td>
                <td>{u.email}</td>
                <td>
                  {/* 所有者はほかの管理者から権限変更・無効化されない（docs/superpowers/specs/2026-11-14-owner-design.md） */}
                  {u.is_owner ? (
                    <span title="ほかの管理者は、所有者の権限変更や無効化はできません">所有者</span>
                  ) : (
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
                  )}
                </td>
                <td>{u.status === "active" ? "有効" : "無効"}</td>
                <td>{formatDate(u.created_at)}</td>
                <td>
                  <div className="actions">
                    {u.id !== user?.id && u.status === "active" && (
                      <>
                        <button type="button" className="secondary small" disabled={sending} onClick={() => resetLink(u)}>
                          再設定メールを送る
                        </button>
                        {!u.is_owner && (
                          <button
                            type="button"
                            className="danger small"
                            onClick={() =>
                              confirm(`${u.name} さんを無効化しますか？ログイン中のセッションも切断されます。記事は残ります。`) &&
                              run(() => api.patch(`/admin/users/${u.id}`, { status: "disabled" }))
                            }
                          >
                            無効化
                          </button>
                        )}
                      </>
                    )}
                    {u.status === "disabled" && (
                      <button type="button" className="secondary small" onClick={() => run(() => api.patch(`/admin/users/${u.id}`, { status: "active" }))}>
                        再有効化
                      </button>
                    )}
                    {/* abuse する人を外す。名前とアドレスを消し、同じアドレスでは戻れなくする */}
                    {u.id !== user?.id && !u.is_owner && (
                      <button
                        type="button"
                        className="danger small"
                        onClick={() =>
                          confirm(
                            `${u.name} さんを強制退会しますか？名前・メールアドレス・アイコン・自己紹介が消え、同じメールアドレスでは招待できなくなります。記事は「（削除されたユーザー）」の名前で残ります。取り消せません。`,
                          ) && run(() => api.post(`/admin/users/${u.id}/remove`))
                        }
                      >
                        強制退会
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
        <h2>共有中の記事</h2>
        <p className="muted small">URL を知っている人がログインなしで読める記事です。止めるとその URL では見られなくなります。</p>
        {shares.length === 0 && <p className="muted small">共有中の記事はありません</p>}
        {shares.length > 0 && (
          <table>
            <tbody>
              {shares.map((sh) => (
                <tr key={sh.article_id}>
                  <td>
                    <Link to={`/articles/${sh.article_id}`}>{sh.title}</Link>
                  </td>
                  <td>
                    {formatDate(sh.created_at)} {sh.created_by_name} が共有
                  </td>
                  <td>{sh.has_passcode ? "パスワードあり" : ""}</td>
                  <td>
                    <div className="actions">
                      <button
                        type="button"
                        className="danger small"
                        onClick={() => confirm(`「${sh.title}」の共有を止めますか？`) && run(() => api.del(`/admin/shares/${sh.article_id}`))}
                      >
                        共有を止める
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
        <h2>ごみ箱</h2>
        {trash.length === 0 && <p className="muted small">削除された記事はありません</p>}
        {trash.length > 0 && (
          <table>
            <tbody>
              {trash.map((a) => (
                <tr key={a.id}>
                  <td>{a.title}</td>
                  <td>
                    {formatDate(a.deleted_at)} {a.deleted_by_name} が削除
                  </td>
                  <td>
                    <div className="actions">
                      <button type="button" className="small" onClick={() => run(() => api.post(`/admin/trash/${a.id}/restore`))}>
                        復元
                      </button>
                      <button
                        type="button"
                        className="danger small"
                        onClick={() =>
                          confirm(`「${a.title}」を完全に削除しますか？履歴と添付ファイルも消え、元に戻せません。`) &&
                          run(() => api.del(`/admin/trash/${a.id}`))
                        }
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

      <section>
        <h2>Cosense から取り込む</h2>
        <p className="muted small">Cosense（旧 Scrapbox）のエクスポートファイルから、選んだページを記事として取り込みます。</p>
        <Link to="/import/cosense" className="button secondary small">
          取り込む画面を開く
        </Link>
      </section>
    </div>
  );
}
