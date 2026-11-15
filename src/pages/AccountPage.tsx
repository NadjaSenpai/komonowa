import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useAuth } from "../App";
import { api, errorMessage, roleLabel, type User } from "../api";
import { Avatar } from "../Avatar";
import { AvatarCropper } from "../AvatarCropper";
import { BIO_MAX, PASSWORD_MIN } from "../../shared/accounts";
import type { Profile } from "./UserPage";
import { ErrorAlert } from "../ErrorAlert";

function ProfileSection() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  // 自己紹介はログイン中の利用者情報に入っていないので、自分のユーザーページから読む。savedBio が null の間は読み込み中
  const [bio, setBio] = useState("");
  const [savedBio, setSavedBio] = useState<string | null>(null);
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    api
      .get<{ user: Profile }>(`/users/${userId}`)
      .then((r) => {
        setBio(r.user.bio);
        setSavedBio(r.user.bio);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [userId]);
  if (!user) return null;
  const unchanged = name.trim() === user.name && bio.trim() === savedBio;

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

  function saveProfile(e: FormEvent) {
    e.preventDefault();
    const renamed = name.trim() !== user?.name;
    void run(
      async () => {
        const r = await api.patch<{ user: User; bio: string }>("/auth/profile", { name, bio });
        setName(r.user.name);
        setBio(r.bio);
        setSavedBio(r.bio);
        return r;
      },
      renamed ? "プロフィールを保存しました。過去の記事や履歴の表示も新しい名前になります。" : "プロフィールを保存しました。",
    );
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
      <form onSubmit={saveProfile} className="stack">
        <label>
          表示名（50文字まで）
          <input value={name} maxLength={50} autoComplete="nickname" onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          自己紹介（{BIO_MAX}文字まで）
          <textarea
            value={bio}
            maxLength={BIO_MAX}
            rows={8}
            disabled={savedBio === null}
            placeholder={savedBio === null ? "読み込み中…" : "担当していること、好きなもの、連絡のつきやすい時間など"}
            onChange={(e) => setBio(e.target.value)}
          />
        </label>
        <p className="hint">記事と同じ書き方（Markdown）が使えます。リンクは [文字](https://…)、記事へのリンクは [[記事のタイトル]] で書けます。</p>
        <button type="submit" disabled={busy || savedBio === null || name.trim() === "" || unchanged}>
          プロフィールを保存
        </button>
        <p className="small">
          <Link to={`/users/${user.id}`}>自分のページを見る</Link>
        </p>
      </form>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <ErrorAlert message={error} />
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
          新しいパスワード（{PASSWORD_MIN}文字以上）
          <input type="password" autoComplete="new-password" minLength={PASSWORD_MIN} value={newPassword} onChange={(e) => setNext(e.target.value)} required />
        </label>
        {message && <p className="notice">{message}</p>}
        <ErrorAlert message={error} />
        <button type="submit" className="secondary">
          パスワードを変更
        </button>
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
      setMessage(
        `${email} に確認メールを送りました。メールのリンクを開いて「変更を確定する」を押すと変更されます（24時間有効）。届かないときは迷惑メールのフォルダも見てください。`,
      );
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
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        <ErrorAlert message={error} />
        <button type="submit" className="secondary" disabled={busy}>
          {busy ? "送信中…" : "確認メールを送る"}
        </button>
      </form>
    </section>
  );
}

/** 退会。名前・メールアドレス・アイコン・自己紹介・パスワードを消す（記事と履歴は「（削除されたユーザー）」として残る） */
function WithdrawSection() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!confirm("本当に退会しますか？名前・メールアドレス・アイコン・自己紹介・パスワードが消え、取り消せません。")) return;
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
        退会すると、名前・メールアドレス・アイコン・自己紹介・パスワードが消えます。書いた記事と履歴は「（削除されたユーザー）」の名前で残ります。取り消せません。所有者は退会できません。
      </p>
      <form onSubmit={submit} className="stack">
        <label>
          現在のパスワード
          <input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} required />
        </label>
        <ErrorAlert message={error} />
        <button type="submit" className="danger" disabled={busy}>
          {busy ? "処理中…" : "退会する"}
        </button>
      </form>
    </section>
  );
}

export function AccountPage() {
  const { user } = useAuth();
  return (
    <div className="account">
      <h1>アカウント</h1>
      <p className="muted">
        {user?.email}（{user && roleLabel(user.role)}）
      </p>
      {/* 広い画面では、左にほかの人に見えるもの（プロフィール）、右にログインに関わるものを並べる。狭い画面では縦に続く */}
      <div className="account-columns">
        <div className="account-column">
          <ProfileSection />
        </div>
        <div className="account-column">
          <EmailSection />
          <PasswordSection />
          <WithdrawSection />
        </div>
      </div>
    </div>
  );
}
