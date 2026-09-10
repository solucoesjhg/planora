import { expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Signing up and verifying, through the interface and the local inbox. Shared
 * by the specs that need an account rather than duplicated in each of them.
 */

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:8025";
export const PASSWORD = "trilha molhada de barro";

export async function registerAndVerify(
  page: Page,
  request: APIRequestContext,
  email = `e2e-${Date.now()}@example.com`,
): Promise<string> {
  await page.goto("/register");
  await page.getByLabel("Nome").fill("Pessoa de Teste");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Criar conta" }).click();

  await expect(
    page.getByRole("heading", { name: "Confirme seu e-mail" }),
  ).toBeVisible();

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
