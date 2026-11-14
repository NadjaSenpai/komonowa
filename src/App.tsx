import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router";
import { api, type User } from "./api";
import { Avatar } from "./Avatar";
import { AccountPage } from "./pages/AccountPage";
import { AdminPage } from "./pages/AdminPage";
import { ArticleEditPage } from "./pages/ArticleEditPage";
import { ArticleListPage } from "./pages/ArticleListPage";
import { ArticleViewPage } from "./pages/ArticleViewPage";
import { HistoryPage } from "./pages/HistoryPage";
import { InvitePage, LoginPage, ResetPage, SetupPage } from "./pages/AuthPages";
import { WikiLinkPage } from "./pages/WikiLinkPage";

interface AuthState {
  user: User | null;
  setUser: (user: User | null) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthContext missing");
  return value;
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ user: User }>("/auth/me")
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
    const onUnauthorized = () => setUser(null);
    window.addEventListener("wiki:unauthorized", onUnauthorized);
    return () => window.removeEventListener("wiki:unauthorized", onUnauthorized);
  }, []);

  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => undefined);
    setUser(null);
  }, []);

  if (loading) return <p className="center muted">読み込み中…</p>;

  return (
    <AuthContext.Provider value={{ user, setUser, logout }}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/invite" element={<InvitePage />} />
        <Route path="/reset" element={<ResetPage />} />
        <Route path="/" element={<Protected><ArticleListPage /></Protected>} />
        <Route path="/articles/new" element={<Protected><ArticleEditPage /></Protected>} />
        <Route path="/articles/:id" element={<Protected><ArticleViewPage /></Protected>} />
        <Route path="/articles/:id/edit" element={<Protected><ArticleEditPage /></Protected>} />
        <Route path="/articles/:id/history" element={<Protected><HistoryPage /></Protected>} />
        <Route path="/wiki/:title" element={<Protected><WikiLinkPage /></Protected>} />
        <Route path="/account" element={<Protected><AccountPage /></Protected>} />
        <Route path="/admin" element={<Protected admin><AdminPage /></Protected>} />
        <Route path="*" element={<Protected><p>ページが見つかりません。</p></Protected>} />
      </Routes>
    </AuthContext.Provider>
  );
}

function Protected({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (admin && user.role !== "admin") return <Layout><p>管理者のみ表示できます。</p></Layout>;
  return <Layout>{children}</Layout>;
}

function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">komonowa</Link>
        <nav>
          <NavLink to="/" end>記事</NavLink>
          {user?.role === "admin" && <NavLink to="/admin">管理</NavLink>}
          {user && (
            <NavLink to="/account" className="account" title="アカウント設定">
              <Avatar userId={user.id} name={user.name} avatarId={user.avatar_id} />
              <span>{user.name}</span>
            </NavLink>
          )}
          <button
            type="button"
            className="link"
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
          >
            ログアウト
          </button>
        </nav>
        <Link to="/articles/new" className="button small new-article">新しい記事</Link>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
