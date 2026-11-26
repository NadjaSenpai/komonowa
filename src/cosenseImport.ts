// Cosense の取り込み画面（pages/CosenseImportPage.tsx）の、ページの選択の状態
import type { ConvertedPage } from "../shared/cosense";
import { titleKey } from "../shared/wikilinks";

const MAX_BODY = 200_000;

export interface ImportRow {
  key: string;
  page: ConvertedPage;
  /** 取り込むときのタイトル（同名なら利用者が変えられる） */
  title: string;
  checked: boolean;
  /** taken: 既存の記事と同名、duplicate: このファイルの前のページと同名、too-long: 本文が長すぎる */
  problem: "taken" | "duplicate" | "too-long" | null;
}

/** 上から順に問題を判定し直す。問題のある行はチェックを外す（問題が消えても勝手にはチェックしない） */
function judge(rows: ImportRow[], taken: Set<string>): ImportRow[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    const key = titleKey(row.title);
    const problem = row.page.body.length > MAX_BODY ? "too-long" : taken.has(key) ? "taken" : seen.has(key) ? "duplicate" : null;
    seen.add(key);
    return { ...row, problem, checked: problem === null && row.checked };
  });
}

/** 読み込んだページの行。taken は titleKey 済みの既存記事のタイトル */
export function buildRows(pages: ConvertedPage[], taken: Set<string>): ImportRow[] {
  return judge(
    pages.map((page, i) => ({ key: String(i), page, title: page.title, checked: true, problem: null })),
    taken,
  );
}

/** 行のタイトルを変える */
export function renameRow(rows: ImportRow[], key: string, title: string, taken: Set<string>): ImportRow[] {
  return judge(
    rows.map((row) => (row.key === key ? { ...row, title } : row)),
    taken,
  );
}
