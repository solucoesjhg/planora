import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Signing up and verifying, through the interface and the local inbox. Shared
 * by the specs that need an account rather than duplicated in each of them.
 */

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:8025";
export const PASSWORD = "trilha molhada de barro";

/**
 * Two workers starting in the same millisecond used to be handed the same
 * address — and so the same account, the same workspace, and each other's
 * board. A random token per account keeps the suites apart.
 */
export function uniqueEmail(prefix = "e2e"): string {
  return `${prefix}-${randomUUID()}@example.com`;
}

/** The form on /register, wherever the page arrived at it. */
export async function fillRegistration(
  page: Page,
  email: string,
  options: { name?: string; password?: string } = {},
): Promise<void> {
  await page.getByLabel("Nome").fill(options.name ?? "Pessoa de Teste");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(options.password ?? PASSWORD);
  await page.getByRole("button", { name: "Criar conta" }).click();

  await expect(
    page.getByRole("heading", { name: "Confirme seu e-mail" }),
  ).toBeVisible();
}

/**
 * Each worker arrives from its own address (support/test.ts), so the sign-up
 * limit — five a minute per address — is never shared between them.
 */
export async function submitRegistration(
  page: Page,
  email: string,
  password = PASSWORD,
): Promise<void> {
  await page.goto("/register");
  await fillRegistration(page, email, { password });
}

export async function registerAndVerify(
  page: Page,
  request: APIRequestContext,
  email = uniqueEmail(),
): Promise<string> {
  await submitRegistration(page, email);
  await page.goto(await waitForVerificationLink(request, email));
  return email;
}

type MailpitList = {
  messages: { ID: string; To: { Address: string }[] }[];
};

export async function waitForVerificationLink(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  return waitForLink(request, email, /https?:\/\/[^\s"<>]+verify-email[^\s"<>]*/);
}

/** The invitation link, from the same local inbox. */
export async function waitForInvitationLink(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  return waitForLink(request, email, /https?:\/\/[^\s"<>]+\/invitations\/[^\s"<>]*/);
}

/** How many messages the local inbox holds for an address. */
export async function messagesTo(
  request: APIRequestContext,
  email: string,
): Promise<number> {
  const found = await request.get(
    `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=50`,
  );
  if (!found.ok()) return 0;

  const { messages } = (await found.json()) as MailpitList;
  return messages.filter((message) =>
    message.To.some((recipient) => recipient.Address === email),
  ).length;
}

async function waitForLink(
  request: APIRequestContext,
  email: string,
  pattern: RegExp,
): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const list = await request.get(`${MAILPIT}/api/v1/messages?limit=50`);
    if (list.ok()) {
      const { messages } = (await list.json()) as MailpitList;
      const match = messages.find((message) =>
        message.To.some((recipient) => recipient.Address === email),
      );

      if (match) {
        const detail = await request.get(`${MAILPIT}/api/v1/message/${match.ID}`);
        const body = (await detail.json()) as { Text?: string; HTML?: string };
        const url = (body.Text ?? body.HTML ?? "").match(pattern)?.[0];

        if (url) return url.replaceAll("&amp;", "&");
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`no message matching ${pattern} arrived for ${email}`);
}
