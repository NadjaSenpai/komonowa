import { describe, expect, it } from "vitest";
import { inviteMail, resetMail } from "../worker/mailTemplates";

const EXPIRES = Date.UTC(2026, 10, 17, 3, 0); // 2026/11/17 12:00 日本時間

describe("招待メール", () => {
  const mail = inviteMail({ to: "new@example.com", inviter: "管理者", role: "member", url: "https://wiki.example.com/invite#tok", expiresAt: EXPIRES });

  it("件名と、文字だけの本文", () => {
    expect(mail.to).toBe("new@example.com");
    expect(mail.subject).toBe("「komonowa」に招待されました");
    expect(mail.text).toContain("管理者 さんから「komonowa」にメンバーとして招待されました。");
    expect(mail.text).toContain("https://wiki.example.com/invite#tok");
    expect(mail.text).toContain("2026/11/17 12:00");
    expect(mail.text).not.toContain("チームWiki");
  });

  it("HTML の本文にはリンクのボタンと、ボタンが使えないとき用の URL がある", () => {
    expect(mail.html).toContain('href="https://wiki.example.com/invite#tok"');
    expect(mail.html).toContain(">登録する<");
    expect(mail.html).toContain(">https://wiki.example.com/invite#tok<");
    expect(mail.html).toContain("2026/11/17 12:00");
  });

  it("名前に含まれる HTML はそのまま文字として出す", () => {
    const evil = inviteMail({ to: "a@example.com", inviter: '<img src=x onerror="alert(1)">&', role: "admin", url: "https://x/invite#t", expiresAt: EXPIRES });
    expect(evil.html).not.toContain("<img");
    expect(evil.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;");
    expect(evil.text).toContain("管理者として");
  });
});

describe("再設定メール", () => {
  const mail = resetMail({ to: "m@example.com", sender: "管理者", url: "https://wiki.example.com/reset#tok", expiresAt: EXPIRES });

  it("件名と本文", () => {
    expect(mail.subject).toBe("「komonowa」のパスワード再設定");
    expect(mail.text).toContain("https://wiki.example.com/reset#tok");
    expect(mail.text).toContain("今のパスワードはそのまま使えます");
    expect(mail.html).toContain('href="https://wiki.example.com/reset#tok"');
    expect(mail.html).toContain(">パスワードを再設定する<");
  });
});
