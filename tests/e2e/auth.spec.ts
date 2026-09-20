import { test, expect } from "./support/test";
import {
  PASSWORD as ACCOUNT_PASSWORD,
  messagesTo,
  registerAndVerify,
  submitRegistration,
  uniqueEmail,
  waitForResetLink,
} from "./support/account";

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
  await expect(page.getByTestId("panel").getByText("Dono")).toBeVisible();

  await page.getByRole("button", { name: "Conta" }).click();
  await expect(page.getByText(email)).toBeVisible();
});

/**
 * Sign-up sends the verification message in the background and reports success
 * whatever became of it: on the first production deploy the screen said
 * "Confirme seu e-mail" and Resend had refused the address. The button repeats
 * the send through the endpoint that waits for it and answers.
 */
test("the confirmation screen can send the message again", async ({
  page,
  request,
}) => {
  const email = uniqueEmail();
  await submitRegistration(page, email, PASSWORD);
  await expect(page.getByText(email)).toBeVisible();

  await page.getByRole("button", { name: "Reenviar e-mail" }).click();
  await expect(page.getByRole("button", { name: "Enviado de novo" })).toBeVisible();

  await expect(async () => {
    expect(await messagesTo(request, email)).toBe(2);
  }).toPass();
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

/**
 * Recovery, end to end: the link under the login form, the message in the
 * local inbox, a new password, and the old one refused at the door. The link
 * is single-use, so opening it again lands on the "não vale mais" screen.
 */
test("a forgotten password is replaced through the link in the inbox", async ({
  page,
  request,
}) => {
  const email = await registerAndVerify(page, request);
  await page.context().clearCookies();

  await page.goto("/login");
  await page.getByRole("link", { name: "Esqueci minha senha" }).click();
  await expect(page.getByRole("heading", { name: "Recuperar senha" })).toBeVisible();

  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Enviar link" }).click();
  await expect(page.getByRole("heading", { name: "Veja seu e-mail" })).toBeVisible();

  const link = await waitForResetLink(request, email);
  await page.goto(link);
  await expect(page).toHaveURL(/\/reset-password\?token=/);
  await expect(page.getByRole("heading", { name: "Nova senha" })).toBeVisible();

  const replacement = "outra trilha, agora seca";
  await page.getByLabel("Nova senha").fill(replacement);
  await page.getByRole("button", { name: "Salvar nova senha" }).click();
  await expect(page.getByRole("heading", { name: "Senha redefinida" })).toBeVisible();

  // The same link, again: consumed.
  await page.goto(link);
  await expect(page).toHaveURL(/\/reset-password\?error=INVALID_TOKEN/);
  await expect(page.getByRole("heading", { name: "Este link não vale mais" })).toBeVisible();

  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(ACCOUNT_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("alert")).toBeVisible();

  await page.getByLabel("Senha").fill(replacement);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

/**
 * Leaving. "Sair" in the account menu ends the session on the server and
 * lands on the login page; the cookie is gone, so the next protected URL is
 * refused by the proxy rather than answered from a session that no longer
 * exists.
 */
test("signing out ends the session and leads to the login page", async ({
  page,
  request,
}) => {
  const email = await registerAndVerify(page, request);
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole("button", { name: "Conta" }).click();
  await expect(page.getByText(email)).toBeVisible();
  await page.getByRole("button", { name: "Sair" }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
});
