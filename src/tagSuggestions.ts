import type { Tag } from "./api";
import { matchKey } from "./completion";

export function parseTagInput(value: string): string[] {
  const unique = new Map<string, string>();
  for (const raw of value.split(/[,、\s]+/)) {
    const tag = raw.replace(/^#/, "").trim().normalize("NFKC");
    if (tag && !unique.has(matchKey(tag))) unique.set(matchKey(tag), tag);
  }
  return [...unique.values()];
}

export function suggestTags(tags: Tag[], query: string, selected: string[]): Tag[] {
  const chosen = new Set(selected.map(matchKey));
  const key = matchKey(query.replace(/^#/, "").trim());
  return tags
    .filter((t) => t.count > 0 && !chosen.has(matchKey(t.name)) && matchKey(t.name).includes(key))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ja"))
    .slice(0, 8);
}
