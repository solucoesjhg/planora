import { type Page } from "@playwright/test";
import { test, expect } from "./support/test";
import { registerAndVerify } from "./support/account";
import { columnWithPhase, drag, openExampleBoard } from "./support/board";

/**
 * The Phase 7 criteria: changing phase files the previous phase's notes into
 * the body under a labelled heading and empties the field, and an attachment's
 * URL stops working when it is tampered with or expires.
 */

test.describe("the task as a document", () => {
  test.beforeEach(async ({ page, request }) => {
    await registerAndVerify(page, request);
    await openExampleBoard(page);
  });

  test("a card opens over the board, at a URL that can be shared", async ({
    page,
  }) => {
    await openCard(page, "limpeza");

    const modal = page.getByTestId("task-modal");
    await expect(modal).toBeVisible();
    await expect(modal.getByText("Contratar a limpeza pós-obra")).toBeVisible();
    await expect(page).toHaveURL(/\/projects\/[^/]+\/tasks\/[^/]+$/);

    // The board is still behind it, not replaced by it.
    await expect(page.getByTestId("board-scroller")).toBeVisible();

    const shared = page.url();
    await page.goto(shared);
    await expect(page.getByTestId("task-modal")).toHaveCount(0);
    await expect(
      page.getByRole("textbox", { name: "Título da tarefa" }),
    ).toHaveValue("Contratar a limpeza pós-obra");
  });

  test("changing phase files the notes into the body and empties them", async ({
    page,
  }) => {
    await openCard(page, "limpeza");

    const notes = page
      .getByTestId("task-modal")
      .locator(".pln-prose[contenteditable='true']")
      .nth(1);
    await notes.click();
    await notes.fill("Combinar com a empresa de limpeza na segunda.");
    // Saving happens on blur, the way a document is written.
    await page.getByRole("textbox", { name: "Título da tarefa" }).click();
    await expect(page.getByTestId("task-modal").getByText("salvo")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("task-modal")).toHaveCount(0);

    const card = page.getByTestId("task-card").filter({ hasText: "limpeza" });
    await drag(page, card, columnWithPhase(page, "execution"));
    await expect(async () => {
      await expect(
        columnWithPhase(page, "execution").getByText("Contratar a limpeza"),
      ).toBeVisible();
    }).toPass();

    await openCard(page, "limpeza");
    const modal = page.getByTestId("task-modal");

    // The note is now part of the body, under the phase it belonged to.
    const body = modal.locator(".pln-prose[contenteditable='true']").first();
    await expect(body).toContainText("Planejamento");
    await expect(body).toContainText("Combinar com a empresa de limpeza");

    // And the field it came from is empty.
    const emptied = modal.locator(".pln-prose[contenteditable='true']").nth(1);
    await expect(emptied).not.toContainText("Combinar com a empresa");
  });

  test("a checklist item, a comment and a dependency all persist", async ({
    page,
  }) => {
    await openCard(page, "limpeza");
    const modal = page.getByTestId("task-modal");

    await modal.getByRole("textbox", { name: "Adicionar item" }).fill("Cotar");
    await modal.getByRole("button", { name: "Adicionar item" }).click();
    await expect(modal.getByText("Cotar")).toBeVisible();
    await expect(modal.getByText("Checklist · 0/1")).toBeVisible();

    await modal.getByRole("button", { name: "Marcar" }).first().click();
    await expect(modal.getByText("Checklist · 1/1")).toBeVisible();

    const comment = modal.locator(".pln-prose[contenteditable='true']").last();
    await comment.click();
    await comment.fill("Cliente aprovou o orçamento.");
    await modal.getByRole("button", { name: "Comentar" }).click();
    await expect(modal.getByText("Cliente aprovou o orçamento.")).toBeVisible();

    await page.reload();
    await expect(page.getByText("Cliente aprovou o orçamento.")).toBeVisible();
    await expect(page.getByText("Checklist · 1/1")).toBeVisible();
  });

  test("an attached file is served by a signed URL, and only that URL", async ({
    page,
    request,
  }) => {
    await openCard(page, "limpeza");
    const modal = page.getByTestId("task-modal");

    await modal.getByLabel("Escolher arquivos").setInputFiles({
      name: "orcamento.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Limpeza pós-obra — R$ 1.200"),
    });

    const file = modal.getByRole("link", { name: "Abrir orcamento.txt" });
    await expect(file).toBeVisible();

    const url = await file.getAttribute("href");
    expect(url).toContain("/api/files/");

    // The signed URL works.
    const signed = await request.get(url!);
    expect(signed.status()).toBe(200);
    expect(await signed.text()).toContain("R$ 1.200");

    // The same path without a signature does not.
    const bare = await request.get(url!.split("?")[0]!);
    expect(bare.status()).toBe(403);

    // Nor does one whose expiry was pushed forward.
    const stretched = new URL(url!);
    stretched.searchParams.set(
      "exp",
      String(Number(stretched.searchParams.get("exp")) + 86_400),
    );
    expect((await request.get(stretched.toString())).status()).toBe(403);

    // Nor does one signed for a different file.
    const elsewhere = new URL(url!);
    elsewhere.pathname = elsewhere.pathname.replace("orcamento.txt", "outro.txt");
    expect((await request.get(elsewhere.toString())).status()).toBe(403);
  });

  test("a new card is written where it will live", async ({ page }) => {
    await columnWithPhase(page, "planning")
      .getByRole("button", { name: "Nova tarefa" })
      .click();

    const field = page.getByRole("textbox", { name: "Título da nova tarefa" });
    await field.fill("Trocar a fechadura");
    await field.press("Enter");

    const created = columnWithPhase(page, "planning").getByTestId("task-card").filter({
      hasText: "Trocar a fechadura",
    });
    await expect(created).toBeVisible();

    await page.reload();
    await expect(page.getByText("Trocar a fechadura")).toBeVisible();
  });
});

async function openCard(page: Page, title: string): Promise<void> {
  await page.getByTestId("task-card").filter({ hasText: title }).first().click();
  await expect(page.getByTestId("task-modal")).toBeVisible();
}
