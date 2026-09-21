import { Clock, Users } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { ToastProvider } from "@/components/ui/toast";
import { InviteForm } from "@/features/workspace/invite-form";
import { requireSession, requireWorkspace } from "@/server/auth/dal";
import { can } from "@/server/auth/tenant";
import { withTenant } from "@/server/db/client";
import { membersOf } from "@/server/modules/workspaces/repository";
import { pendingInvitations } from "@/server/modules/workspaces/service";
import { AccountBar } from "@/features/workspace/account-bar";
import { ROLE_LABELS } from "@/lib/strings";

/**
 * Who is in this workspace, and who has been asked to be.
 *
 * Phase 3 built invitations — issuing, expiry, acceptance, the email — and
 * left them with no way in. This is that way in.
 */
export default async function UsersPage() {
  const session = await requireSession();
  const workspace = await requireWorkspace();

  const [members, invitations] = await withTenant(workspace, (tx) =>
    Promise.all([membersOf(tx, workspace), pendingInvitations(tx, workspace)]),
  );

  const mayInvite = can(workspace, "manage-members");

  return (
    <ToastProvider>
      <AppShell
        title="Usuários"
        account={<AccountBar />}
      >
        <div className="flex max-w-3xl flex-col gap-6">
          {mayInvite ? (
            <InviteForm />
          ) : (
            <p className="text-[13px] text-secondary">
              Seu papel neste espaço permite ver quem está aqui, não convidar.
            </p>
          )}

          <section className="flex flex-col gap-2">
            <h2 className="text-[11px] tracking-[0.12em] text-subtle uppercase">
              No espaço · {members.length}
            </h2>

            <ul className="flex flex-col">
              {members.map((member) => (
                <li
                  key={member.userId}
                  className="flex items-center justify-between gap-3 border-b border-hairline py-2.5"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] text-primary">
                      {member.name}
                      {member.userId === session.userId ? (
                        <span className="text-subtle"> · você</span>
                      ) : null}
                    </span>
                    <span className="truncate text-xs text-secondary">
                      {member.email}
                    </span>
                  </span>

                  <Badge tone={member.role === "viewer" ? "neutral" : "low"}>
                    {(ROLE_LABELS[member.role] ?? member.role).toLowerCase()}
                  </Badge>
                </li>
              ))}
            </ul>
          </section>

          {invitations.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-[11px] tracking-[0.12em] text-subtle uppercase">
                Convites em aberto · {invitations.length}
              </h2>

              <ul className="flex flex-col">
                {invitations.map((invitation) => (
                  <li
                    key={invitation.id}
                    className="flex items-center justify-between gap-3 border-b border-hairline py-2.5"
                  >
                    <span className="truncate text-[13px] text-secondary">
                      {invitation.email}
                    </span>
                    <span className="flex items-center gap-2 text-xs text-subtle">
                      <Clock size={12} aria-hidden />
                      expira {invitation.expiresAt.toLocaleDateString("pt-BR")}
                      <Badge tone="neutral">
                        {(ROLE_LABELS[invitation.role] ?? invitation.role).toLowerCase()}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {members.length === 1 && invitations.length === 0 ? (
            <p className="flex items-center gap-2 text-xs text-subtle">
              <Users size={13} aria-hidden />
              Você é a única pessoa aqui. Um convite dura sete dias.
            </p>
          ) : null}
        </div>
      </AppShell>
    </ToastProvider>
  );
}
