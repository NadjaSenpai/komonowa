/** 操作の失敗を知らせる。message が空のときは何も出さない */
export function ErrorAlert({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p className="error" role="alert">
      {message}
    </p>
  );
}
