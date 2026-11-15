import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { api, type Tag } from "./api";
import { matchKey } from "./completion";
import { parseTagInput, suggestTags } from "./tagSuggestions";
import { tagHue } from "./tagColor";

export function TagInput({ value, onChange, onPendingChange }: { value: string; onChange: (value: string) => void; onPendingChange: (value: string) => void }) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [failed, setFailed] = useState(false);
  const composing = useRef(false);
  const id = useId();
  function changeQuery(text: string) {
    setQuery(text);
    onPendingChange(text);
  }
  const selected = parseTagInput(value);
  const suggestions = suggestTags(tags, query, selected);
  const fresh = parseTagInput(query)[0];
  const canCreate = fresh && ![...tags.map((t) => t.name), ...selected].some((t) => matchKey(t) === matchKey(fresh));
  const choices = [...suggestions.map((t) => t.name), ...(canCreate ? [fresh] : [])];
  useEffect(() => {
    api
      .get<{ tags: Tag[] }>("/articles/tags")
      .then((r) => setTags(r.tags))
      .catch(() => setFailed(true));
  }, []);
  function add(text: string) {
    onChange(parseTagInput([...selected, text].join(", ")).join(", "));
    changeQuery("");
    setActive(0);
  }
  const shown = open && choices.length > 0;
  return (
    <div className="tag-input">
      <label htmlFor={id}>タグ</label>
      <div className="tag-input-chips">
        {selected.map((tag) => (
          <button
            key={tag}
            type="button"
            className="filter-chip"
            style={{ "--tag-hue": tagHue(tag) } as CSSProperties}
            aria-label={`タグ「${tag}」を外す`}
            onClick={() => onChange(selected.filter((t) => t !== tag).join(", "))}
          >
            #{tag}
            <span aria-hidden="true">×</span>
          </button>
        ))}
      </div>
      <div className="tag-combobox">
        <input
          id={id}
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={shown}
          aria-controls={shown ? `${id}-list` : undefined}
          aria-activedescendant={shown ? `${id}-option-${Math.min(active, choices.length - 1)}` : undefined}
          placeholder="タグを入力・選択"
          value={query}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            if (!composing.current && query.trim()) add(query);
            setOpen(false);
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onChange={(e) => {
            const text = e.target.value;
            if (!composing.current && /[,、\s]$/.test(text)) add(text);
            else changeQuery(text);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || composing.current || e.keyCode === 229) return;
            if ((e.key === "ArrowDown" || e.key === "ArrowUp") && choices.length) {
              e.preventDefault();
              setOpen(true);
              setActive((n) => (n + (e.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (shown && choices[active]) add(choices[active]!);
              else if (query.trim()) add(query);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
            }
          }}
        />
        {shown && (
          <div className="tag-suggestions" id={`${id}-list`} role="listbox" aria-label="タグの候補">
            {choices.map((name, i) => (
              <div
                key={name}
                id={`${id}-option-${i}`}
                role="option"
                tabIndex={-1}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    add(name);
                  }
                }}
                aria-selected={i === active}
                className={i === active ? "active" : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => add(name)}
              >
                <span className="tag-dot" style={{ "--tag-hue": tagHue(name) } as CSSProperties} />
                <span>{i < suggestions.length ? name : `「${name}」を新しく追加`}</span>
                {suggestions[i] && <span className="muted small">{suggestions[i]!.count}件</span>}
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="muted small">
        {failed ? "候補を取得できませんでした。タグは直接入力できます。" : "既存のタグを選ぶか、新しい名前をEnter・カンマで追加できます。"}
      </p>
    </div>
  );
}
