import { expect, test, type Locator, type Page } from "@playwright/test";
import { registerAndVerify } from "./support/account";

/**
 * The Phase 6 criterion: a refused drag bounces **without touching the
 * network**, and an allowed one persists.
 */

test.describe("the board", () => {
  test.beforeEach(async ({ page, request }) => {
    await registerAndVerify(page, request);
    await page.goto("/projects");
    await page.getByRole("link", { name: /Exemplo/ }).click();
    await expect(page.getByTestId("board-scroller")).toBeVisible();
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
});

/** Which phase's column a card sits in, by its title. */
async function columnOf(page: Page, title: string): Promise<string | null> {
  return page
    .getByTestId("board-column")
    .filter({ has: page.getByTestId("task-card").filter({ hasText: title }) })
    .first()
    .getAttribute("data-column-phase");
}

/**
 * dnd-kit listens to pointer events and needs movement in steps: a single jump
 * from source to target is not a drag as far as it is concerned.
 *
 * The board is wider than the strip it lives in, and `boundingBox` reports
 * layout, not what is on screen — a column further right than the strip has a
 * box the pointer can never reach. So the destination is scrolled into view
 * with the card already held, and only then measured.
 */
async function drag(page: Page, card: Locator, target: Locator): Promise<void> {
  await card.scrollIntoViewIfNeeded();
  const from = await card.boundingBox();
  if (!from) throw new Error("could not measure the card");

  const grip = { x: from.x + from.width / 2, y: from.y + 20 };
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  // Past the sensor's activation distance, so the drag actually starts.
  await page.mouse.move(grip.x + 24, grip.y + 12, { steps: 4 });

  await target.scrollIntoViewIfNeeded();
  // One move after the scroll: dnd-kit re-reads the rects on pointer movement.
  await page.mouse.move(grip.x + 26, grip.y + 14, { steps: 2 });

  const to = await target.boundingBox();
  if (!to) throw new Error("could not measure the column");
  const drop = { x: to.x + to.width / 2, y: to.y + 110 };
  await page.mouse.move(drop.x, drop.y, { steps: 10 });
  await page.mouse.move(drop.x, drop.y + 2, { steps: 2 });

  await page.mouse.up();
}
