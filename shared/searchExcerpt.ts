export function searchExcerpt(body: string, terms: string[]): string {
  const lower = body.toLowerCase();
  const positions = terms.map((t) => lower.indexOf(t.toLowerCase())).filter((n) => n >= 0);
  const at = positions.length ? Math.min(...positions) : 0;
  const start = Math.max(0, at - 50);
  return (start ? "…" : "") + body.slice(start, start + 160) + (start + 160 < body.length ? "…" : "");
}
export function highlightParts(text: string, query: string): { text: string; match: boolean }[] {
  const terms = [
    ...new Set(
      query
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 10)
        .map((t) => t.toLowerCase()),
    ),
  ].sort((a, b) => b.length - a.length);
  if (!terms.length) return [{ text, match: false }];
  const lower = text.toLowerCase(),
    parts: { text: string; match: boolean }[] = [];
  let cursor = 0,
    plain = 0;
  while (cursor < text.length) {
    const term = terms.find((t) => lower.startsWith(t, cursor));
    if (!term) {
      cursor++;
      continue;
    }
    if (cursor > plain) parts.push({ text: text.slice(plain, cursor), match: false });
    parts.push({ text: text.slice(cursor, cursor + term.length), match: true });
    cursor += term.length;
    plain = cursor;
  }
  if (plain < text.length) parts.push({ text: text.slice(plain), match: false });
  return parts;
}
