import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import type { User } from "./api";
import { Avatar } from "./Avatar";
import { ThemePicker } from "./ThemePicker";

/**
 * ヘッダーの自分の名前。押すと、自分に関わる行き先（自分のページ・アカウント設定・サイト管理・ヘルプ）、画面の明るさ、ログアウトが開く。
 * 中身はふつうのリンクとボタンなので、Tab で順に移れる。Esc・外側の操作・画面の移動で閉じる
 */
export function UserMenu({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const location = useLocation();

  // biome-ignore lint/correctness/useExhaustiveDependencies: 画面が変わったら閉じる（location は合図として使う）
  useEffect(() => setOpen(false), [location]);

  useEffect(() => {
    if (!open) return;
    // メニューの外を押したとき、Tab でメニューの外へ出たとき
    const onOutside = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("focusin", onOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("focusin", onOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="user-menu" ref={root}>
      <button
        ref={button}
        type="button"
        className={open ? "account open" : "account"}
        aria-expanded={open}
        aria-controls="user-menu-list"
        aria-label={`${user.name} のメニュー`}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar userId={user.id} name={user.name} avatarId={user.avatar_id} />
        <span>{user.name}</span>
        <span className="caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <ul id="user-menu-list" className="user-menu-list">
          <li>
            <Link to={`/users/${user.id}`}>自分のページ</Link>
          </li>
          <li>
            <Link to="/account">アカウント設定</Link>
          </li>
          <li>
            <Link to="/import/cosense">Cosense から取り込む</Link>
          </li>
          {user.role === "admin" && (
            <li>
              <Link to="/admin">サイト管理</Link>
            </li>
          )}
          <li>
            <Link to="/help">ヘルプ</Link>
          </li>
          <li className="separated">
            <ThemePicker />
          </li>
          <li className="separated">
            <button type="button" className="link" onClick={onLogout}>
              ログアウト
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
