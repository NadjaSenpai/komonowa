import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, NavLink, Route, Routes, ScrollRestoration, useLocation, useNavigate } from "react-router";
import { api, type User } from "./api";
import { Avatar } from "./Avatar";
import { ArticleEditPage } from "./pages/ArticleEditPage";
import { ArticleListPage } from "./pages/ArticleListPage";
import { ArticleViewPage } from "./pages/ArticleViewPage";
import { EmailConfirmPage, InvitePage, LoginPage, ResetPage, SetupPage } from "./pages/AuthPages";
import { SharedPage } from "./pages/SharedPage";
import { WikiLinkPage } from "./pages/WikiLinkPage";

// たまにしか開かない画面は、開いたときに読み込む（最初に読み込む JS を減らす）
const AccountPage = lazy(() => import("./pages/AccountPage").then((m) => ({ default: m.AccountPage })));
const AdminPage = lazy(() => import("./pages/AdminPage").then((m) => ({ default: m.AdminPage })));
const HelpPage = lazy(() => import("./pages/HelpPage").then((m) => ({ default: m.HelpPage })));
const HistoryPage = lazy(() => import("./pages/HistoryPage").then((m) => ({ default: m.HistoryPage })));

function Content({ children }: { children: ReactNode }) {
  return (
    <main className="content">
      <Suspense fallback={<p className="muted">読み込み中…</p>}>{children}</Suspense>
    </main>
  );
}

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
      {/* 画面が変わったら上から表示する（戻るでは元の位置）。スマホでキーボードが出てずれた位置を引き継がない */}
      <ScrollRestoration />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/setup" element={<SetupPage />} />
        {/* 外部共有された記事。ログイン不要 */}
        <Route path="/s/:token" element={<SharedPage />} />
        <Route path="/invite" element={<InvitePage />} />
        <Route path="/reset" element={<ResetPage />} />
        <Route path="/email" element={<EmailConfirmPage />} />
        <Route path="/help" element={<HelpRoute />} />
        {/* ここから下はログインが必要 */}
        <Route path="/" element={<Protected page={<ArticleListPage />} />} />
        <Route path="/articles/new" element={<Protected page={<ArticleEditPage />} />} />
        <Route path="/articles/:id" element={<Protected page={<ArticleViewPage />} />} />
        <Route path="/articles/:id/edit" element={<Protected page={<ArticleEditPage />} />} />
        <Route path="/articles/:id/history" element={<Protected page={<HistoryPage />} />} />
        <Route path="/wiki/:title" element={<Protected page={<WikiLinkPage />} />} />
        <Route path="/account" element={<Protected page={<AccountPage />} />} />
        <Route path="/admin" element={<Protected admin page={<AdminPage />} />} />
        <Route path="*" element={<Protected page={<p>ページが見つかりません。</p>} />} />
      </Routes>
    </AuthContext.Provider>
  );
}

function Protected({ page, admin = false }: { page: ReactNode; admin?: boolean }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (admin && user.role !== "admin")
    return (
      <Layout>
        <p>管理者のみ表示できます。</p>
      </Layout>
    );
  return <Layout>{page}</Layout>;
}

/** ヘルプはログインしていなくても読める（ログイン画面・招待画面から開けるように） */
function HelpRoute() {
  const { user } = useAuth();
  if (user)
    return (
      <Layout>
        <HelpPage />
      </Layout>
    );
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          komonowa
        </Link>
        <nav>
          <NavLink to="/login">ログイン</NavLink>
        </nav>
      </header>
      <Content>
        <HelpPage />
      </Content>
    </div>
  );
}

function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          komonowa
        </Link>
        <nav>
          <NavLink to="/" end>
            記事
          </NavLink>
          {user?.role === "admin" && <NavLink to="/admin">管理</NavLink>}
          <NavLink to="/help">ヘルプ</NavLink>
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
        <Link to="/articles/new" className="button small new-article">
          新しい記事
        </Link>
      </header>
      <Content>{children}</Content>
    </div>
  );
}
