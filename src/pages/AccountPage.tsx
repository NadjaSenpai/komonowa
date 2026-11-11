import { useState, type FormEvent } from "react";
import { useAuth } from "../App";
import { api, errorMessage } from "../api";

export function AccountPage() {
  const { user } = useAuth();
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
    <div className="narrow">
      <h1>アカウント</h1>
      <p>{user?.name}（{user?.email}）· {user?.role === "admin" ? "管理者" : "メンバー"}</p>
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
        <button type="submit">変更する</button>
      </form>
    </div>
  );
}
