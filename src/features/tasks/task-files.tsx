"use client";

import { Download, FileText, Trash2, Upload } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  confirmUploadAction,
  removeAttachmentAction,
  requestUploadAction,
} from "@/server/modules/tasks/actions";
import type { TaskView } from "@/server/modules/tasks/view";

/**
 * Attachments, from the browser's side (DEVELOPMENT_PLAN.md §7 Phase 7).
 *
 * The bytes never pass through the application: the server hands back a URL
 * that expires, the browser uploads to it, and only then does the server ask
 * the store what actually landed.
 */

type Scope = { projectId: string; taskId: string };

const REFUSALS: Record<string, string> = {
  forbidden: "Seu papel neste espaço permite ler, não anexar.",
  "unsupported-type": "Esse tipo de arquivo não é aceito.",
  "too-large": "O arquivo passa de 25 MB.",
  missing: "O arquivo não chegou ao armazenamento.",
  "not-found": "Essa tarefa não existe mais.",
  "storage-unavailable":
    "O armazenamento de arquivos não respondeu. Não é o arquivo: o log do servidor diz o motivo.",
};

/**
 * The three steps, shared by the file list and by the editor's image drop.
 *
 * The promise it returns always settles. On the first production deploy the
 * store threw, the Server Action rejected, and "Enviando…" stayed on the
 * screen for good: nothing had been written to catch it.
 */
export function useUpload(scope: Scope): (file: File) => Promise<string | null> {
  const toast = useToast();

  async function send(file: File): Promise<string | null> {
    const ticket = await requestUploadAction({
      projectId: scope.projectId,
      taskId: scope.taskId,
      name: file.name,
      mime: file.type || "application/octet-stream",
      size: file.size,
    });

    if (!ticket.ok) {
      toast.add({ title: REFUSALS[ticket.reason] ?? "Não deu para enviar o arquivo." });
      return null;
    }

    let sent: Response;
    try {
      sent = await fetch(ticket.value.url, {
        method: ticket.value.method,
        headers: ticket.value.headers,
        body: file,
      });
    } catch (error) {
      // A network failure — which, in a browser, includes a CORS preflight the
      // store refused. Nothing answered, so there is no status to show.
      console.error("[attachments] the store did not answer the upload", error);
      toast.add({ title: "O armazenamento de arquivos não respondeu." });
      return null;
    }

    if (!sent.ok) {
      // The status is the one clue there is: 413 is the bucket's own size
      // limit, 415 its own type list, 403 a ticket that expired.
      toast.add({ title: `O armazenamento recusou o arquivo (${sent.status}).` });
      return null;
    }

    const confirmed = await confirmUploadAction({
      projectId: scope.projectId,
      taskId: scope.taskId,
      attachmentId: ticket.value.attachmentId,
    });

    if (!confirmed.ok) {
      toast.add({ title: REFUSALS[confirmed.reason] ?? "O envio não foi concluído." });
      return null;
    }

    return confirmed.value.url;
  }

  return async (file: File) => {
    try {
      return await send(file);
    } catch (error) {
      // Whatever else threw — a Server Action rejecting, its message stripped
      // in production — the promise settles and the person hears something.
      console.error("[attachments] the upload failed", error);
      toast.add({ title: "Não deu para enviar o arquivo. Tente de novo." });
      return null;
    }
  };
}

/** What the editor needs: an image in, a URL out. */
export function useImageUpload(scope: Scope): (file: File) => Promise<string | null> {
  return useUpload(scope);
}

export function TaskFiles({ task }: { task: TaskView }) {
  const scope = { projectId: task.project.id, taskId: task.id };
  const upload = useUpload(scope);
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
  const [, startTransition] = useTransition();

  async function onPick(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;
    setSending(true);
    try {
      for (const file of files) await upload(file);
    } finally {
      // Whatever happened, the button comes back.
      setSending(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {task.files.length > 0 ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {task.files.map((file) => (
            <li
              key={file.id}
              className="group flex items-center gap-3 rounded-card border border-line bg-card p-2"
            >
              {file.isImage && file.url ? (
                // eslint-disable-next-line @next/next/no-img-element -- a signed URL, not an asset the optimizer can fetch
                <img
                  src={file.url}
                  alt={file.name}
                  className="size-12 shrink-0 rounded-[6px] border border-hairline object-cover"
                />
              ) : (
                <span className="flex size-12 shrink-0 items-center justify-center rounded-[6px] border border-hairline text-subtle">
                  <FileText size={16} aria-hidden />
                </span>
              )}

              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] text-secondary">{file.name}</span>
                <span className="text-[11px] text-subtle">{readableSize(file.size)}</span>
              </span>

              <a
                href={file.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Abrir ${file.name}`}
                className="rounded-control p-1.5 text-subtle transition-colors hover:text-primary"
              >
                <Download size={13} aria-hidden />
              </a>

              {task.canWrite ? (
                <button
                  type="button"
                  aria-label={`Remover ${file.name}`}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await removeAttachmentAction({
                        ...scope,
                        attachmentId: file.id,
                      });
                      if (!result.ok) {
                        toast.add({
                          title: REFUSALS[result.reason] ?? "Não deu para remover o arquivo.",
                        });
                      }
                    })
                  }
                  className="rounded-control p-1.5 text-subtle opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                >
                  <Trash2 size={13} aria-hidden />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-subtle">Nenhum arquivo anexado.</p>
      )}

      {task.canWrite ? (
        <div>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            aria-label="Escolher arquivos"
            onChange={(event) => void onPick(event.target.files)}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={sending}
            onClick={() => input.current?.click()}
          >
            <Upload size={14} aria-hidden />
            {sending ? "Enviando…" : "Anexar arquivo"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
