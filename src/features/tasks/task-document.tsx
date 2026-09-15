"use client";

import {
  CalendarClock,
  Check,
  Link2,
  Lock,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import {
  addChecklistItemAction,
  setAssigneesAction,
  addCommentAction,
  addDependencyAction,
  removeChecklistItemAction,
  removeCommentAction,
  removeDependencyAction,
  setChecklistItemAction,
  updateTaskAction,
} from "@/server/modules/tasks/actions";
import type { TaskView } from "@/server/modules/tasks/view";
import { RichText } from "./rich-text";
import { AssigneePicker } from "./assignee-picker";
import { TaskFiles, useImageUpload } from "./task-files";
import { PRIORITY_OPTIONS, phaseLabel } from "@/lib/strings";

/**
 * The task as a document (DEVELOPMENT_PLAN.md §7 Phase 7).
 *
 * One column of prose — what the work is, what is left, what was said — and a
 * margin of facts. The internal notes are the field the phase history consumes:
 * leaving a phase files them into the body under a dated heading and empties
 * them, which is why they are labelled as belonging to *this* phase.
 */

export function TaskDocument({ task }: { task: TaskView }) {
  const toast = useToast();
  const [, startTransition] = useTransition();
  const scope = { projectId: task.project.id, taskId: task.id };

  /**
   * Runs a Server Action inside a transition and resolves when it has
   * answered — not when it was started. The editor shows "salvo" on that
   * promise, so the word has to mean the write is done: a save still in flight
   * while the person closes the modal and drags the card is the collision the
   * E2E found, and a person who reads "salvo" and closes the tab deserves
   * better than a request that may not have left yet.
   */
  function run<T>(
    work: () => Promise<{ ok: boolean; reason?: string } & T>,
    whenRefused?: Partial<Record<string, string>>,
  ): Promise<void> {
    return new Promise((resolve) => {
      startTransition(async () => {
        try {
          const result = await work();
          if (result.ok) return;

          const reason = result.reason ?? "";
          toast.add({
            title: whenRefused?.[reason] ?? MESSAGES[reason] ?? "Não deu para salvar.",
            description:
              reason === "forbidden"
                ? "Seu papel neste espaço permite ler, não escrever."
                : undefined,
          });
        } finally {
          resolve();
        }
      });
    });
  }

  const uploadImage = useImageUpload(scope);
  const done = task.checklist.filter((item) => item.done).length;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="flex min-w-0 flex-col gap-6">
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-[11px] tracking-[0.12em] text-subtle uppercase">
            <span className="font-mono">TSK-{task.number}</span>
            <span aria-hidden>·</span>
            <span>{task.project.name}</span>
            <span aria-hidden>·</span>
            <span>{phaseLabel(task.column.phase)}</span>
          </div>

          <TitleField
            title={task.title}
            editable={task.canWrite}
            onSave={(title) => run(() => updateTaskAction({ ...scope, title }))}
          />

          {task.blocked ? (
            <div className="flex items-center gap-2 rounded-card border border-danger/50 bg-danger/10 px-3 py-2 text-[13px] text-danger">
              <Lock size={13} aria-hidden />
              <span>{task.blockReason ?? "Tarefa travada."}</span>
            </div>
          ) : null}
        </header>

        <Section title="Descrição">
          <RichText
            value={task.body}
            editable={task.canWrite}
            placeholder="O que é esta tarefa, e o que conta como pronta."
            onSave={(body) => run(() => updateTaskAction({ ...scope, body }))}
            onUploadImage={uploadImage}
          />
        </Section>

        <Section
          title="Notas desta fase"
          hint="Ao mudar de fase, estas notas viram uma seção datada na descrição — e o campo esvazia."
        >
          <RichText
            value={task.internalNotes}
            editable={task.canWrite}
            minHeight="5rem"
            placeholder="O que está acontecendo agora."
            onSave={(internalNotes) =>
              run(() => updateTaskAction({ ...scope, internalNotes }))
            }
            onUploadImage={uploadImage}
          />
        </Section>

        <Section title={`Checklist · ${done}/${task.checklist.length}`}>
          <ul className="flex flex-col gap-1">
            {task.checklist.map((item) => (
              <li key={item.id} className="group flex items-center gap-2">
                <button
                  type="button"
                  disabled={!task.canWrite}
                  aria-label={item.done ? "Desmarcar" : "Marcar"}
                  onClick={() =>
                    run(() =>
                      setChecklistItemAction({
                        ...scope,
                        itemId: item.id,
                        done: !item.done,
                      }),
                    )
                  }
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
                    item.done
                      ? "border-sienna bg-sienna text-on-accent"
                      : "border-line hover:border-line-strong",
                  )}
                >
                  {item.done ? <Check size={11} aria-hidden /> : null}
                </button>

                <span
                  className={cn(
                    "flex-1 text-[13px]",
                    item.done ? "text-subtle line-through" : "text-secondary",
                  )}
                >
                  {item.title}
                </span>

                {task.canWrite ? (
                  <button
                    type="button"
                    aria-label={`Remover ${item.title}`}
                    onClick={() =>
                      run(() =>
                        removeChecklistItemAction({ ...scope, itemId: item.id }),
                      )
                    }
                    className="rounded-control p-1 text-subtle opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                  >
                    <Trash2 size={12} aria-hidden />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>

          {task.canWrite ? (
            <AddLine
              placeholder="Novo item"
              label="Adicionar item"
              onAdd={(title) =>
                run(() => addChecklistItemAction({ ...scope, title }))
              }
            />
          ) : null}
        </Section>

        <Section title="Anexos">
          <TaskFiles task={task} />
        </Section>

        <Section title={`Comentários · ${task.comments.length}`}>
          <ul className="flex flex-col gap-3">
            {task.comments.map((comment) => (
              <li
                key={comment.id}
                className="rounded-card border border-line bg-card px-3 py-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] text-primary">
                    {comment.authorName}
                  </span>
                  <span className="flex items-center gap-2 text-[11px] text-subtle">
                    {formatDateTime(comment.createdAt)}
                    {comment.edited ? " · editado" : ""}
                    {comment.mine ? (
                      <button
                        type="button"
                        aria-label="Apagar comentário"
                        onClick={() =>
                          run(() =>
                            removeCommentAction({ ...scope, commentId: comment.id }),
                          )
                        }
                        className="rounded-control p-1 text-subtle transition-colors hover:text-danger"
                      >
                        <Trash2 size={12} aria-hidden />
                      </button>
                    ) : null}
                  </span>
                </div>

                <div
                  className="pln-prose mt-1 text-[13px]"
                  // Sanitized on the server before it was stored, against the
                  // allowlist in `server/content/html.ts`.
                  dangerouslySetInnerHTML={{ __html: comment.body }}
                />
              </li>
            ))}
          </ul>

          {task.canWrite ? (
            <CommentBox
              onSend={(body) => run(() => addCommentAction({ ...scope, body }))}
              onUploadImage={uploadImage}
            />
          ) : null}
        </Section>
      </div>

      <aside className="flex flex-col gap-5 text-[13px]">
        <Field label="Responsáveis">
          {(id) => (
            <AssigneePicker
              id={id}
              assignees={task.assignees}
              members={task.members}
              disabled={!task.canWrite}
              onChange={(userIds) =>
                run(() => setAssigneesAction({ ...scope, userIds }), {
                  "not-a-member": "Essa pessoa não está neste espaço.",
                })
              }
            />
          )}
        </Field>

        <Field label="Prioridade">
          {(id) => (
            <Select
              id={id}
              items={PRIORITY_OPTIONS}
              value={task.priority}
              disabled={!task.canWrite}
              onValueChange={(value) =>
                run(() =>
                  updateTaskAction({
                    ...scope,
                    priority: value as "high" | "medium" | "low",
                  }),
                )
              }
            />
          )}
        </Field>

        <Field label="Início">
          {(id) => (
            <Input
              id={id}
              type="date"
              defaultValue={task.startDate ?? ""}
              disabled={!task.canWrite}
              onChange={(event) =>
                run(() =>
                  updateTaskAction({
                    ...scope,
                    startDate: event.target.value || null,
                  }),
                )
              }
            />
          )}
        </Field>

        <Field label="Prazo">
          {(id) => (
            <Input
              id={id}
              type="date"
              defaultValue={task.dueDate ?? ""}
              disabled={!task.canWrite}
              onChange={(event) =>
                run(() =>
                  updateTaskAction({ ...scope, dueDate: event.target.value || null })
                )
              }
            />
          )}
        </Field>

        <BlockedField task={task} onChange={run} />

        <div className="flex flex-col gap-2">
          <p className="text-[11px] tracking-[0.12em] text-subtle uppercase">
            Depende de
          </p>

          {task.dependsOn.length === 0 ? (
            <p className="text-xs text-subtle">Nada trava esta tarefa.</p>
          ) : (
            task.dependsOn.map((dependency) => (
              <div
                key={dependency.id}
                className="flex items-center justify-between gap-2 border-b border-hairline pb-1.5"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <Link2 size={12} className="shrink-0 text-subtle" aria-hidden />
                  <span className="truncate text-secondary">
                    TSK-{dependency.number} {dependency.title}
                  </span>
                </span>

                {dependency.done ? (
                  <Badge tone="low">ok</Badge>
                ) : (
                  <Badge tone="blocked">aberta</Badge>
                )}

                {task.canWrite ? (
                  <button
                    type="button"
                    aria-label={`Remover dependência TSK-${dependency.number}`}
                    onClick={() =>
                      run(() =>
                        removeDependencyAction({
                          ...scope,
                          dependencyId: dependency.id,
                        }),
                      )
                    }
                    className="rounded-control p-1 text-subtle transition-colors hover:text-danger"
                  >
                    <X size={12} aria-hidden />
                  </button>
                ) : null}
              </div>
            ))
          )}

          {task.canWrite && task.siblings.length > 0 ? (
            <Select
              placeholder="Adicionar dependência"
              items={task.siblings.map((sibling) => ({
                value: sibling.id,
                label: `TSK-${sibling.number} ${sibling.title}`,
              }))}
              onValueChange={(dependsOnId) => {
                if (!dependsOnId) return;
                run(() => addDependencyAction({ ...scope, dependsOnId }), {
                  cycle: "Isso fecharia um ciclo entre as tarefas.",
                  duplicate: "Essa dependência já existe.",
                  self: "Uma tarefa não depende de si mesma.",
                });
              }}
            />
          ) : null}
        </div>

        {task.blocks.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] tracking-[0.12em] text-subtle uppercase">
              Trava
            </p>
            {task.blocks.map((blocked) => (
              <span key={blocked.taskId} className="truncate text-secondary">
                TSK-{blocked.number} {blocked.title}
              </span>
            ))}
          </div>
        ) : null}

        {task.history.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] tracking-[0.12em] text-subtle uppercase">
              Passagens
            </p>
            {task.history.slice(0, 6).map((entry) => (
              <div
                key={`${entry.at}-${entry.toPhase}`}
                className="flex items-center justify-between gap-2 text-xs"
              >
                <span className="text-secondary">
                  {entry.columnName ?? phaseLabel(entry.toPhase)}
                </span>
                <span className="flex items-center gap-1 text-subtle">
                  <CalendarClock size={11} aria-hidden />
                  {formatDate(entry.at)}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

const MESSAGES: Record<string, string> = {
  forbidden: "Você não pode alterar esta tarefa.",
  "not-found": "Essa tarefa não existe mais.",
  empty: "Falta o texto.",
  "too-long": "Texto longo demais.",
  cycle: "Isso fecharia um ciclo entre as tarefas.",
  duplicate: "Essa dependência já existe.",
  self: "Uma tarefa não depende de si mesma.",
  "unsupported-type": "Esse tipo de arquivo não é aceito.",
  "too-large": "O arquivo passa de 25 MB.",
  missing: "O arquivo não chegou ao armazenamento.",
};

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[11px] tracking-[0.12em] text-subtle uppercase">{title}</h2>
      {hint ? <p className="-mt-1 text-xs text-subtle">{hint}</p> : null}
      {children}
    </section>
  );
}

function TitleField({
  title,
  editable,
  onSave,
}: {
  title: string;
  editable: boolean;
  onSave: (title: string) => void;
}) {
  const [value, setValue] = useState(title);

  if (!editable) {
    return <h1 className="pln-display text-2xl text-primary">{title}</h1>;
  }

  return (
    <input
      value={value}
      aria-label="Título da tarefa"
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        const next = value.trim();
        if (next.length > 0 && next !== title) onSave(next);
        else setValue(title);
      }}
      className={cn(
        "pln-display w-full rounded-control bg-transparent px-1 py-0.5 text-2xl text-primary",
        "border border-transparent transition-colors",
        "hover:border-line focus-visible:border-line-strong focus-visible:outline-none",
      )}
    />
  );
}

function BlockedField({
  task,
  onChange,
}: {
  task: TaskView;
  onChange: (work: () => Promise<{ ok: boolean; reason?: string }>) => void;
}) {
  const [reason, setReason] = useState(task.blockReason ?? "");
  const scope = { projectId: task.project.id, taskId: task.id };

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-[13px] text-secondary">
        <input
          type="checkbox"
          checked={task.blocked}
          disabled={!task.canWrite}
          onChange={(event) =>
            onChange(() =>
              updateTaskAction({
                ...scope,
                blocked: event.target.checked,
                blockReason: event.target.checked ? reason : null,
              }),
            )
          }
          className="size-3.5 accent-[var(--pln-danger)]"
        />
        Travada
      </label>

      {task.blocked ? (
        <Textarea
          value={reason}
          disabled={!task.canWrite}
          placeholder="Por quê?"
          onChange={(event) => setReason(event.target.value)}
          onBlur={() => {
            if (reason !== (task.blockReason ?? "")) {
              onChange(() => updateTaskAction({ ...scope, blockReason: reason }));
            }
          }}
          className="min-h-16 text-[13px]"
        />
      ) : null}
    </div>
  );
}

function AddLine({
  placeholder,
  label,
  onAdd,
}: {
  placeholder: string;
  label: string;
  onAdd: (value: string) => void;
}) {
  const [value, setValue] = useState("");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const next = value.trim();
    if (next.length === 0) return;
    onAdd(next);
    setValue("");
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <Input
        value={value}
        aria-label={label}
        placeholder={placeholder}
        onChange={(event) => setValue(event.target.value)}
        className="h-9 text-[13px]"
      />
      <Button type="submit" variant="secondary" size="sm" aria-label={label}>
        <Plus size={14} aria-hidden />
      </Button>
    </form>
  );
}

function CommentBox({
  onSend,
  onUploadImage,
}: {
  onSend: (body: string) => void;
  onUploadImage: (file: File) => Promise<string | null>;
}) {
  const [key, setKey] = useState(0);
  const [draft, setDraft] = useState("");

  return (
    <div className="flex flex-col gap-2">
      <RichText
        key={key}
        value=""
        minHeight="4rem"
        toolbar={false}
        placeholder="Escreva um comentário…"
        onSave={(html) => setDraft(html)}
        onUploadImage={onUploadImage}
      />

      <div className="flex justify-end">
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            if (draft.trim().length === 0) return;
            onSend(draft);
            setDraft("");
            // A fresh editor, rather than one that remembers what was sent.
            setKey((previous) => previous + 1);
          }}
        >
          Comentar
        </Button>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
