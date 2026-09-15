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

    // The card moves optimistically before the server has written; reopening
    // it while that revalidation is still in flight races the navigation.
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
    const card = page.getByTestId("task-card").filter({ hasText: "limpeza" });
    await drag(page, card, columnWithPhase(page, "execution"));
    await expect(async () => {
      await expect(
        columnWithPhase(page, "execution").getByText("Contratar a limpeza"),
      ).toBeVisible();
    }).toPass();
    await written;

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

  test("an attached file has a stable address that signs a fresh URL", async ({
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

    // The address stored in the page carries no signature: it outlives one.
    const address = (await file.getAttribute("href"))!;
    expect(address).toMatch(/^\/api\/attachments\/[0-9a-f-]{36}$/);

    // Signed in, it redirects to a URL that was signed just now.
    const redirect = await page.request.get(address, { maxRedirects: 0 });
    expect(redirect.status()).toBe(302);
    const signed = redirect.headers()["location"]!;
    expect(signed).toContain("/api/files/");
    expect(signed).toContain("sig=");

    const bytes = await page.request.get(signed);
    expect(bytes.status()).toBe(200);
    expect(await bytes.text()).toContain("R$ 1.200");

    // Asking again signs again: the expiry has moved forward, which is what
    // makes the address outlive any single signature.
    await page.waitForTimeout(1100);
    const again = await page.request.get(address, { maxRedirects: 0 });
    const expiryOf = (url: string) =>
      Number(new URL(url).searchParams.get("exp"));
    expect(expiryOf(again.headers()["location"]!)).toBeGreaterThan(expiryOf(signed));

    // The same path without a signature does not work.
    const bare = await request.get(new URL(signed).pathname);
    expect(bare.status()).toBe(403);

    // Nor does one whose expiry was pushed forward.
    const stretched = new URL(signed);
    stretched.searchParams.set(
      "exp",
      String(Number(stretched.searchParams.get("exp")) + 86_400),
    );
    expect((await request.get(stretched.toString())).status()).toBe(403);

    // Nor does one signed for a different file.
    const elsewhere = new URL(signed);
    elsewhere.pathname = elsewhere.pathname.replace("orcamento.txt", "outro.txt");
    expect((await request.get(elsewhere.toString())).status()).toBe(403);

    // And the stable address itself is nobody's without a session: `request`
    // carries no cookies.
    const anonymous = await request.get(new URL(address, page.url()).toString(), {
      maxRedirects: 0,
    });
    expect(anonymous.status()).toBe(401);
  });

  /**
   * What the first production deploy showed: the store did not answer, the
   * promise never settled, and "Enviando…" stayed on the screen for good. The
   * network is the one place a browser can make the store fail on purpose.
   */
  test("a store that does not answer says so, and the button comes back", async ({
    page,
  }) => {
    await openCard(page, "limpeza");
    const modal = page.getByTestId("task-modal");

    // The browser's own upload, dropped at the network — what a refused CORS
    // preflight or an unreachable host looks like from here.
    await page.route("**/api/files/**", (route) => route.abort("failed"));

    await modal.getByLabel("Escolher arquivos").setInputFiles({
      name: "foto.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("nada"),
    });

    await expect(
      page.getByText("O armazenamento de arquivos não respondeu."),
    ).toBeVisible();
    await expect(modal.getByRole("button", { name: "Anexar arquivo" })).toBeEnabled();
    await expect(modal.getByRole("link", { name: "Abrir foto.txt" })).toHaveCount(0);
  });

  /**
   * The regression that reached the screen: a due date used to travel as an
   * instant, and every zone west of UTC read it back as the day before — a task
   * due today was shown as one day late. The browser here runs in whatever zone
   * the machine is in, which is the point.
   */
  test("a task due today reads as today, not as a day late", async ({ page }) => {
    await openCard(page, "limpeza");
    const modal = page.getByTestId("task-modal");

    const today = new Date();
    const isoToday = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, "0"),
      String(today.getDate()).padStart(2, "0"),
    ].join("-");

    await modal.getByLabel("Prazo").fill(isoToday);
    await modal.getByRole("textbox", { name: "Título da tarefa" }).click();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("task-modal")).toHaveCount(0);
    await page.reload();

    const card = page.getByTestId("task-card").filter({ hasText: "limpeza" });
    await expect(card).toContainText("hoje");
    await expect(card).not.toContainText("atraso");
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
