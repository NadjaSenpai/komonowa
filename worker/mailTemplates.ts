import type { Mail } from "./mail";

/**
 * 招待・パスワード再設定のメール。HTML と文字だけの本文を両方付ける（HTML を表示しないメールソフトもあるため）。
 * HTML はメールソフト向けに表組み＋インラインスタイルで書き、画像や外部フォントは使わない。色はサイトと同じ（src/tokens.css）
 */

const COLOR = {
  paper: "#f6f5f0",
  card: "#fffefa",
  ink: "#29342f",
  muted: "#616e65",
  rule: "#d9dfd5",
  accent: "#365d4e",
  accentInk: "#fffefa",
};
const FONT = `-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif`;

/** メールに書く日時（チームは日本にいる前提で日本時間） */
export function formatJst(ms: number): string {
  return new Date(ms).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short" }) + "（日本時間）";
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

interface Action {
  button: string;
  url: string;
  expiresAt: number;
}

interface Content {
  /** 見出し（例：「komonowa」に招待されました） */
  title: string;
  /** 見出しの下の段落（文字のまま。HTML では escape する） */
  lead: string[];
  /** 押してもらうリンク。お知らせだけのメールでは付けない */
  action?: Action;
  /** いちばん下の注意書き */
  note: string;
}

function expiry(ms: number): string {
  return `有効期限：${formatJst(ms)}まで。リンクは一度だけ使えます。`;
}

function renderText(c: Content): string {
  const action = c.action ? ["", c.action.url, "", expiry(c.action.expiresAt)] : [];
  return [...c.lead, ...action, "", c.note, "", "— komonowa"].join("\n");
}

function renderAction(a: Action): string {
  const url = escapeHtml(a.url);
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0;"><tr>
<td style="border-radius:8px;background:${COLOR.accent};"><a href="${url}" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:bold;color:${COLOR.accentInk};text-decoration:none;border-radius:8px;">${escapeHtml(a.button)}</a></td>
</tr></table>
<p style="margin:0 0 8px;font-size:13px;color:${COLOR.muted};">${escapeHtml(expiry(a.expiresAt))}</p>
<p style="margin:0 0 4px;font-size:13px;color:${COLOR.muted};">ボタンが使えないときは、次の URL をブラウザで開いてください。</p>
<p style="margin:0;font-size:13px;word-break:break-all;"><a href="${url}" style="color:${COLOR.accent};">${url}</a></p>`;
}

function renderHtml(c: Content): string {
  const lead = c.lead
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.8;color:${COLOR.ink};">${escapeHtml(p)}</p>`)
    .join("");
  return `<!doctype html>
<html lang="ja">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(c.title)}</title></head>
<body style="margin:0;padding:0;background:${COLOR.paper};">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${COLOR.paper};font-family:${escapeHtml(FONT)};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;">
<tr><td style="padding:0 4px 16px;font-size:20px;font-weight:bold;letter-spacing:0.02em;color:${COLOR.accent};">komonowa</td></tr>
<tr><td style="background:${COLOR.card};border:1px solid ${COLOR.rule};border-radius:12px;padding:32px 28px;">
<h1 style="margin:0 0 20px;font-size:20px;line-height:1.5;color:${COLOR.ink};">${escapeHtml(c.title)}</h1>
${lead}
${c.action ? renderAction(c.action) : ""}
</td></tr>
<tr><td style="padding:16px 4px 0;font-size:12px;line-height:1.7;color:${COLOR.muted};">${escapeHtml(c.note)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function build(to: string, subject: string, c: Content): Mail {
  return { to, subject, text: renderText(c), html: renderHtml(c) };
}

export function inviteMail(p: { to: string; inviter: string; role: string; url: string; expiresAt: number }): Mail {
  const title = "「komonowa」に招待されました";
  return build(p.to, title, {
    title,
    lead: [
      `${p.inviter} さんから「komonowa」に${p.role === "admin" ? "管理者" : "メンバー"}として招待されました。`,
      "リンクを開いて表示名とパスワードを決めると、登録できます。",
    ],
    action: { button: "登録する", url: p.url, expiresAt: p.expiresAt },
    note: "心当たりがなければ、このメールは無視してください。",
  });
}

export function resetMail(p: { to: string; sender: string; url: string; expiresAt: number }): Mail {
  const title = "「komonowa」のパスワード再設定";
  return build(p.to, title, {
    title,
    lead: [`${p.sender} さんが、パスワード再設定のリンクを送りました。`, "リンクを開いて、新しいパスワードを決めてください。"],
    action: { button: "パスワードを再設定する", url: p.url, expiresAt: p.expiresAt },
    note: "心当たりがなければ、このメールは無視してください。今のパスワードはそのまま使えます。",
  });
}

export function emailChangeMail(p: { to: string; url: string; expiresAt: number }): Mail {
  const title = "「komonowa」メールアドレスの確認";
  return build(p.to, title, {
    title,
    lead: ["「komonowa」のメールアドレスを、このアドレスに変更する申し込みがありました。", "リンクを開くと変更されます。"],
    action: { button: "メールアドレスを確認する", url: p.url, expiresAt: p.expiresAt },
    note: "心当たりがなければ、このメールは無視してください。メールアドレスは変更されません。",
  });
}

/** 変更前のアドレスへのお知らせ。乗っ取られたときに気づけるように送る */
export function emailChangedNotice(p: { to: string; newEmail: string }): Mail {
  const title = "「komonowa」のメールアドレスが変更されました";
  return build(p.to, title, {
    title,
    lead: [`「komonowa」のメールアドレスが ${p.newEmail} に変更されました。`, "今後のお知らせは新しいアドレスに届き、このアドレスではログインできません。"],
    note: "身に覚えがなければ、管理者に連絡してください。",
  });
}
