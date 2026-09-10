import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { clearRateLimits } from "./rate-limits";

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

/**
 * Fills the form and submits it, standing up to the limiter.
 *
 * Sign-up allows five a minute per address, and every worker here shares
 * 127.0.0.1 — so a parallel run trips a rule that is doing its job. Clearing
 * the counter beforehand is not enough: the other workers spend it between
 * that and the click. The suite retries instead of the product relaxing.
 */
export async function submitRegistration(
  page: Page,
  email: string,
  password = PASSWORD,
): Promise<void> {
  await page.goto("/register");
  await page.getByLabel("Nome").fill("Pessoa de Teste");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);

  const confirmation = page.getByRole("heading", { name: "Confirme seu e-mail" });
  const limited = page.getByText("Muitas tentativas seguidas");

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await clearRateLimits();
    await page.getByRole("button", { name: "Criar conta" }).click();
    await expect(confirmation.or(limited).first()).toBeVisible();
    if (await confirmation.isVisible()) return;
  }

  await expect(confirmation).toBeVisible();
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
        const url = (body.Text ?? body.HTML ?? "").match(
          /https?:\/\/[^\s"<>]+verify-email[^\s"<>]*/,
        )?.[0];

        if (url) return url.replaceAll("&amp;", "&");
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`no verification message arrived for ${email}`);
}
