import { test, expect } from "./support/test";
import {
  fillRegistration,
  registerAndVerify,
  uniqueEmail,
  waitForInvitationLink,
  waitForVerificationLink,
} from "./support/account";

/**
 * The rail's destinations, and the invitation flow that Phase 3 built with no
 * way to reach it.
 */

const DESTINATIONS = [
  { link: "Painel", heading: "Painel" },
  { link: "Projetos", heading: "Projetos" },
  { link: "Arquivos", heading: "Arquivos" },
  { link: "Usuários", heading: "Usuários" },
  { link: "Assistente", heading: "Assistente" },
  { link: "Configurações", heading: "Configurações" },
];

test.describe("the workspace", () => {
  test.beforeEach(async ({ page, request }) => {
    await registerAndVerify(page, request);
  });

  test("every destination in the rail opens something", async ({ page }) => {
    await page.goto("/dashboard");

    for (const { link, heading } of DESTINATIONS) {
      await page.getByRole("link", { name: link, exact: true }).click();
      // Four of these used to answer with the framework's 404.
      await expect(
        page.getByRole("heading", { name: heading, level: 1 }),
      ).toBeVisible();
    }
  });

  test("an invitation reaches the inbox and names the workspace", async ({
    page,
    request,
  }) => {
    const guest = uniqueEmail("convidado");

    await page.goto("/users");
    await expect(page.getByRole("heading", { name: "Usuários" })).toBeVisible();
    // The person who just signed up is alone in their own workspace.
    await expect(page.getByText("· você")).toBeVisible();

    await page.getByLabel("E-mail").fill(guest);
    await page.getByRole("button", { name: "Convidar" }).click();

    await expect(page.getByText("Convite enviado")).toBeVisible();
    // The invitation is now listed as open — the toast says so too, so the
    // list is what gets asserted.
    await expect(
      page.getByTestId("centre").getByRole("listitem").filter({ hasText: guest }),
    ).toBeVisible();

    const link = await waitForInvitationLink(request, guest);
    expect(link).toContain("/invitations/");
  });

  /**
   * The flow Phase 3 promised and nothing walked: somebody with no account
   * follows an invitation. They are sent to sign in, sign up instead, verify —
   * and the verification link has to bring them back to the invitation, not to
   * an empty dashboard of their own with the token left behind in the email.
   */
  test("somebody without an account can follow an invitation all the way in", async ({
    page,
    request,
    browser,
  }) => {
    const guest = uniqueEmail("recem-chegada");

    await page.goto("/users");
    await page.getByLabel("E-mail").fill(guest);
    await page.getByRole("button", { name: "Convidar" }).click();
    await expect(page.getByText("Convite enviado")).toBeVisible();
    const invitation = await waitForInvitationLink(request, guest);

    // A browser of their own: no cookies, and an address of its own for the
    // rate limiter, like every worker.
    const theirs = await browser.newContext({
      extraHTTPHeaders: { "x-forwarded-for": "10.250.0.1" },
    });
    const their = await theirs.newPage();

    await their.goto(invitation);
    await expect(their).toHaveURL(/\/login\?next=/);
    await their.getByRole("link", { name: "Criar conta" }).click();
    await expect(their).toHaveURL(/\/register\?next=/);

    await fillRegistration(their, guest, { name: "Recém-chegada" });
    await their.goto(await waitForVerificationLink(request, guest));

    // Verified, signed in, and back at the invitation — not on a dashboard.
    await expect(their).toHaveURL(/\/invitations\//);
    await their.getByRole("button", { name: "Entrar no espaço" }).click();
    await expect(their).toHaveURL(/\/dashboard/);

    // The workspace they joined is the one they are looking at: two members,
    // and they are one of them.
    await their.goto("/users");
    const members = their.getByTestId("centre").getByRole("listitem");
    await expect(members).toHaveCount(2);
    await expect(members.filter({ hasText: "Recém-chegada" })).toContainText("· você");

    await theirs.close();
  });

  test("a page that does not exist gets the product's own answer", async ({
    page,
  }) => {
    const response = await page.goto("/projects/nao-existe-mesmo");
    expect(response?.status()).toBe(404);

    await expect(
      page.getByRole("heading", { name: /Não encontramos esta página/ }),
    ).toBeVisible();
  });
});
