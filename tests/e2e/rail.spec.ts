import { test, expect } from "./support/test";
import { registerAndVerify } from "./support/account";

/**
 * The rail's "Quadro" entry: it opens a board, the rail says so, and it goes
 * back to the board the person was on rather than to whichever sorts first.
 */

test.describe("the rail's Quadro entry", () => {
  test.beforeEach(async ({ page, request }) => {
    await registerAndVerify(page, request);
  });

  test("opens the board, and the rail lights Quadro rather than Projetos", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await page.getByRole("link", { name: "Quadro" }).click();

    await page.waitForURL(/\/projects\/[^/]+$/);
    await expect(page.getByTestId("board-scroller")).toBeVisible();

    const current = page.locator('[data-testid="rail"] a[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveText("Quadro");
  });

  test("returns to the board opened last, not to the first project", async ({
    page,
  }) => {
    // A second project, which sorts after the example.
    await page.goto("/projects");
    await page.getByRole("button", { name: "Novo projeto" }).click();
    await page.getByLabel("Nome").fill("Segundo projeto");
    await page.getByLabel("Cliente").fill("Cliente de teste");
    await page.getByRole("button", { name: "Criar projeto" }).click();

    await page.getByRole("link", { name: /Segundo projeto/ }).click();
    await expect(page.getByTestId("board-scroller")).toBeVisible();
    const second = page.url();

    await page.goto("/dashboard");
    await page.getByRole("link", { name: "Quadro" }).click();
    await page.waitForURL(/\/projects\/[^/]+$/);

    expect(page.url()).toBe(second);
  });
  test("keeps the shell mounted across navigation, and Quadro links straight to the board", async ({
    page,
  }) => {
    // Visit the board once so the rail has a board to point at.
    await page.goto("/board");
    await page.waitForURL(/\/projects\/[^/]+$/);
    const board = page.url();

    await page.goto("/dashboard");
    const rail = page.getByTestId("rail");
    await rail.evaluate((node) => {
      (node as HTMLElement & { __tag?: string }).__tag = "same-node";
    });

    // No redirect hop: the link already names the board.
    await expect(page.getByRole("link", { name: "Quadro" })).toHaveAttribute(
      "href",
      new URL(board).pathname,
    );

    const documentLoads: number[] = [];
    page.on("load", () => documentLoads.push(Date.now()));

    await page.getByRole("link", { name: "Projetos" }).click();
    await page.waitForURL(/\/projects$/);
    await page.getByRole("link", { name: "Quadro" }).click();
    await page.waitForURL(/\/projects\/[^/]+$/);
    await expect(page.getByTestId("board-scroller")).toBeVisible();

    expect(page.url()).toBe(board);
    expect(documentLoads, "navigation must stay client-side").toHaveLength(0);
    expect(
      await rail.evaluate(
        (node) => (node as HTMLElement & { __tag?: string }).__tag === "same-node",
      ),
      "the rail must be the same DOM node after two navigations",
    ).toBe(true);
  });
});
