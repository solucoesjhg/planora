"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { deleteProjectAction } from "@/server/modules/projects/actions";
import { deleteWorkspaceAction } from "@/server/modules/workspaces/actions";
import { RATE_LIMITED } from "@/lib/strings";

export type DeletableProject = { readonly id: string; readonly name: string };

/**
 * What the v1 did to `localStorage`, done to the database instead
 * (§6.2): a project or the whole workspace, deleted — behind the name typed
 * out, so nothing here is one click away.
 */
export function DangerZone({
  projects,
  workspaceName,
  mayDeleteProjects,
  mayDeleteWorkspace,
}: {
  projects: readonly DeletableProject[];
  workspaceName: string;
  mayDeleteProjects: boolean;
  mayDeleteWorkspace: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [target, setTarget] = useState<
    { kind: "project"; project: DeletableProject } | { kind: "workspace" } | null
  >(null);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();

  const expected = target?.kind === "project" ? target.project.name : workspaceName;
  const matches = typed.trim() === expected;

  function close(): void {
    setTarget(null);
    setTyped("");
  }

  function confirm(): void {
    if (!target || !matches) return;

    startTransition(async () => {
      if (target.kind === "project") {
        const result = await deleteProjectAction({ projectId: target.project.id });
        if (!result.ok) {
          toast.add({
            title:
              result.reason === "rate-limited"
                ? RATE_LIMITED
                : "Não deu para apagar o projeto.",
          });
          return;
        }
        toast.add({ title: `${target.project.name} foi apagado.` });
        close();
        router.refresh();
        return;
      }

      // Succeeds by redirecting; only a refusal comes back.
      const result = await deleteWorkspaceAction(typed);
      if (result && !result.ok) {
        toast.add({
          title:
            result.reason === "mismatch"
              ? "O nome não confere."
              : result.reason === "rate-limited"
                ? RATE_LIMITED
                : "Seu papel não permite apagar o espaço de trabalho.",
        });
      }
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-panel border border-danger/40 bg-danger/5 p-4">
      {mayDeleteProjects ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-medium text-primary">Apagar um projeto</h3>
          {projects.length === 0 ? (
            <p className="text-xs text-subtle">Nenhum projeto para apagar.</p>
          ) : (
            <ul className="flex flex-col">
              {projects.map((project) => (
                <li
                  key={project.id}
                  className="flex items-center justify-between gap-3 border-b border-hairline py-2 text-[13px]"
                >
                  <span className="truncate text-secondary">{project.name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Apagar ${project.name}`}
                    onClick={() => setTarget({ kind: "project", project })}
                  >
                    <Trash2 size={13} aria-hidden />
                    Apagar
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {mayDeleteWorkspace ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-medium text-primary">Apagar o espaço de trabalho</h3>
          <p className="text-xs text-subtle">
            Projetos, tarefas, arquivos, membros e convites de <strong>{workspaceName}</strong> —
            tudo. Sua conta continua; um espaço novo, vazio, é criado na hora.
          </p>
          <div>
            <Button variant="danger" size="sm" onClick={() => setTarget({ kind: "workspace" })}>
              <Trash2 size={13} aria-hidden />
              Apagar espaço de trabalho
            </Button>
          </div>
        </section>
      ) : null}

      <Dialog open={target !== null} onOpenChange={(open) => (open ? null : close())}>
        <DialogContent
          title={target?.kind === "workspace" ? "Apagar o espaço de trabalho?" : "Apagar o projeto?"}
          description={`Não dá para desfazer. Para confirmar, digite ${expected}.`}
          footer={
            <>
              <Button variant="secondary" onClick={close} disabled={pending}>
                Cancelar
              </Button>
              <Button variant="danger" onClick={confirm} disabled={!matches || pending}>
                {pending ? "Apagando…" : "Apagar"}
              </Button>
            </>
          }
        >
          <Field label="Nome, exatamente como está">
            {(id) => (
              <Input
                id={id}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                placeholder={expected}
              />
            )}
          </Field>
        </DialogContent>
      </Dialog>
    </div>
  );
}
