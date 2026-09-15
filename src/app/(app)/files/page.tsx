import { FileText, Files } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { AccountBar } from "@/features/workspace/account-bar";
import { requireWorkspace } from "@/server/auth/dal";
import { getDatabase } from "@/server/db/client";
import { groupByProject, listFiles, type FileEntry } from "@/server/modules/files/repository";

/**
 * The global gallery (DEVELOPMENT_PLAN.md §7 Phase 8): every stored
 * attachment in the workspace, grouped by project. Each file opens through its
 * stable address, which signs a fresh URL after the workspace check.
 */
export default async function FilesPage() {
  const workspace = await requireWorkspace();
  const files = await listFiles(getDatabase(), workspace);
  const groups = groupByProject(files);
  const bytes = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <AppShell
      title="Arquivos"
      account={<AccountBar />}
      panelTitle="Resumo"
      panel={
        <dl className="flex flex-col gap-3 text-[13px]">
          <Line label="Arquivos" value={String(files.length)} />
          <Line label="Projetos com anexos" value={String(groups.length)} />
          <Line label="Espaço" value={readableSize(bytes)} />
        </dl>
      }
    >
      {files.length === 0 ? (
        <EmptyState
          icon={Files}
          title="Nenhum arquivo ainda"
          description="Os anexos das tarefas aparecem aqui, agrupados por projeto."
        />
      ) : (
        <div className="flex max-w-4xl flex-col gap-8" data-testid="files-gallery">
          {groups.map((group) => (
            <section key={group.project.id} className="flex flex-col gap-3">
              <header className="flex items-baseline justify-between gap-3">
                <h2 className="text-[11px] tracking-[0.12em] text-subtle uppercase">
                  <Link href={`/projects/${group.project.id}`} className="hover:text-primary">
                    {group.project.name}
                  </Link>{" "}
                  · {group.files.length}
                </h2>
                <span className="text-xs text-subtle">{readableSize(group.bytes)}</span>
              </header>

              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {group.files.map((file) => (
                  <FileCard key={file.id} file={file} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </AppShell>
  );
}

function FileCard({ file }: { file: FileEntry }) {
  return (
    <li
      className="flex flex-col gap-2 rounded-card border border-line bg-card p-3"
      data-testid="file-card"
    >
      <a
        href={file.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Abrir ${file.name}`}
        className="flex items-center gap-3"
      >
        {file.isImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- a signed URL, not an asset the optimizer can fetch
          <img
            src={file.url}
            alt=""
            className="size-14 shrink-0 rounded-[6px] border border-hairline object-cover"
          />
        ) : (
          <span className="flex size-14 shrink-0 items-center justify-center rounded-[6px] border border-hairline text-subtle">
            <FileText size={18} aria-hidden />
          </span>
        )}
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] text-primary">{file.name}</span>
          <span className="text-[11px] text-subtle">
            {readableSize(file.size)} · {file.uploadedBy}
          </span>
        </span>
      </a>

      {file.task ? (
        <Link
          href={`/projects/${file.project.id}/tasks/${file.task.id}`}
          className="truncate text-xs text-secondary hover:text-primary"
        >
          <span className="font-mono text-[11px] text-subtle">TSK-{file.task.number}</span>{" "}
          {file.task.title}
        </Link>
      ) : (
        <span className="text-xs text-subtle">Sem tarefa</span>
      )}
    </li>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-hairline pb-2">
      <dt className="text-secondary">{label}</dt>
      <dd className="font-mono text-primary">{value}</dd>
    </div>
  );
}

function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
