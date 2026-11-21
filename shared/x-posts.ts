/** 投稿URLだけを受け付け、クエリ文字列とフラグメントは取得先に送らない。 */
export function xPostUrl(value: string): string | null {
  const match = /^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/((?:[a-z0-9_]{1,15}|i\/web)\/status\/[0-9]{1,20})\/?(?:[?#].*)?$/i.exec(value);
  return match ? `https://x.com/${match[1]}` : null;
}
