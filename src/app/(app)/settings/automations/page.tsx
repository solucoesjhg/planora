import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { ToastProvider } from "@/components/ui/toast";
import { RuleForm } from "@/features/automations/rule-form";
import { RuleList } from "@/features/automations/rule-list";
import { AccountBar } from "@/features/workspace/account-bar";
import { timeAgo } from "@/lib/activity";
import { RUN_STATUS_LABELS, TRIGGER_LABELS } from "@/lib/strings";
import { requireWorkspace } from "@/server/auth/dal";
import { can } from "@/server/auth/tenant";
import { getDatabase } from "@/server/db/client";
import { listAutomations, listRuns } from "@/server/modules/automations/repository";
import { membersOf } from "@/server/modules/workspaces/repository";
import type { Trigger } from "@/domain/automations";

/**
 * The workspace's rules and their log (DEVELOPMENT_PLAN.md §7 Phase 9):
 * what fired, what the rule did, what failed — and why a run was skipped.
 */
export default async function AutomationsPage() {
  const workspace = await requireWorkspace();
  const database = getDatabase();
  const [rules, runs, members] = await Promise.all([
    listAutomations(database, workspace),
    listRuns(database, workspace, 30),
    membersOf(database, workspace),
  ]);
  const mayManage = can(workspace, "manage-project");
  const now = new Date();

  return (
    <ToastProvider>
      <AppShell
        title="Automações"
        account={<AccountBar />}
        panelTitle="Como funciona"
        panel={
          <div className="flex flex-col gap-3 text-[13px] text-secondary">
            <p>
              Uma regra é <em>quando</em> um evento, <em>se</em> condições valem, <em>então</em>{" "}
              ações — até dez por evento.
            </p>
            <p>
              O que uma regra faz aparece no histórico assinado como <strong>Planora</strong>, nunca
              como uma pessoa. Uma regra que dispara outra é contada: a partir da terceira
              consequência, nada mais dispara.
            </p>
            <p>
              O relógio do produto emite os eventos de prazo e estagnação uma vez por dia por tarefa.
            </p>
            <Link href="/settings" className="text-sienna underline-offset-4 hover:underline">
              Voltar às configurações
            </Link>
          </div>
        }
      >
        <div className="flex max-w-4xl flex-col gap-8">
          {mayManage ? (
            <RuleForm members={members.map((m) => ({ userId: m.userId, name: m.name }))} />
          ) : (
            <p className="text-[13px] text-secondary">
              Seu papel neste espaço permite ver as regras, não escrevê-las.
            </p>
          )}

          <section className="flex flex-col gap-3">
            <h2 className="text-[11px] tracking-[0.12em] text-subtle uppercase">
              Regras · {rules.length}
            </h2>
            <RuleList
              rules={rules}
              members={members.map((m) => ({ userId: m.userId, name: m.name }))}
              mayManage={mayManage}
            />
          </section>

          <section className="flex flex-col gap-3" data-testid="run-log">
            <h2 className="text-[11px] tracking-[0.12em] text-subtle uppercase">
              Execuções · {runs.length}
            </h2>
            {runs.length === 0 ? (
              <p className="text-xs text-subtle">Nenhuma regra disparou ainda.</p>
            ) : (
              <ol className="flex flex-col">
                {runs.map((run) => (
                  <li
                    key={run.id}
                    data-testid="run"
                    data-status={run.status}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-hairline py-2 text-[13px]"
                  >
                    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                      <span className="truncate text-primary">{run.automationName ?? "regra apagada"}</span>
                      <span className="text-xs text-subtle">
                        {run.eventType ? TRIGGER_LABELS[run.eventType as Trigger] ?? run.eventType : "evento"}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge tone={STATUS_TONES[run.status] ?? "neutral"}>
                        {RUN_STATUS_LABELS[run.status] ?? run.status}
                      </Badge>
                      <span className="font-mono text-[11px] text-subtle">
                        {run.actionsRun} {run.actionsRun === 1 ? "ação" : "ações"}
                      </span>
                      <span className="text-[11px] text-subtle">{timeAgo(run.startedAt, now)}</span>
                    </span>
                    {run.detail ? (
                      <p className="w-full text-xs text-secondary">{run.detail}</p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </AppShell>
    </ToastProvider>
  );
}

const STATUS_TONES: Record<string, BadgeTone> = {
  succeeded: "done",
  failed: "blocked",
  skipped: "neutral",
};
