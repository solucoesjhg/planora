"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { signOut } from "@/lib/auth-client";

export function AccountMenu({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex items-center gap-1">
      <ThemeToggle />

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
