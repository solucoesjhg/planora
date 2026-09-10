import { expect, type Locator, type Page } from "@playwright/test";

/** Driving the board from a test: opening a project, and moving a card. */

export async function openExampleBoard(page: Page): Promise<void> {
  await page.goto("/projects");
  await page.getByRole("link", { name: /Exemplo/ }).click();
  await expect(page.getByTestId("board-scroller")).toBeVisible();
}

/** Which phase's column a card sits in, by its title. */
export async function columnOf(page: Page, title: string): Promise<string | null> {
  return page
    .getByTestId("board-column")
    .filter({ has: page.getByTestId("task-card").filter({ hasText: title }) })
    .first()
    .getAttribute("data-column-phase");
}

export function columnWithPhase(page: Page, phase: string): Locator {
  return page.locator(`[data-column-phase="${phase}"]`);
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
export async function drag(page: Page, card: Locator, target: Locator): Promise<void> {
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
