import { type ChangeEvent, useState } from "react";
import { Link } from "react-router";
import { convertCosensePage, parseCosenseExport } from "../../shared/cosense";
import { titleKey } from "../../shared/wikilinks";
import { api, errorMessage, formatDate } from "../api";
import { buildRows, type ImportRow, renameRow } from "../cosenseImport";

/** 同名チェック API が一度に受け付ける件数 */
const CHECK_CHUNK = 5000;

const PROBLEM_LABEL: Record<NonNullable<ImportRow["problem"]>, string> = {
  taken: "同じタイトルの記事があります。名前を変えると取り込めます",
  duplicate: "このファイルの前のページと同じタイトルです。名前を変えると取り込めます",
  "too-long": "本文が長すぎるため取り込めません",
};

interface Result {
  done: { id: string; title: string }[];
  failed: { title: string; reason: string }[];
  imagesFailed: { id: string; title: string; count: number }[];
}

/** Cosense（旧 Scrapbox）のエクスポート JSON から記事を取り込む（/import/cosense）。設計: docs/superpowers/specs/2026-11-26-cosense-import-design.md */
export function CosenseImportPage() {
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [taken, setTaken] = useState(new Set<string>());
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function load(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setRows(null);
    setResult(null);
    try {
      let data: unknown;
      try {
        data = JSON.parse(await file.text());
      } catch {
        data = null;
      }
      const pages = parseCosenseExport(data);
      if (!pages) {
        setError("Cosense のエクスポートファイルではないようです");
        return;
      }
      const converted = pages.map(convertCosensePage);
      const titles = converted.map((p) => p.title);
      const found = new Set<string>();
      for (let i = 0; i < titles.length; i += CHECK_CHUNK) {
        const r = await api.post<{ taken: string[] }>("/import/cosense/check", { titles: titles.slice(i, i + CHECK_CHUNK) });
        for (const t of r.taken) found.add(titleKey(t));
      }
      setTaken(found);
      setRows(buildRows(converted, found));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function run() {
    if (!rows) return;
    const targets = rows.filter((r) => r.checked);
    const next: Result = { done: [], failed: [], imagesFailed: [] };
    for (const [i, row] of targets.entries()) {
      setProgress({ current: i + 1, total: targets.length });
      const { body, tags, created, updated } = row.page;
      try {
        const r = await api.post<{ article: { id: string; title: string }; images: { saved: number; failed: number } }>("/import/cosense/pages", {
          title: row.title,
          body,
          tags,
          created,
          updated,
        });
        next.done.push(r.article);
        if (r.images.failed > 0) next.imagesFailed.push({ ...r.article, count: r.images.failed });
      } catch (err) {
        next.failed.push({ title: row.title, reason: errorMessage(err) });
      }
    }
    setProgress(null);
    setRows(null);
    setResult(next);
  }

  const checkedCount = rows?.filter((r) => r.checked).length ?? 0;
  const setAll = (checked: boolean) => setRows((current) => current?.map((r) => ({ ...r, checked: checked && r.problem === null })) ?? null);

  return (
    <div className="cosense-import">
      <h1>Cosense から取り込む</h1>
      <p className="muted small">
        Cosense のプロジェクト設定の「Export Pages」で書き出した JSON ファイルを選んでください。ファイルはこのブラウザで読み、選んだページだけを送ります。
      </p>
      {!progress && (
        <label className="import-file">
          エクスポートファイル（.json）
          <input type="file" accept=".json,application/json" onChange={load} />
        </label>
      )}
      {error && <p className="error">{error}</p>}

      {progress && (
        <p className="notice" role="status">
          取り込み中… {progress.current} / {progress.total}（ページを閉じると、そこで止まります）
        </p>
      )}

      {rows && !progress && (
        <section aria-label="取り込むページ">
          <div className="actions import-actions">
            <button type="button" className="secondary small" onClick={() => setAll(true)}>
              すべて選ぶ
            </button>
            <button type="button" className="secondary small" onClick={() => setAll(false)}>
              すべて外す
            </button>
            <span className="muted small">
              {rows.length} ページ中 {checkedCount} ページを選択中
            </span>
            <button type="button" disabled={checkedCount === 0} onClick={run}>
              {checkedCount} ページを取り込む
            </button>
          </div>
          <table className="import-table">
            <thead>
              <tr>
                <th scope="col">取り込む</th>
                <th scope="col">タイトル</th>
                <th scope="col">更新日</th>
                <th scope="col">画像</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const editable = row.problem === "taken" || row.problem === "duplicate" || row.title !== row.page.title;
                return (
                  <tr key={row.key}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`「${row.title}」を取り込む`}
                        checked={row.checked}
                        disabled={row.problem !== null}
                        onChange={(e) => setRows((current) => current?.map((r) => (r.key === row.key ? { ...r, checked: e.target.checked } : r)) ?? null)}
                      />
                    </td>
                    <td>
                      {editable ? (
                        <input
                          type="text"
                          aria-label={`「${row.page.title}」の取り込み後のタイトル`}
                          value={row.title}
                          maxLength={200}
                          onChange={(e) => setRows((current) => (current ? renameRow(current, row.key, e.target.value, taken) : null))}
                        />
                      ) : (
                        row.title
                      )}
                      {row.problem && <p className="small error">{PROBLEM_LABEL[row.problem]}</p>}
                    </td>
                    <td className="small">{formatDate(row.page.updated)}</td>
                    <td className="small">{row.page.images}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {result && (
        <section aria-label="取り込みの結果" className="import-result">
          <h2>{result.done.length} ページを取り込みました</h2>
          {result.done.length > 0 && (
            <ul>
              {result.done.map((a) => (
                <li key={a.id}>
                  <Link to={`/articles/${a.id}`}>{a.title}</Link>
                </li>
              ))}
            </ul>
          )}
          {result.imagesFailed.length > 0 && (
            <>
              <h2>保存できなかった画像</h2>
              <p className="muted small">非公開のプロジェクトの画像などは komonowa に保存できないため、元の URL のまま残しています。</p>
              <ul>
                {result.imagesFailed.map((a) => (
                  <li key={a.id}>
                    <Link to={`/articles/${a.id}`}>{a.title}</Link>：{a.count} 枚
                  </li>
                ))}
              </ul>
            </>
          )}
          {result.failed.length > 0 && (
            <>
              <h2>取り込めなかったページ</h2>
              <ul>
                {result.failed.map((f) => (
                  <li key={f.title}>
                    {f.title}：<span className="error">{f.reason}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}
