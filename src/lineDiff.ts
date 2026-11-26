// 変更履歴の差分（1 つ前の版との比較）。設計: docs/superpowers/specs/2026-11-26-history-diff-design.md

export type Segment = { text: string; changed: boolean };
export type DiffLine = { kind: "same" | "del" | "add"; text: string; parts?: Segment[] };
export type DiffBlock = DiffLine | { kind: "skip"; count: number };

// LCS の表の大きさの上限。超えたら、共通の先頭・末尾を除いた残りを全部削除＋全部追加とみなす
const MAX_LINE_CELLS = 4_000_000;
// 行内の文字差分の上限。超えたら強調を省く
const MAX_CHAR_CELLS = 1_000_000;

type Op = "same" | "del" | "add";

/**
 * a から b への編集の並び。変更の区間の中では削除を先、追加を後に並べる。
 * 表が maxCells を超えるとき、replace なら残りを全部削除＋全部追加とし、そうでなければ null
 */
function editOps<T>(a: T[], b: T[], maxCells: number, replace: boolean): Op[] | null {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const n = endA - start;
  const m = endB - start;
  const head: Op[] = Array(start).fill("same");
  const tail: Op[] = Array(a.length - endA).fill("same");
  if (n * m > maxCells) {
    if (!replace) return null;
    return [...head, ...Array<Op>(n).fill("del"), ...Array<Op>(m).fill("add"), ...tail];
  }
  // dp[i * (m + 1) + j] = a[start + i..endA) と b[start + j..endB) の LCS の長さ
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[start + i] === b[start + j] ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
    }
  }
  const middle: Op[] = [];
  let dels: Op[] = [];
  let adds: Op[] = [];
  const flush = () => {
    middle.push(...dels, ...adds);
    dels = [];
    adds = [];
  };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[start + i] === b[start + j]) {
      flush();
      middle.push("same");
      i++;
      j++;
    } else if (j >= m || (i < n && dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!)) {
      dels.push("del");
      i++;
    } else {
      adds.push("add");
      j++;
    }
  }
  flush();
  return [...head, ...middle, ...tail];
}

function segments(chars: string[], flags: boolean[]): Segment[] {
  const out: Segment[] = [];
  chars.forEach((c, k) => {
    const last = out[out.length - 1];
    if (last && last.changed === flags[k]) last.text += c;
    else out.push({ text: c, changed: flags[k]! });
  });
  return out;
}

/** 1 行の中の文字単位の差分。長すぎるときは null */
export function diffChars(before: string, after: string): { before: Segment[]; after: Segment[] } | null {
  const a = Array.from(before);
  const b = Array.from(after);
  const ops = editOps(a, b, MAX_CHAR_CELLS, false);
  if (!ops) return null;
  const fa: boolean[] = [];
  const fb: boolean[] = [];
  for (const op of ops) {
    if (op !== "add") fa.push(op === "del");
    if (op !== "del") fb.push(op === "add");
  }
  return { before: segments(a, fa), after: segments(b, fb) };
}

/** 行ごとの差分。同じ数の削除行・追加行が隣り合う区間では、対の行に行内の差分を付ける */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.replace(/\r\n?/g, "\n").split("\n");
  const b = after.replace(/\r\n?/g, "\n").split("\n");
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  for (const op of editOps(a, b, MAX_LINE_CELLS, true)!) {
    if (op === "add") lines.push({ kind: "add", text: b[j++]! });
    else {
      lines.push({ kind: op, text: a[i++]! });
      if (op === "same") j++;
    }
  }
  // 変更の区間ごとに、削除と追加が同じ数なら対にする
  for (let k = 0; k < lines.length; ) {
    if (lines[k]!.kind === "same") {
      k++;
      continue;
    }
    let d = k;
    while (d < lines.length && lines[d]!.kind === "del") d++;
    let e = d;
    while (e < lines.length && lines[e]!.kind === "add") e++;
    if (d - k === e - d) {
      for (let p = 0; p < d - k; p++) {
        const chars = diffChars(lines[k + p]!.text, lines[d + p]!.text);
        if (!chars) continue;
        lines[k + p]!.parts = chars.before;
        lines[d + p]!.parts = chars.after;
      }
    }
    k = Math.max(e, k + 1);
  }
  return lines;
}

/** 変更の前後 context 行だけ残し、ほかの変わっていない行をたたむ */
export function foldContext(lines: DiffLine[], context = 3): DiffBlock[] {
  const keep = lines.map(() => false);
  lines.forEach((l, k) => {
    if (l.kind === "same") return;
    for (let p = Math.max(0, k - context); p <= Math.min(lines.length - 1, k + context); p++) keep[p] = true;
  });
  const out: DiffBlock[] = [];
  lines.forEach((l, k) => {
    if (keep[k]) return void out.push(l);
    const last = out[out.length - 1];
    if (last?.kind === "skip") last.count++;
    else out.push({ kind: "skip", count: 1 });
  });
  return out;
}

export function diffTags(before: string[], after: string[]): { added: string[]; removed: string[] } {
  return { added: after.filter((t) => !before.includes(t)), removed: before.filter((t) => !after.includes(t)) };
}
