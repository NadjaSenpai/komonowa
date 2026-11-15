import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { api } from "./api";
import { Avatar } from "./Avatar";
import { applySuggestion, caretOffset, findTrigger, matchKey, type Suggestion, type Trigger } from "./completion";
import { insertIntoTextarea } from "./markup";
import { loadMembers } from "./members";

const MAX_MEMBERS = 8;
const LIST_ID = "completion-list";

interface Open {
  trigger: Trigger;
  items: Suggestion[];
  active: number;
  top: number;
  left: number;
}

async function suggestionsFor(trigger: Trigger): Promise<Suggestion[]> {
  if (trigger.kind === "article") {
    const r = await api.get<{ titles: string[] }>(`/articles/titles?q=${encodeURIComponent(trigger.query)}`);
    return r.titles.map((title) => ({ kind: "article", title }));
  }
  const query = matchKey(trigger.query);
  return (await loadMembers())
    .filter((m) => matchKey(m.name).includes(query))
    .slice(0, MAX_MEMBERS)
    .map((m) => ({ kind: "member", id: m.id, name: m.name, avatar_id: m.avatar_id }));
}

/**
 * 本文欄の入力補完。[[ と打つと記事のタイトル、@ と打つとメンバーの候補を、カーソルの下に出す。
 * ↑↓ で選び、Enter か Tab で入れる。Esc で閉じる。候補がないときは何も出さず、ふつうに打ち続けられる。
 * 本文欄を position: relative の要素で包み、その中に popup を置いて使う
 */
export function useCompletion(textarea: RefObject<HTMLTextAreaElement | null>, setBody: (next: string) => void) {
  const [open, setOpen] = useState<Open | null>(null);
  // Esc で閉じたきっかけ。同じ場所で打ち続けている間は出し直さない
  const dismissed = useRef<number | null>(null);
  // 候補の取得は前後することがあるので、最後に頼んだものだけ使う
  const request = useRef(0);

  const close = useCallback(() => {
    request.current += 1;
    setOpen(null);
  }, []);

  /** 入力やカーソルの移動のたびに呼ぶ */
  const update = useCallback(() => {
    const el = textarea.current;
    const trigger = el && el.selectionStart === el.selectionEnd ? findTrigger(el.value, el.selectionStart) : null;
    if (!el || !trigger) {
      dismissed.current = null;
      return close();
    }
    if (dismissed.current === trigger.from) return;
    dismissed.current = null;
    const id = ++request.current;
    suggestionsFor(trigger)
      .then((items) => {
        if (id !== request.current) return;
        if (items.length === 0) return setOpen(null);
        const at = caretOffset(el, trigger.from);
        // 欄の右端からはみ出さないようにする
        setOpen({ trigger, items, active: 0, top: at.top, left: Math.max(0, Math.min(at.left, el.clientWidth - 280)) });
      })
      // 候補が取れなくても、書くことの邪魔はしない
      .catch(() => id === request.current && setOpen(null));
  }, [textarea, close]);

  const choose = useCallback(
    (choice: Suggestion) => {
      const el = textarea.current;
      if (!el || !open) return;
      insertIntoTextarea(el, applySuggestion(el.value, el.selectionStart, open.trigger, choice), setBody);
      close();
    },
    [textarea, open, setBody, close],
  );

  /** 本文欄の onKeyDown の最初に呼ぶ。候補の操作として使ったら true（呼び出し側はそれ以上なにもしない） */
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      // 日本語入力の変換中の Enter や矢印は、変換の操作
      if (!open || e.nativeEvent.isComposing) return false;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setOpen({ ...open, active: (open.active + step + open.items.length) % open.items.length });
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false;
        e.preventDefault();
        choose(open.items[open.active]!);
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        dismissed.current = open.trigger.from;
        close();
        return true;
      }
      return false;
    },
    [open, choose, close],
  );

  // 選んでいる候補が見えるところまで送る
  const list = useRef<HTMLDivElement>(null);
  const active = open?.active;
  useEffect(() => {
    if (active !== undefined) list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const popup: ReactNode = open && (
    <div
      ref={list}
      id={LIST_ID}
      className="completion"
      role="listbox"
      aria-label={open.trigger.kind === "article" ? "記事の候補" : "メンバーの候補"}
      style={{ top: open.top, left: open.left }}
    >
      {open.items.map((item, i) => (
        <div
          key={item.kind === "article" ? item.title : item.id}
          id={`${LIST_ID}-${i}`}
          role="option"
          tabIndex={-1}
          aria-selected={i === open.active}
          className={i === open.active ? "active" : undefined}
          // 押しても本文欄からフォーカスを外さない
          onMouseDown={(e) => {
            e.preventDefault();
            choose(item);
          }}
        >
          {item.kind === "member" && <Avatar userId={item.id} name={item.name} avatarId={item.avatar_id} />}
          <span>{item.kind === "article" ? item.title : item.name}</span>
        </div>
      ))}
    </div>
  );

  return {
    update,
    close,
    onKeyDown,
    popup,
    /** 本文欄に付ける、読み上げ用の属性 */
    aria: {
      "aria-autocomplete": "list" as const,
      "aria-controls": open ? LIST_ID : undefined,
      "aria-activedescendant": open ? `${LIST_ID}-${open.active}` : undefined,
    },
  };
}
