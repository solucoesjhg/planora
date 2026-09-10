import type { LucideIcon } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { requireSession } from "@/server/auth/dal";
import { AccountBar } from "@/features/workspace/account-bar";

/**
 * A screen the rail already points at and the plan has not reached yet.
 *
 * The rail was showing seven destinations and four of them answered with the
 * framework's 404 — which reads as broken rather than as unfinished. Naming
 * the phase is the honest version, and it disappears when the phase lands.
 */
export async function PlannedScreen({
  title,
  icon,
  description,
}: {
  title: string;
  icon: LucideIcon;
  description: string;
}) {
  // The guard for a screen with nothing else to fetch.
  await requireSession();

  return (
    <AppShell
      title={title}
      account={<AccountBar />}
    >
      <EmptyState icon={icon} title={title} description={description} />
    </AppShell>
  );
}
