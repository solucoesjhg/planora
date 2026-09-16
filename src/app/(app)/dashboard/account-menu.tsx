"use client";

import { Check, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { signOut } from "@/lib/auth-client";
import { switchWorkspaceAction } from "@/server/modules/workspaces/actions";

export type WorkspaceChoice = {
  readonly id: string;
  readonly name: string;
  readonly current: boolean;
};

/**
 * Accepting an invitation used to put somebody in a workspace they had no way
 * to open: the request resolved to their oldest membership, whichever that was.
 * This is where they choose. The choice is a cookie; the DAL still resolves
 * membership from the database on every request.
 */
export function AccountMenu({
  name,
  email,
  workspaces = [],
}: {
  name: string;
  email: string;
  workspaces?: readonly WorkspaceChoice[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex items-center gap-1">
      <span className="pln-account-extra">
        <ThemeToggle />
      </span>

      <Popover>
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label="Conta"
              className="rounded-full transition-opacity hover:opacity-80"
            >
              <Avatar name={name} size="sm" />
            </button>
          }
        />
        <PopoverContent align="end" className="w-60">
          <div className="flex flex-col gap-3 p-1">
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[13px] font-medium text-primary">
                {name}
              </span>
              <span className="truncate text-xs text-secondary">{email}</span>
            </div>

            {workspaces.length > 1 ? (
              <div className="flex flex-col gap-0.5 border-t border-hairline pt-2">
                <span className="px-1 pb-1 text-[11px] tracking-[0.12em] text-subtle uppercase">
                  Espaços de trabalho
                </span>

                {workspaces.map((workspace) => (
                  <button
                    key={workspace.id}
                    type="button"
                    disabled={busy || workspace.current}
                    onClick={async () => {
                      setBusy(true);
                      await switchWorkspaceAction(workspace.id);
                      router.refresh();
                      setBusy(false);
                    }}
                    className="flex items-center justify-between gap-2 rounded-control px-1 py-1.5 text-left text-[13px] text-secondary transition-colors hover:bg-card-hover hover:text-primary disabled:text-primary"
                  >
                    <span className="truncate">{workspace.name}</span>
                    {workspace.current ? (
                      <Check size={13} aria-hidden className="shrink-0 text-sienna" />
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}

            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await signOut();
                router.push("/login");
                router.refresh();
              }}
              className="justify-start"
            >
              <LogOut size={14} aria-hidden />
              {busy ? "Saindo..." : "Sair"}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
