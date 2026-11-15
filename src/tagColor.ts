/**
 * タグの名前から決まる色相（0〜359）。同じタグはいつも同じ色になる。
 * タグの重複判定と同じく、全角半角・大文字小文字の違いは同じ名前とみなす。
 * 明るさと鮮やかさは CSS 側でそろえるので（styles.css の --tag-hue）、どの色相でも同じ落ち着いた調子になる
 */
export function tagHue(name: string): number {
  const key = name.trim().normalize("NFKC").toLowerCase();
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 360;
}
