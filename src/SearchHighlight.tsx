import { highlightParts } from "../shared/searchExcerpt";
export function SearchHighlight({ text, query }: { text: string; query: string }) {
  let offset = 0;
  return (
    <>
      {highlightParts(text, query).map((p) => {
        const key = offset;
        offset += p.text.length;
        return p.match ? <mark key={key}>{p.text}</mark> : p.text;
      })}
    </>
  );
}
