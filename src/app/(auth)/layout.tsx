import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/ui/theme-toggle";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative z-1 flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-6 py-5">
        <span className="flex items-center gap-2">
          <span aria-hidden className="size-2 rounded-full bg-sienna" />
          <span className="pln-display text-lg text-primary">Planora</span>
        </span>
        <ThemeToggle />
      </header>

      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 pb-16">
        <div className="rounded-panel border border-line bg-panel p-6 shadow-panel">
          {children}
        </div>
      </main>
    </div>
  );
}
