import { test, expect } from "./support/test";
import { registerAndVerify } from "./support/account";
import { columnWithPhase, drag, openExampleBoard } from "./support/board";
import { query } from "./support/database";

/**
 * The Phase 8 criteria, end to end: every number on screen comes from the
 * domain, a project with no dates shows four dimensions instead of a
 * fabricated fifth, and the surfaces around it — dashboard, assignees, the
 * gallery, settings — do what the plan says.
 */

test.describe("health surfaces", () => {
  test.beforeEach(async ({ page, request }) => {
    await registerAndVerify(page, request);
  });

  test("a brand-new project is new, not critical", async ({ page }) => {
    await openExampleBoard(page);

    const panel = page.getByTestId("health-panel");
    await expect(panel.getByTestId("health-verdict")).toHaveText("Sem dados suficientes");
    await expect(panel.getByTestId("progress-adjusted")).toContainText("%");
    // Nothing is fabricated for a project nobody could judge yet.
    await expect(panel.getByTestId("health-dimension")).toHaveCount(0);
  });

  test("a project with no dates shows four dimensions, not a fabricated fifth", async ({
    page,
  }) => {
    await openExampleBoard(page);
    const projectId = page.url().match(/\/projects\/([^/?#]+)/)?.[1];
    if (!projectId) throw new Error("the board URL names the project");

    // Old enough to be judged, and without the calendar Pace needs.
    await query(
      (sql) =>
        sql`update projects set created_at = now() - interval '10 days', start_date = null, due_date = null where id = ${projectId}`,
    );
    await page.reload();

    const panel = page.getByTestId("health-panel");
    await expect(panel.getByTestId("health-verdict")).not.toHaveText("Sem dados suficientes");
    await expect(panel.getByTestId("health-dimension")).toHaveCount(4);
    await expect(panel.locator('[data-dimension="pace"]')).toHaveCount(0);
    await expect(panel.getByText("quatro dimensões, não cinco")).toBeVisible();

    // The example project ships with a blocked card: it is the Top 2's business.
    await expect(panel.getByTestId("health-top-two")).toContainText("Pintura da parede norte");
    await expect(panel.getByTestId("health-top-two")).toContainText("travada");
  });

  test("the dashboard shows the project's numbers and what just happened", async ({
    page,
  }) => {
    await openExampleBoard(page);
    const card = page.getByTestId("task-card").filter({ hasText: "limpeza" });

    // The card moves before the server has written; the dashboard reads the
    // database, so wait for the move's own POST to answer.
    const boardUrl = page.url();
    const written = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url() === boardUrl &&
        response.status() < 400,
    );
    await drag(page, card, columnWithPhase(page, "execution"));
    await expect(
      columnWithPhase(page, "execution").getByText("Contratar a limpeza"),
    ).toBeVisible();
    await written;

    await page.goto("/dashboard");

    const row = page.getByTestId("dashboard-project").filter({ hasText: "Reforma da sala" });
    await expect(row).toBeVisible();
    await expect(row.getByTestId("dashboard-verdict")).toHaveText("Sem dados suficientes");
    await expect(row.getByTestId("dashboard-progress")).toContainText("%");

    // Six cards, by the phase of their column — one of them just moved.
    const distribution = page.getByTestId("distribution-chart");
    await expect(distribution.locator('[data-phase="execution"]')).toContainText("3");
    await expect(distribution.locator('[data-phase="planning"]')).toContainText("0");

    await expect(async () => {
      await page.reload();
      await expect(page.getByTestId("activity-feed")).toContainText("moveu TSK-");
    }).toPass();
  });
});

test.describe("assignees", () => {
  test("a task can be given to somebody, and the card shows their face", async ({
    page,
    request,
  }) => {
    await registerAndVerify(page, request);
    await openExampleBoard(page);

    await page.getByTestId("task-card").filter({ hasText: "limpeza" }).first().click();
    const modal = page.getByTestId("task-modal");
    await expect(modal).toBeVisible();

    // The box ticks at once; the write is the Server Action behind it, which
    // posts to the document's own URL. Closing the modal before it answers
    // would abandon the request.
    const documentUrl = page.url();
    const written = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url() === documentUrl &&
        response.status() < 400,
    );
    await modal.getByTestId("assignee-picker").click();
    await page.getByRole("checkbox", { name: "Pessoa de Teste" }).check();
    await expect(modal.getByTestId("assignee-picker")).toContainText("Pessoa de Teste");
    await written;

    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("task-modal")).toHaveCount(0);
    await page.reload();

    const card = page.getByTestId("task-card").filter({ hasText: "limpeza" });
    await expect(card.getByTestId("assignee-stack")).toContainText("PT");
  });
});

