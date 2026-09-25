import { test, expect } from "./support/test";
import {
  PASSWORD as ACCOUNT_PASSWORD,
  messagesTo,
  registerAndVerify,
  signIn,
  submitRegistration,
  uniqueEmail,
  waitForResetLink,
  waitForVerificationLink,
} from "./support/account";

/**
 * The Phase 3 criterion, end to end: an account is created, the verification
 * message arrives in the local inbox, the link works, and the person lands in a
 * workspace that already exists.
 */

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

  // The link confirms nothing on its own (ADR 0007): it lands on the login
  // form with the address filled in, and signing in there with the password
  // chosen at sign-up is what confirms it. A mail scanner that follows the
  // link first confirms nothing and takes no session.
  await expect(page).toHaveURL(/\/login\?confirmar=[^&]+$/);
  await expect(page.getByRole("status")).toContainText("para confirmar seu e-mail");
  await expect(page.getByLabel("E-mail")).toHaveValue(email);

  await signIn(page, email, PASSWORD);
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

/**
 * The link with a password that is not the account's: perhaps the person
 * forgot it, perhaps somebody else signed up with their address first. The
 * way out is the same, and the form names it.
 */
test("a confirmation link with the wrong password points at a new one", async ({
  page,
  request,
}) => {
  const email = uniqueEmail();
  await submitRegistration(page, email, PASSWORD);
  await page.goto(await waitForVerificationLink(request, email));

  await signIn(page, email, "outra frase que nao e a dela");

  await expect(
    page.getByRole("alert").filter({ hasText: "Esqueci minha senha" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/login\?confirmar=/);
});

/** Signing in unconfirmed with the right password sends a fresh link. */
test("the login form sends a new link to an address not yet confirmed", async ({
  page,
  request,
}) => {
  const email = uniqueEmail();
  await submitRegistration(page, email, PASSWORD);
  await expect.poll(() => messagesTo(request, email)).toBe(1);

  await page.goto("/login");
  await signIn(page, email, PASSWORD);

  await expect(
    page.getByRole("alert").filter({ hasText: "ainda não foi confirmado" }),
  ).toBeVisible();
  await expect.poll(() => messagesTo(request, email)).toBe(2);
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
