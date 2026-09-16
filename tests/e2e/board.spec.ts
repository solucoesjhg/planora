import { devices } from "@playwright/test";
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

    await expect(page.getByText("Tarefa travada")).toBeVisible();
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
    // The move's own write: a Server Action posts to the page it was called
    // from, so the board's URL, exactly — a save the modal left in flight posts
    // to the task's URL and must not count.
    const boardUrl = page.url();
    const written = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url() === boardUrl &&
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
  test("resting the pointer at an edge scrolls the strip that way", async ({
    page,
  }) => {
    const strip = page.getByTestId("board-scroller");
    const box = await strip.boundingBox();
    if (!box) throw new Error("could not measure the strip");

    const scrollLeft = () => strip.evaluate((element) => element.scrollLeft);
    expect(
      await strip.evaluate((element) => element.scrollWidth > element.clientWidth),
      "the example board must be wider than the strip at this viewport",
    ).toBe(true);
    expect(await scrollLeft()).toBe(0);

    const middle = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, middle);
    await page.mouse.move(box.x + box.width - 8, middle, { steps: 5 });
    await expect.poll(scrollLeft).toBeGreaterThan(40);

    await page.mouse.move(box.x + 8, middle, { steps: 5 });
    await expect.poll(scrollLeft).toBe(0);

    // Away from the edges, nothing moves on its own.
    await page.mouse.move(box.x + box.width / 2, middle, { steps: 5 });
    const rested = await scrollLeft();
    await page.waitForTimeout(300);
    expect(await scrollLeft()).toBe(rested);
  });
  test("Nova tarefa sits above the first card, outside the strip that scrolls", async ({
    page,
  }) => {
    const column = columnWithPhase(page, "execution");
    const button = column.getByRole("button", { name: "Nova tarefa" });
    const firstCard = column.getByTestId("task-card").first();

    const [buttonBox, cardBox] = await Promise.all([
      button.boundingBox(),
      firstCard.boundingBox(),
    ]);
    if (!buttonBox || !cardBox) throw new Error("could not measure the column");
    expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(cardBox.y);

    // Not inside the element that scrolls, so a long column cannot carry it away.
    expect(
      await button.evaluate((node) =>
        Boolean(node.closest(".overflow-y-auto")),
      ),
    ).toBe(false);
  });
});

/**
 * On a phone the feature does not exist: no drift at the edges, no edge
 * fades. Playwright's mobile emulation reports `hover: none`, which is what
 * the hook and the CSS both key on.
 */
test.describe("the board on a phone", () => {
  // Not the whole device: `defaultBrowserType` cannot change per group.
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices["Pixel 7"];
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

  test.beforeEach(async ({ page, request }) => {
    await registerAndVerify(page, request);
    await openExampleBoard(page);
  });

  test("has no hover scroll and no edge fades", async ({ page }) => {
    expect(
      await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches),
      "the emulated phone must not report a hovering pointer",
    ).toBe(false);

    const strip = page.getByTestId("board-scroller");
    const box = await strip.boundingBox();
    if (!box) throw new Error("could not measure the strip");
    expect(await strip.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);

    const middle = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, middle);
    await page.mouse.move(box.x + box.width - 4, middle, { steps: 5 });
    await page.waitForTimeout(400);
    expect(await strip.evaluate((element) => element.scrollLeft)).toBe(0);

    const fades = await page.getByTestId("board-frame").evaluate((frame) => {
      const after = getComputedStyle(frame, "::after");
      return { content: after.content, width: after.width };
    });
    expect(fades.content === "none" || fades.width === "auto" || fades.width === "0px").toBe(true);
  });

  test("shows one phase at a time, with tabs to move between them", async ({
    page,
  }) => {
    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveCount(4);
    await expect(page.getByRole("tab", { name: /Planejamento/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // One column fills the strip; the others wait off to the side.
    // Outer widths: the column has a border, the strip does not.
    const strip = page.getByTestId("board-scroller");
    const width = await strip.evaluate((element) => element.clientWidth);
    expect(
      await page
        .getByTestId("board-column")
        .first()
        .evaluate((element) => (element as HTMLElement).offsetWidth),
    ).toBe(width);

    await page.getByRole("tab", { name: /Revisão/ }).click();
    await expect.poll(() => strip.evaluate((element) => element.scrollLeft)).toBeGreaterThan(
      width * 1.5,
    );
    await expect(page.getByRole("tab", { name: /Revisão/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // The bar under the thumb knows where it is, and the strip under the
    // title opens the health pane.
    await expect(
      page.getByTestId("tabbar").getByRole("link", { name: "Quadro" }),
    ).toHaveAttribute("aria-current", "page");
    await page.getByTestId("panel-summary").click();
    await expect(page.getByRole("dialog").getByText("Progresso ajustado")).toBeVisible();
  });

  /**
   * A finger on a card: a swipe scrolls the strip, a press-and-hold picks the
   * card up. Both have to work from on top of a card, since a column is
   * mostly cards. Real touch events, through the protocol, because a mouse
   * cannot say "finger".
   */
  test("a swipe on a card scrolls, and a long press carries it", async ({
    page,
    context,
  }) => {
    const cdp = await context.newCDPSession(page);
    const finger = async (x: number, y: number, dx: number, holdMs: number) => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      await page.waitForTimeout(holdMs);
      for (let step = 1; step <= 12; step += 1) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: x + (dx * step) / 12, y }],
        });
        await page.waitForTimeout(16);
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(300);
    };

    const strip = page.getByTestId("board-scroller");
    const card = page.getByTestId("task-card").filter({ hasText: "limpeza" }).first();
    const box = await card.boundingBox();
    if (!box) throw new Error("could not measure the card");
    const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    // A swipe, straight away: the strip moves, the card stays where it was.
    // Past half a column, because the strip snaps and a synthetic finger has
    // no flick for the snap to read; a real thumb's momentum carries it.
    await finger(middle.x, middle.y, -280, 0);
    await expect.poll(() => strip.evaluate((element) => element.scrollLeft)).toBeGreaterThan(100);
    expect(await columnOf(page, "limpeza")).toBe("planning");

    // A press that holds still first: the card comes along instead.
    await strip.evaluate((element) => {
      element.scrollLeft = 0;
    });
    const again = await card.boundingBox();
    if (!again) throw new Error("could not measure the card");
    await finger(again.x + again.width / 2, again.y + 20, 320, 350);
    await expect.poll(() => columnOf(page, "limpeza")).not.toBe("planning");
  });
});
