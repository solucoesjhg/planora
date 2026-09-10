import { expect, test } from "@playwright/test";
import { submitRegistration, uniqueEmail } from "./support/account";

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
  const email = uniqueEmail();

  await submitRegistration(page, email, PASSWORD);
  await expect(
    page.getByRole("heading", { name: "Confirme seu e-mail" }),
  ).toBeVisible();

  const verificationUrl = await waitForVerificationLink(request, email);
  await page.goto(verificationUrl);

  // Verification signs the person in, so the link lands where signed-in people
  // go — not on the marketing page.
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Painel" })).toBeVisible();

  // The workspace exists the moment the account does: the context panel says
  // which role, and the account menu says who.
  await expect(page.getByTestId("panel").getByText("owner")).toBeVisible();

  await page.getByRole("button", { name: "Conta" }).click();
  await expect(page.getByText(email)).toBeVisible();
});

test("the front door is the product's, not the framework's", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /O quadro que sabe/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Criar conta" })).toBeVisible();
  await expect(page.getByText("To get started, edit")).toHaveCount(0);
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
