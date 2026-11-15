import { useState } from "react";
import { getTheme, setTheme, type Theme } from "./theme";

const OPTIONS: { value: Theme; label: string; title: string }[] = [
  { value: "system", label: "自動", title: "OS の設定に合わせる" },
  { value: "light", label: "ライト", title: "いつも明るい画面" },
  { value: "dark", label: "ダーク", title: "いつも暗い画面" },
];

/** 画面の明るさ。押すとすぐ切り替わり、この端末のブラウザに覚える（src/theme.ts） */
export function ThemePicker() {
  const [theme, setCurrent] = useState<Theme>(getTheme);
  return (
    <div className="theme-picker">
      <span className="theme-picker-label" id="theme-picker-label">
        画面の明るさ
      </span>
      <div className="theme-picker-options" role="group" aria-labelledby="theme-picker-label">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            className="secondary small"
            title={o.title}
            aria-pressed={theme === o.value}
            onClick={() => {
              setTheme(o.value);
              setCurrent(o.value);
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
