import { test, expect } from "./support/test";
import { registerAndVerify } from "./support/account";
import { columnWithPhase, drag, openExampleBoard } from "./support/board";

/**
 * The Phase 9 criterion, end to end: a rule created in the interface fires
 * from a real board event, and the effect appears in the history authored by
 * the automation. Around it: the inbox, and the log a person reads.
 */

test.describe("automations", () => {
  test("a rule written in the interface fires from a real board event", async ({
    page,
    request,
  }) => {
    await registerAndVerify(page, request);

    await page.goto("/settings/automations");
    const form = page.getByTestId("rule-form");
    await form.getByLabel("Nome da regra").fill("Boas-vindas à execução");
    // "Quando uma tarefa muda de coluna" is the default trigger, and the one
    // default action is a comment: only its text is missing.
    await form.getByLabel("Comentário").fill("Chegou na execução.");
    await form.getByRole("button", { name: "Criar regra" }).click();

    const rule = page.getByTestId("rule").filter({ hasText: "Boas-vindas à execução" });
    await expect(rule).toBeVisible();
    await expect(rule).toContainText("uma tarefa muda de coluna");
    await expect(rule).toContainText('comentar "Chegou na execução."');

    // The real event: a card dragged on the board.
    await openExampleBoard(page);
    const boardUrl = page.url();
    const written = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url() === boardUrl &&
        response.status() < 400,
    );
    const card = page.getByTestId("task-card").filter({ hasText: "limpeza" });
    await drag(page, card, columnWithPhase(page, "execution"));
    await expect(columnWithPhase(page, "execution").getByText("Contratar a limpeza")).toBeVisible();
    await written;

    // The effect, authored by the automation — never by the person.
    await expect(async () => {
      await page.goto(boardUrl);
      await page.getByTestId("task-card").filter({ hasText: "limpeza" }).first().click();
      const modal = page.getByTestId("task-modal");
      await expect(modal.getByText("Chegou na execução.")).toBeVisible({ timeout: 3000 });
      await expect(modal.getByText("Planora · automação")).toBeVisible();
    }).toPass({ timeout: 20_000 });

    // The log says what fired and what it did.
    await page.goto("/settings/automations");
    const run = page.getByTestId("run").first();
    await expect(run).toContainText("Boas-vindas à execução");
    await expect(run).toContainText("executada");
    await expect(run).toContainText("1 ação");

    // And the feed signs it as the product.
    await page.goto("/dashboard");
    await expect(page.getByTestId("activity-feed")).toContainText("Planora comentou em TSK-");
  });

  test("a rule can be switched off, and then it does nothing", async ({ page, request }) => {
    await registerAndVerify(page, request);

    await page.goto("/settings/automations");
    const form = page.getByTestId("rule-form");
    await form.getByLabel("Nome da regra").fill("Silenciosa");
    await form.getByLabel("Comentário").fill("Não deveria aparecer.");
    await form.getByRole("button", { name: "Criar regra" }).click();
    await expect(page.getByTestId("rule").filter({ hasText: "Silenciosa" })).toBeVisible();

    await page.getByRole("switch", { name: "Desligar Silenciosa" }).click();
    await expect(page.getByRole("switch", { name: "Ligar Silenciosa" })).toBeVisible();

    await openExampleBoard(page);
    const boardUrl = page.url();
    const written = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && response.url() === boardUrl && response.status() < 400,
    );
    await drag(
      page,
      page.getByTestId("task-card").filter({ hasText: "limpeza" }),
      columnWithPhase(page, "execution"),
    );
    await written;

    await page.goto("/settings/automations");
    await expect(page.getByTestId("run")).toHaveCount(0);
  });
});

test.describe("the inbox", () => {
  test("the bell counts what arrived, and the inbox marks it read", async ({ page, request }) => {
    await registerAndVerify(page, request);

    // A rule that tells the person about a move: the one way a solo
    // workspace receives anything, since nobody is told what they did themselves.
    await page.goto("/settings/automations");
    const form = page.getByTestId("rule-form");
    await form.getByLabel("Nome da regra").fill("Me avise");
    await form.getByLabel("Ação 1").click();
    await page.getByRole("option", { name: "avisar" }).click();
    await form.getByLabel("Quem").click();
    await page.getByRole("option", { name: "uma pessoa" }).click();
    await form.getByLabel("Mensagem").fill("Uma tarefa se moveu.");
    await form.getByRole("button", { name: "Criar regra" }).click();
    await expect(page.getByTestId("rule").filter({ hasText: "Me avise" })).toBeVisible();

    await openExampleBoard(page);
    const boardUrl = page.url();
    const written = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && response.url() === boardUrl && response.status() < 400,
    );
    await drag(
      page,
      page.getByTestId("task-card").filter({ hasText: "limpeza" }),
      columnWithPhase(page, "execution"),
    );
    await written;

    // Found by what it says, not by where it sits: the scheduler test in a
    // parallel worker can tell this workspace about its overdue card after the
    // rule has, and the newest notice is listed first.
    await expect(async () => {
      await page.goto("/inbox");
      await expect(
        page.getByTestId("inbox-item").filter({ hasText: "Automação: Me avise" }),
      ).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 20_000 });
    // The shell renders the account corner twice — rail and header — and only
    // one is visible at a time; either says the same number. The number is at
    // least one: the scheduler test may tick meanwhile and the clock tells this
    // workspace about the example project's overdue card too.
    await expect(page.getByTestId("inbox-unread").first()).toHaveText(/^[1-9]\d*$/);

    await page.getByRole("button", { name: "Marcar todos como lidos" }).click();
    await expect(page.getByText("Nada sem ler.")).toBeVisible();
    await expect(page.getByTestId("inbox-unread")).toHaveCount(0);
  });

  test("the scheduler answers only to its secret", async ({ request }) => {
    // The suite runs with CRON_SECRET set (playwright.config.ts).
    expect((await request.get("/api/scheduler")).status()).toBe(401);
    const tick = await request.get("/api/scheduler", {
      headers: { authorization: "Bearer e2e-cron-secret" },
    });
    expect(tick.status()).toBe(200);
    const body = (await tick.json()) as { ok: boolean; routines: { evaluated: number } };
    expect(body.ok).toBe(true);
    expect(body.routines.evaluated).toBeGreaterThanOrEqual(0);
  });
});
