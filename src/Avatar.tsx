import { avatarInitial, avatarTone } from "./userAvatar";

interface Props {
  userId: string;
  name: string;
  avatarId: string | null | undefined;
  size?: "s" | "m" | "l";
}

/** 利用者のアイコン。画像が未設定なら頭文字を ID ごとの色で出す。名前は隣に書く前提なので読み上げない */
export function Avatar({ userId, name, avatarId, size = "s" }: Props) {
  if (avatarId) {
    return <img className={`avatar ${size}`} src={`/api/avatars/${avatarId}`} alt="" aria-hidden="true" loading="lazy" decoding="async" />;
  }
  return (
    <span className={`avatar ${size} tone-${avatarTone(userId)}`} aria-hidden="true">
      {avatarInitial(name)}
    </span>
  );
}

/** アイコンと名前を並べた表示 */
export function Byline({ userId, name, avatarId, children }: Omit<Props, "size"> & { children?: React.ReactNode }) {
  return (
    <span className="byline">
      <Avatar userId={userId} name={name} avatarId={avatarId} />
      <span>{children ?? name}</span>
    </span>
  );
}
