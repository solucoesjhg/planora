import { test, expect } from "./support/test";
import { registerAndVerify } from "./support/account";
import { columnOf, columnWithPhase, drag, openExampleBoard } from "./support/board";
import { activityCount, pendingEventCount } from "./support/database";

/**
 * The Phase 6 criterion: a refused drag bounces **without touching the
 * network**, and an allowed one persists.
 */

test.describe("the board", () => {
  test.beforeEach(async ({ page, request }) => {
    await registerAndVerify(page, request);
    await openExampleBoard(page);
  });

  test("a blocked card bounces, and no request is made", async ({ page }) => {
    const blocked = page.getByTestId("task-card").filter({ hasText: "Pintura" });
    const columnBefore = await columnOf(page, "Pintura");

    // Everything the page sends from here on, counted.
    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") posts.push(request.url());
    });

    await drag(page, blocked, page.locator('[data-column-phase="done"]'));

    await expect(page.getByText("Tarefa bloqueada")).toBeVisible();
    expect(posts, "a refused drag must not reach the server").toHaveLength(0);
    expect(await columnOf(page, "Pintura")).toBe(columnBefore);
  });

  test("a card waiting on a dependency bounces too, with its own reason", async ({
    page,
  }) => {
    const waiting = page.getByTestId("task-card").filter({ hasText: "Conferir" });

    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") posts.push(request.url());
    });

    await drag(page, waiting, page.locator('[data-column-phase="done"]'));

    await expect(page.getByText("Depende de outra tarefa")).toBeVisible();
    expect(posts).toHaveLength(0);
  });

  test("an allowed move persists across a reload", async ({ page }) => {
    const card = page.getByTestId("task-card").filter({ hasText: "limpeza" });
    expect(await columnOf(page, "limpeza")).toBe("planning");

    // The optimistic card arrives before the write does; reloading on the
    // strength of it would only prove the board can lie for a moment.
    const written = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/projects/") &&
        response.status() < 400,
    );

    await drag(page, card, page.locator('[data-column-phase="review"]'));

    await expect(async () => {
      expect(await columnOf(page, "limpeza")).toBe("review");
    }).toPass();
    await written;

    await page.reload();
    await expect(page.getByTestId("board-scroller")).toBeVisible();
    expect(await columnOf(page, "limpeza")).toBe("review");
  });

  test("a new column declares its phase and can be removed while empty", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Nova coluna" }).click();
    await page.getByLabel("Nome").fill("Homologação");
    await page.getByRole("button", { name: "Criar coluna" }).click();

    const created = page
      .getByTestId("board-column")
      .filter({ hasText: "Homologação" });
    await expect(created).toBeVisible();

    await created.getByRole("button", { name: /Opções da coluna/ }).click();
    await page.getByRole("button", { name: "Apagar" }).click();

    await expect(created).toHaveCount(0);
  });

  /**
   * The outbox is only worth having if something reads it. Nothing did: events
   * piled up unprocessed and the activity feed had no rows at all, which the
   * dashboard in Phase 8 is built to render. The move above is what fills it.
   */
  test("a move reaches the activity feed", async ({ page }) => {
    const before = await activityCount();

    const card = page.getByTestId("task-card").filter({ hasText: "limpeza" });
    await drag(page, card, columnWithPhase(page, "review"));
    await expect(async () => {
      expect(await columnOf(page, "limpeza")).toBe("review");
    }).toPass();

    await expect(async () => {
      expect(await activityCount()).toBeGreaterThan(before);
      expect(await pendingEventCount()).toBe(0);
    }).toPass();
  });
});