test.describe("files and settings", () => {
  test.beforeEach(async ({ page, request }) => {
    await registerAndVerify(page, request);
  });

  test("the gallery groups every attachment by project", async ({ page }) => {
    await openExampleBoard(page);
    await page.getByTestId("task-card").filter({ hasText: "limpeza" }).first().click();
    const modal = page.getByTestId("task-modal");
    await modal.getByLabel("Escolher arquivos").setInputFiles({
      name: "planta.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("planta baixa"),
    });
    await expect(modal.getByRole("link", { name: "Abrir planta.txt" })).toBeVisible();

    await page.goto("/files");
    const gallery = page.getByTestId("files-gallery");
    await expect(gallery).toContainText("Exemplo · Reforma da sala");
    const file = gallery.getByTestId("file-card").filter({ hasText: "planta.txt" });
    await expect(file).toBeVisible();
    await expect(file).toContainText("Contratar a limpeza");
    expect(await file.getByRole("link", { name: "Abrir planta.txt" }).getAttribute("href")).toMatch(
      /^\/api\/attachments\//,
    );
  });

  test("hiding completed projects is a preference the grid honours", async ({ page }) => {
    await page.goto("/projects");
    await page.getByRole("button", { name: "Novo projeto" }).click();
    await page.getByLabel("Nome").fill("Já entregue");
    await page.getByRole("button", { name: "Criar projeto" }).click();
    const created = page.getByTestId("project-card").filter({ hasText: "Já entregue" });
    await expect(created).toBeVisible();
    await created.getByRole("button", { name: /Concluir/ }).click();
    await expect(created).toContainText("Reabrir");

    await page.goto("/settings");
    // The switch flips at once; the cookie is written by the Server Action it
    // calls, so leaving the page before that answers would leave no cookie.
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/settings") &&
        response.status() < 400,
    );
    await page.getByRole("switch", { name: "Ocultar projetos concluídos" }).click();
    await expect(page.getByRole("switch", { name: "Ocultar projetos concluídos" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await saved;

    await page.goto("/projects");
    await expect(page.getByTestId("project-card").filter({ hasText: "Já entregue" })).toHaveCount(0);
    await expect(
      page.getByTestId("project-card").filter({ hasText: "Exemplo · Reforma da sala" }),
    ).toBeVisible();
  });

  test("the export carries every project, and the Danger Zone wants the name typed", async ({
    page,
  }) => {
    const exported = await page.request.get("/api/export?format=json");
    expect(exported.status()).toBe(200);
    expect(exported.headers()["content-disposition"]).toContain("attachment");
    const data = (await exported.json()) as { projects: { name: string; tasks: unknown[] }[] };
    expect(data.projects.map((project) => project.name)).toContain("Exemplo · Reforma da sala");
    expect(data.projects[0]?.tasks.length).toBeGreaterThan(0);

    const csv = await page.request.get("/api/export?format=csv");
    expect(csv.headers()["content-type"]).toContain("text/csv");
    expect(await csv.text()).toContain("TSK-");

    await page.goto("/settings");
    await page.getByRole("button", { name: "Apagar Exemplo · Reforma da sala" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Apagar", exact: true })).toBeDisabled();
    await dialog.getByLabel("Nome, exatamente como está").fill("Exemplo");
    await expect(dialog.getByRole("button", { name: "Apagar", exact: true })).toBeDisabled();
    await dialog.getByLabel("Nome, exatamente como está").fill("Exemplo · Reforma da sala");
    await dialog.getByRole("button", { name: "Apagar", exact: true }).click();

    await expect(page.getByText("Exemplo · Reforma da sala foi apagado.")).toBeVisible();
    await page.goto("/projects");
    await expect(page.getByTestId("project-card")).toHaveCount(0);
  });
});
