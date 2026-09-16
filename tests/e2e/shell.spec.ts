import { type Page } from "@playwright/test";
import { test, expect } from "./support/test";

/**
 * The Phase 4 criterion: the shell renders with no horizontal overflow and no
 * overlapping panes at every breakpoint, in both themes.
 *
 * 238px of rail plus 338px of panel is 576px of fixed furniture. A phone has
 * 390. So this is the test that proves the panes fold instead of squeezing.
 */

const WIDTHS = [
  { width: 1440, rail: true, panel: true },
  { width: 1280, rail: true, panel: true },
  { width: 1024, rail: true, panel: false },
  { width: 768, rail: true, panel: false },
  { width: 390, rail: false, panel: false },
] as const;

for (const scheme of ["dark", "light"] as const) {
  test.describe(`shell in the ${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    for (const { width, rail, panel } of WIDTHS) {
      test(`holds together at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/dev/ui");
        await expect(page.getByRole("heading", { name: "Primitivos" })).toBeVisible();

        expect(await overflowsHorizontally(page)).toBe(false);

        await expect(page.getByTestId("rail")).toBeVisible({ visible: rail });
        await expect(page.getByTestId("panel")).toBeVisible({ visible: panel });
        await expect(page.getByTestId("centre")).toBeVisible();

        const boxes = await Promise.all(
          ["rail", "centre", "panel"].map(async (id) => ({
            id,
            box: await page.getByTestId(id).boundingBox(),
          })),
        );

        for (const a of boxes) {
          for (const b of boxes) {
            if (a.id === b.id || !a.box || !b.box) continue;
            expect(
              overlaps(a.box, b.box),
              `${a.id} overlaps ${b.id} at ${width}px`,
            ).toBe(false);
          }
        }
      });
    }

    test(`opens the folded panes as drawers at 390px in ${scheme}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/dev/ui");

      await page.getByRole("button", { name: "Abrir navegação" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(
        page.getByRole("dialog").getByRole("link", { name: "Projetos" }),
      ).toBeVisible();
      expect(await overflowsHorizontally(page)).toBe(false);

      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeHidden();

      // The panel exists twice on a narrow screen — folded away in the grid and
      // live inside the drawer — so this asserts the one in the dialog.
      await page.getByRole("button", { name: "Abrir saúde do projeto" }).click();
      const drawer = page.getByRole("dialog");
      await expect(drawer.getByText("Progresso ajustado")).toBeVisible();
      expect(await overflowsHorizontally(page)).toBe(false);
    });
  });
}

async function overflowsHorizontally(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.documentElement;
    // One pixel of slack for sub-pixel rounding on fractional device ratios.
    return root.scrollWidth > root.clientWidth + 1;
  });
}

type Box = { x: number; y: number; width: number; height: number };

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/**
 * The theme is written onto `<html>` by a script that runs before React
 * hydrates — deliberately, so the page never flashes the wrong theme. React
 * reports that as an attribute the server never rendered unless the element
 * says it is expected, and a root-level hydration failure makes React throw the
 * server's HTML away and render the whole page again in the browser.
 *
 * It went unnoticed for four phases because every test started with an empty
 * `localStorage`, where the script does nothing. This one starts with a theme
 * already chosen, which is what anybody who has used the app once has.
 */
test.describe("a theme chosen earlier", () => {
  for (const theme of ["dark", "light"] as const) {
    test(`loads with no hydration error (${theme})`, async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (error) => errors.push(error.message));

      await page.goto("/");
      await page.evaluate(
        (chosen) => localStorage.setItem("planora-theme", chosen),
        theme,
      );

      errors.length = 0;
      await page.reload();
      await expect(page.getByRole("link", { name: "Entrar" })).toBeVisible();

      expect(await page.locator("html").getAttribute("data-theme")).toBe(theme);
      expect(errors).toStrictEqual([]);
    });
  }
});
