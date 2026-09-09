import { expect, test } from "@playwright/test";

/**
 * The Phase 3 criterion, end to end: an account is created, the verification
 * message arrives in the local inbox, the link works, and the person lands in a
 * workspace that already exists.
 */

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:8025";
const PASSWORD = "uma-senha-bem-longa";

test("signing up leads to a verified account with a workspace", async ({
  page,
  request,
}) => {
  const email = `e2e-${Date.now()}@example.com`;

  await page.goto("/register");
  await page.getByLabel("Nome").fill("Pessoa de Teste");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Criar conta" }).click();

  await expect(page.getByRole("heading", { name: "Confirme seu e-mail" })).toBeVisible();

  const verificationUrl = await waitForVerificationLink(request, email);
  await page.goto(verificationUrl);

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Painel" })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText("owner")).toBeVisible();
});

test("the proxy sends a visitor to the login page", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
});

type MailpitList = {
  messages: { ID: string; To: { Address: string }[] }[];
};

async function waitForVerificationLink(
  request: import("@playwright/test").APIRequestContext,
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
