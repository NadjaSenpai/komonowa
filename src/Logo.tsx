/** favicon とサイト名を組み合わせたロゴ */
export function Logo() {
  return (
    <span className="logo">
      <img src="/favicon.svg?v=3" width={18} height={18} alt="" />
      <span>
        k<span className="logo-o">o</span>monowa
      </span>
    </span>
  );
}
