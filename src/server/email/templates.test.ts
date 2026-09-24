import { describe, expect, it } from "vitest";
import { memorySender } from "./sender";
import {
  existingAccountEmail,
  invitationEmail,
  resetPasswordEmail,
  verificationEmail,
} from "./templates";

const url = "http://localhost:3000/verify?token=abc";

describe("templates", () => {
  it("always carry a text part beside the html", () => {
    const messages = [
      verificationEmail({ to: "a@example.com", name: "Ana", url }),
      resetPasswordEmail({ to: "a@example.com", name: "Ana", url }),
      existingAccountEmail({ to: "a@example.com", url }),
      invitationEmail({
        to: "a@example.com",
        workspaceName: "Planora",
        invitedByName: "Henrique",
        url,
      }),
    ];

    for (const message of messages) {
      expect(message.text.length).toBeGreaterThan(0);
      expect(message.text).toContain(url);
      expect(message.html).toContain(url);
      expect(message.subject.length).toBeGreaterThan(0);
    }
  });

  it("speak pt-BR, because the interface does", () => {
    expect(verificationEmail({ to: "a@example.com", name: "Ana", url }).subject).toBe(
      "Confirme seu e-mail no Planora",
    );
    expect(
      invitationEmail({
        to: "a@example.com",
        workspaceName: "Obra",
        invitedByName: "Henrique",
        url,
      }).subject,
    ).toBe("Henrique convidou você para Obra");
    expect(existingAccountEmail({ to: "a@example.com", url }).subject).toBe(
      "Este e-mail já tem uma conta no Planora",
    );
  });

  it("escape a name rather than trusting it as markup", () => {
    const message = verificationEmail({
      to: "a@example.com",
      name: '<img src=x onerror="alert(1)">',
      url,
    });

    expect(message.html).not.toContain("<img");
    expect(message.html).toContain("&lt;img");
  });
});

describe("the memory sender", () => {
  it("keeps what it was asked to send", async () => {
    const sender = memorySender();
    await sender.send(verificationEmail({ to: "a@example.com", name: "Ana", url }));

    expect(sender.outbox).toHaveLength(1);
    expect(sender.outbox[0]?.to).toBe("a@example.com");
  });
});
