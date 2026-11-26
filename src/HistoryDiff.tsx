import { useMemo } from "react";
import { diffLines, diffTags, foldContext, type DiffLine } from "./lineDiff";

export interface RevisionContent {
  version: number;
  title: string;
  body: string;
  tags: string[];
}

const SIGN = { same: " ", del: "−", add: "+" };

function Line({ line }: { line: DiffLine }) {
  return (
    <div className={`diff-line diff-${line.kind}`}>
      <span className="diff-sign" aria-hidden="true">
        {SIGN[line.kind]}
      </span>
      <span className="diff-text">
        {line.parts
          ? line.parts.map((p, k) =>
              p.changed ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: 行の中の並びは変わらない
                <span key={k} className="diff-strong">
                  {p.text}
                </span>
              ) : (
                p.text
              ),
            )
          : line.text || " "}
      </span>
    </div>
  );
}

/** 1 つ前の版（before）から、この版（after）への変更。本文は Markdown の原文を文字として出す */
export function HistoryDiff({ before, after }: { before: RevisionContent; after: RevisionContent }) {
  const blocks = useMemo(() => foldContext(diffLines(before.body, after.body)), [before.body, after.body]);
  const tags = diffTags(before.tags, after.tags);
  const unchanged = blocks.every((b) => b.kind === "skip");
  return (
    <div className="history-diff">
      {before.title !== after.title && (
        <p className="meta">
          タイトル：{before.title} → {after.title}
        </p>
      )}
      {(tags.added.length > 0 || tags.removed.length > 0) && (
        <p className="meta">タグ：{[...tags.added.map((t) => `+${t}`), ...tags.removed.map((t) => `−${t}`)].join(" ")}</p>
      )}
      {unchanged ? (
        <p className="muted">本文の変更はありません</p>
      ) : (
        <div className="diff">
          {blocks.map((b, k) =>
            b.kind === "skip" ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: 差分の並びは描き直すまで変わらない
              <div key={k} className="diff-line diff-skip">
                … {b.count} 行
              </div>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: 同上
              <Line key={k} line={b} />
            ),
          )}
        </div>
      )}
    </div>
  );
}
