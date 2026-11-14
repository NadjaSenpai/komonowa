import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../App";
import { api, errorMessage, type User } from "../api";
import { Avatar } from "../Avatar";
import { AvatarCropper } from "../AvatarCropper";

function ProfileSection() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  if (!user) return null;

  async function run(action: () => Promise<{ user: User }>, done: string) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const r = await action();
      setUser(r.user);
      setMessage(done);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function saveName(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const r = await api.patch<{ user: User }>("/auth/profile", { name });
      setName(r.user.name);
      return r;
    }, "表示名を変更しました。過去の記事や履歴の表示も新しい名前になります。");
  }

  function pickImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMessage("");
    setError("");
    setCropFile(file);
  }

  function uploadAvatar(blob: Blob) {
    setCropFile(null);
    void run(async () => {
      const form = new FormData();
      form.append("file", blob, blob.type === "image/webp" ? "avatar.webp" : "avatar.png");
      return api.put<{ user: User }>("/auth/avatar", form);
    }, "アイコンを変更しました。");
  }

  return (
    <section className="profile">
      <h2>プロフィール</h2>
      <div className="profile-avatar">
        <Avatar userId={user.id} name={name || user.name} avatarId={user.avatar_id} size="l" />
        <div className="stack">
          <div className="actions">
            <button type="button" className="secondary" disabled={busy} onClick={() => fileInput.current?.click()}>
              {user.avatar_id ? "画像を変更" : "画像を選ぶ"}
            </button>
            {user.avatar_id && (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void run(() => api.del<{ user: User }>("/auth/avatar"), "アイコンを外しました。頭文字の表示に戻ります。")}
              >
                画像を外す
              </button>
            )}
          </div>
          <p className="hint">PNG・JPEG・WebP。選んだあとに表示する範囲を調整できます。画像がないときは名前の頭文字を表示します。</p>
        </div>
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pickImage} />
        {cropFile && <AvatarCropper file={cropFile} onCancel={() => setCropFile(null)} onDone={uploadAvatar} />}
      </div>
      <form onSubmit={saveName} className="stack">
        <label>
          表示名（50文字まで）
          <input value={name} maxLength={50} autoComplete="nickname" onChange={(e) => setName(e.target.value)} required />
        </label>
        <button type="submit" disabled={busy || name.trim() === "" || name.trim() === user.name}>名前を保存</button>
      </form>
      {message && <p className="notice" role="status">{message}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

function PasswordSection() {
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNext] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    try {
      await api.post("/auth/password", { currentPassword, newPassword });
      setCurrent("");
      setNext("");
      setMessage("パスワードを変更しました。ほかの端末のセッションはログアウトされました。");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <section>
      <h2>パスワードの変更</h2>
      <form onSubmit={submit} className="stack">
        <label>
          現在のパスワード
          <input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} required />
        </label>
        <label>
          新しいパスワード（12文字以上）
          <input type="password" autoComplete="new-password" minLength={12} value={newPassword} onChange={(e) => setNext(e.target.value)} required />
        </label>
        {message && <p className="notice">{message}</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="secondary">パスワードを変更</button>
      </form>
    </section>
  );
}

/** 新しいアドレスに確認メールを送り、リンクを開いたら切り替わる（/email） */
function EmailSection() {
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrent] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    setBusy(true);
    try {
      await api.post("/auth/email", { email, currentPassword });
      setMessage(`${email} に確認メールを送りました。メールのリンクを開いて「変更を確定する」を押すと変更されます（24時間有効）。届かないときは迷惑メールのフォルダも見てください。`);
      setEmail("");
      setCurrent("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>メールアドレスの変更</h2>
      <p className="muted small">今のアドレス：{user?.email}</p>
      <form onSubmit={submit} className="stack">
        <label>
          新しいメールアドレス
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          現在のパスワード
          <input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} required />
        </label>
        {message && <p className="notice" role="status">{message}</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="secondary" disabled={busy}>{busy ? "送信中…" : "確認メールを送る"}</button>
      </form>
    </section>
  );
}

/** 退会。名前・メールアドレス・アイコン・パスワードを消す（記事と履歴は「（削除されたユーザー）」として残る） */
function WithdrawSection() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!confirm("本当に退会しますか？名前・メールアドレス・アイコン・パスワードが消え、取り消せません。")) return;
    setError("");
    setBusy(true);
    try {
      await api.post("/auth/withdraw", { currentPassword });
      setUser(null);
      navigate("/login", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>退会</h2>
      <p className="muted small">
        退会すると、名前・メールアドレス・アイコン・パスワードが消えます。書いた記事と履歴は「（削除されたユーザー）」の名前で残ります。取り消せません。所有者は退会できません。
      </p>
      <form onSubmit={submit} className="stack">
        <label>
          現在のパスワード
          <input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} required />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="danger" disabled={busy}>{busy ? "処理中…" : "退会する"}</button>
      </form>
    </section>
  );
}

export function AccountPage() {
  const { user } = useAuth();
  return (
    <div className="narrow">
      <h1>アカウント</h1>
      <p className="muted">
        {user?.email}（{user?.role === "admin" ? "管理者" : "メンバー"}）
      </p>
      <ProfileSection />
      <EmailSection />
      <PasswordSection />
      <WithdrawSection />
    </div>
  );
}
