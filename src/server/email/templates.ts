/**
 * Email templates, versioned with the code that sends them.
 *
 * The interface is pt-BR (plan, Appendix B); the code around it is English.
 * Every template returns subject, html and text — a message with no text part
 * is a message some clients render as an empty box.
 */

import type { EmailMessage } from "./sender";

const PRODUCT = "Planora";

export type VerificationEmail = {
  readonly to: string;
  readonly name: string;
  readonly url: string;
};

export function verificationEmail({
  to,
  name,
  url,
}: VerificationEmail): EmailMessage {
  const subject = `Confirme seu e-mail no ${PRODUCT}`;
  const body = [
    `Olá, ${name}.`,
    `Confirme seu endereço para ativar sua conta no ${PRODUCT}.`,
  ];

  return {
    to,
    subject,
    text: [...body, url, "Se não foi você, ignore esta mensagem."].join("\n\n"),
    html: layout(subject, body, { label: "Confirmar e-mail", url }),
  };
}

export type ResetPasswordEmail = {
  readonly to: string;
  readonly name: string;
  readonly url: string;
};

export function resetPasswordEmail({
  to,
  name,
  url,
}: ResetPasswordEmail): EmailMessage {
  const subject = `Redefinir sua senha no ${PRODUCT}`;
  const body = [
    `Olá, ${name}.`,
    "Recebemos um pedido para redefinir sua senha. O link vale por uma hora.",
  ];

  return {
    to,
    subject,
    text: [...body, url, "Se não foi você, ignore esta mensagem."].join("\n\n"),
    html: layout(subject, body, { label: "Redefinir senha", url }),
  };
}

export type InvitationEmail = {
  readonly to: string;
  readonly workspaceName: string;
  readonly invitedByName: string;
  readonly url: string;
};

export function invitationEmail({
  to,
  workspaceName,
  invitedByName,
  url,
}: InvitationEmail): EmailMessage {
  const subject = `${invitedByName} convidou você para ${workspaceName}`;
  const body = [
    `${invitedByName} convidou você para o espaço de trabalho ${workspaceName} no ${PRODUCT}.`,
    "O convite vale por sete dias.",
  ];

  return {
    to,
    subject,
    text: [...body, url].join("\n\n"),
    html: layout(subject, body, { label: "Aceitar convite", url }),
  };
}

/* ------------------------------------------------------------------ *
 * Notifications (§7 Phase 9)
 * ------------------------------------------------------------------ */

export type NotificationEmail = {
  readonly to: string;
  readonly title: string;
  readonly body: string;
  readonly url: string;
};

export function notificationEmail({ to, title, body, url }: NotificationEmail): EmailMessage {
  return {
    to,
    subject: title,
    text: [body, url].join("\n\n"),
    html: layout(title, [body], { label: "Abrir no Planora", url }),
  };
}

export type DigestEmail = {
  readonly to: string;
  readonly name: string;
  readonly cadence: "daily" | "weekly";
  readonly items: readonly { title: string; body: string; url: string }[];
  readonly inboxUrl: string;
};

export function digestEmail({ to, name, cadence, items, inboxUrl }: DigestEmail): EmailMessage {
  const period = cadence === "weekly" ? "da semana" : "do dia";
  const subject = `${items.length} ${items.length === 1 ? "aviso" : "avisos"} ${period} no ${PRODUCT}`;
  const lines = items.map((item) => `${item.title} — ${item.body}`);
  const paragraphs = [`${name}, aqui está o que ficou sem ler:`, ...lines];

  return {
    to,
    subject,
    text: [...paragraphs, inboxUrl].join("\n\n"),
    html: layout(subject, paragraphs, { label: "Abrir a caixa de entrada", url: inboxUrl }),
  };
}

function layout(
  title: string,
  paragraphs: readonly string[],
  action: { label: string; url: string },
): string {
  const body = paragraphs
    .map((paragraph) => `<p style="margin:0 0 16px">${escapeHtml(paragraph)}</p>`)
    .join("\n");

  return [
    `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#171B18;max-width:520px">`,
    `<h1 style="font-size:20px;margin:0 0 20px">${escapeHtml(title)}</h1>`,
    body,
    `<p style="margin:24px 0"><a href="${escapeAttribute(action.url)}" style="background:#A85C3A;color:#FFF;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">${escapeHtml(action.label)}</a></p>`,
    `<p style="margin:0;color:#767D74;font-size:13px">Se o botão não funcionar, copie e cole este endereço no navegador:<br>${escapeHtml(action.url)}</p>`,
    `</div>`,
  ].join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', "&quot;");
}
