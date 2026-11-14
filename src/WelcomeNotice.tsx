import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";

/**
 * 招待から登録した直後だけ出す一言（InvitePage が state.welcome を付けて記事一覧へ移る）。
 * どこにも保存しない。表示したらすぐ履歴の state を消して、戻る・再読み込みで出直さないようにする
 */
export function WelcomeNotice() {
  const location = useLocation();
  const navigate = useNavigate();
  const welcome = (location.state as { welcome?: unknown } | null)?.welcome === true;
  const [shown, setShown] = useState(welcome);

  useEffect(() => {
    if (welcome) navigate(location.pathname + location.search, { replace: true, state: null });
  }, [welcome, navigate, location.pathname, location.search]);

  if (!shown) return null;
  return (
    <p className="notice" role="status">
      ようこそ。はじめての方は<Link to="/help">ヘルプ</Link>をどうぞ。記事の読み方・書き方をまとめています。{" "}
      <button type="button" className="link small" onClick={() => setShown(false)}>
        閉じる
      </button>
    </p>
  );
}
