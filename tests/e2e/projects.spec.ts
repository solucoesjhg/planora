import { expect, test } from "@playwright/test";
import { registerAndVerify } from "./support/account";

/**
 * The Phase 5 criterion: a fresh account lands on a populated board, a project
 * can be created, completing one with blocked work is refused, and a finished
 * project can be reopened.
 */

test("a new account arrives at a board that already has something on it", async ({
  page,
  request,
}) => {
  await registerAndVerify(page, request);
  await page.goto("/projects");

  const example = page
    .getByTestId("project-card")
    .filter({ hasText: "Exemplo · Reforma da sala" });

  await expect(example).toBeVisible();
  // Two: the card with the block flag, and the one waiting on an unfinished
  // dependency. The grid counts the same union the domain does.
  await expect(example.getByText("2 bloqueadas")).toBeVisible();
});

test("completing a project with blocked work is refused", async ({
  page,
  request,
}) => {
  await registerAndVerify(page, request);
  await page.goto("/projects");

  const example = page
    .getByTestId("project-card")
    .filter({ hasText: "Exemplo · Reforma da sala" });

  await example.getByRole("button", { name: "Concluir" }).click();

  await expect(page.getByText("Ainda há trabalho travado")).toBeVisible();
  // The card stays where it was: a refusal writes nothing.
  await expect(example).toBeVisible();
  await expect(page.getByText("Concluídos ·")).toHaveCount(0);
});

test("a project can be created, finished and reopened", async ({
  page,
  request,
}) => {
  await registerAndVerify(page, request);
  await page.goto("/projects");

  await page.getByRole("button", { name: "Novo projeto" }).click();
  await page.getByLabel("Nome").fill("Projeto vazio");
  await page.getByLabel("Cliente").fill("Cliente de teste");
  await page.getByRole("button", { name: "Criar projeto" }).click();

  const created = page
    .getByTestId("project-card")
    .filter({ hasText: "Projeto vazio" });

  await expect(created).toBeVisible();
  await expect(created.getByText("Cliente de teste")).toBeVisible();

  // Nothing open, nothing blocked: this one may simply be finished.
  await created.getByRole("button", { name: "Concluir" }).click();
  await expect(page.getByText("Concluídos ·")).toBeVisible();
  await expect(created.getByRole("button", { name: "Reabrir" })).toBeVisible();

  await created.getByRole("button", { name: "Reabrir" }).click();
  await expect(created.getByRole("button", { name: "Concluir" })).toBeVisible();
});
