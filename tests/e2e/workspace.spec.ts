import { test, expect } from "./support/test";
import {
  registerAndVerify,
  uniqueEmail,
  waitForInvitationLink,
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
