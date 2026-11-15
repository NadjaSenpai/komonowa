/** サイト名のロゴ。最初の「o」だけ色を変える（styles.css の .logo-o） */
export function Logo() {
  return (
    <span className="logo">
      k<span className="logo-o">o</span>monowa
    </span>
  );
}
