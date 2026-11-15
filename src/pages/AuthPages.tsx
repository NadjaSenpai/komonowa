import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { useAuth } from "../App";
import { api, errorMessage, type User } from "../api";
import { PASSWORD_MIN } from "../../shared/accounts";
import { ErrorAlert } from "../ErrorAlert";
import { Logo } from "../Logo";

const PASSWORD_HINT = `${PASSWORD_MIN}文字以上`;

/** 送信後に画面を移る前に入力欄から離れる（iPhone でキーボード用にずれた表示を戻す） */
function leaveForm() {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="auth">
      <div className="card">
        <p className="brand">
          <Logo />
        </p>
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

/** URL のフラグメント（#以降）からトークンを読む。サーバーのログや Referer に残らない */
function useFragmentToken() {
  const location = useLocation();
  return location.hash.replace(/^#/, "");
}

/** 招待・再設定のリンクを確かめる。使えるリンクなら宛先のメールアドレス、確かめている間と使えないときは null */
function useLinkEmail(kind: "invite" | "reset", token: string, onError: (message: string) => void) {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    api
      .post<{ email: string }>(`/auth/${kind}/check`, { token })
      .then((r) => setEmail(r.email))
      .catch((err) => onError(errorMessage(err)));
  }, [kind, token, onError]);
  return email;
}

/** リンクを確かめている間の表示。使えなかったら、その理由 */
function LinkPending({ error }: { error: string }) {
  return error ? <p className="error">{error}</p> : <p className="muted">確認中…</p>;
}

export function LoginPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    api
      .get<{ needsSetup: boolean }>("/auth/setup")
      .then((r) => setNeedsSetup(r.needsSetup))
      .catch(() => undefined);
  }, []);

  if (user) return <Navigate to="/" replace />;
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api.post<{ user: User }>("/auth/login", { email, password });
      setUser(r.user);
      leaveForm();
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="ログイン">
      {needsSetup && (
        <p className="notice">
          まだ管理者がいません。<Link to="/setup">初期設定</Link>から管理者を作成してください。
        </p>
      )}
      <form onSubmit={submit} className="stack">
        <label>
          メールアドレス
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          パスワード
          <span className="password-field">
            <input
              id="login-password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              className="secondary"
              aria-controls="login-password"
              aria-label={showPassword ? "パスワードを隠す" : "パスワードを表示"}
              onClick={() => setShowPassword((shown) => !shown)}
            >
              {showPassword ? "隠す" : "表示"}
            </button>
          </span>
        </label>
        <ErrorAlert message={error} />
        <button type="submit" disabled={busy}>
          ログイン
        </button>
      </form>
      <div className="auth-help small">
        <p>
          <strong>登録について</strong>
          <br />
          アカウントは管理者からの招待で作成します。
        </p>
        <p>
          <strong>パスワードを忘れた場合</strong>
          <br />
          管理者に再設定リンクの発行を依頼してください。
        </p>
        <p>
          <strong>使い方</strong>
          <br />
          <Link to="/help">ヘルプ</Link>をご覧ください。
        </p>
      </div>
    </AuthCard>
  );
}

export function SetupPage() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ token: "", email: "", name: "", password: "" });
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const r = await api.post<{ user: User }>("/auth/setup", form);
      setUser(r.user);
      leaveForm();
      navigate("/admin");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value }),
    required: true,
  });

  return (
    <AuthCard title="初期設定（最初の管理者）">
      <p className="muted small">デプロイ時に設定した SETUP_TOKEN を入力します。管理者を作成すると、この画面は使えなくなります。</p>
      <form onSubmit={submit} className="stack">
        <label>
          セットアップトークン
          <input type="password" autoComplete="off" {...field("token")} />
        </label>
        <label>
          表示名
          <input {...field("name")} />
        </label>
        <label>
          メールアドレス
          <input type="email" autoComplete="username" {...field("email")} />
        </label>
        <label>
          パスワード（{PASSWORD_HINT}）<input type="password" autoComplete="new-password" minLength={PASSWORD_MIN} {...field("password")} />
        </label>
        <ErrorAlert message={error} />
        <button type="submit">管理者を作成</button>
      </form>
    </AuthCard>
  );
}

export function InvitePage() {
  const token = useFragmentToken();
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const email = useLinkEmail("invite", token, setError);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const r = await api.post<{ user: User }>("/auth/invite/accept", { token, name, password });
      setUser(r.user);
      leaveForm();
      navigate("/", { replace: true, state: { welcome: true } });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <AuthCard title="komonowa に参加">
      {email === null ? (
        <LinkPending error={error} />
      ) : (
        <form onSubmit={submit} className="stack">
          <label>
            メールアドレス
            <input value={email} readOnly />
          </label>
          <label>
            表示名
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={50} />
          </label>
          <label>
            パスワード（{PASSWORD_HINT}）
            <input
              type="password"
              autoComplete="new-password"
              minLength={PASSWORD_MIN}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <ErrorAlert message={error} />
          <button type="submit">登録する</button>
        </form>
      )}
    </AuthCard>
  );
}

export function ResetPage() {
  const token = useFragmentToken();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const email = useLinkEmail("reset", token, setError);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.post("/auth/reset/accept", { token, password });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <AuthCard title="パスワードの再設定">
      {done ? (
        <p>
          パスワードを変更しました。<Link to="/login">ログイン</Link>してください。
        </p>
      ) : email === null ? (
        <LinkPending error={error} />
      ) : (
        <form onSubmit={submit} className="stack">
          <label>
            メールアドレス
            <input value={email} readOnly />
          </label>
          <label>
            新しいパスワード（{PASSWORD_HINT}）
            <input
              type="password"
              autoComplete="new-password"
              minLength={PASSWORD_MIN}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <ErrorAlert message={error} />
          <button type="submit">変更する</button>
        </form>
      )}
    </AuthCard>
  );
}

/**
 * メールアドレス変更の確定（/email#トークン）。ログインしていなくても使える。
 * メールソフトのリンク検査が先に開いても確定しないよう、開いただけでは送らずボタンで確定する
 */
export function EmailConfirmPage() {
  const token = useFragmentToken();
  const { user, setUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const r = await api.post<{ email: string }>("/auth/email/confirm", { token });
      setDone(r.email);
      // ログイン中なら画面の利用者情報も新しいアドレスにする
      if (user) setUser({ ...user, email: r.email });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="メールアドレスの変更">
      {done ? (
        <p>
          メールアドレスを {done} に変更しました。{user ? <Link to="/account">アカウントに戻る</Link> : <Link to="/login">ログイン</Link>}
        </p>
      ) : (
        <form onSubmit={submit} className="stack">
          <p>ボタンを押すと、このメールアドレスに変更します。</p>
          <ErrorAlert message={error} />
          <button type="submit" disabled={busy || !token}>
            {busy ? "変更中…" : "変更を確定する"}
          </button>
        </form>
      )}
    </AuthCard>
  );
}
