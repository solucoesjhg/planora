"use client";

import { Menu, PanelRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { NavRail } from "@/components/layout/nav-rail";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";

export type AppShellProps = {
  readonly title: string;
  readonly account?: ReactNode;
  /** The contextual right pane: progress, health, bottlenecks (Phase 8). */
  readonly panel?: ReactNode;
  readonly panelTitle?: string;
  readonly children: ReactNode;
};

/**
 * The tri-pane shell (DEVELOPMENT_PLAN.md §7 Phase 4).
 *
 * 238px of rail, a fluid centre and a 338px panel add up to 576px of fixed
 * furniture, which is more than a phone has. So the panes fold rather than
 * squeeze:
 *
 *   >= 1280   rail · centre · panel
 *   1024      rail · centre            panel becomes a drawer
 *   768       icons · centre           labels fold away
 *   < 768     centre                   both become drawers
 *
 * Folding is CSS, not measurement: no window probing, no hydration mismatch,
 * and no layout that depends on JavaScript having run.
 */
export function AppShell({
  title,
  account,
  panel,
  panelTitle = "Contexto",
  children,
}: AppShellProps) {
  const [navOpen, setNavOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  return (
    <div
      className={cn(
        "relative z-1 grid min-h-dvh w-full",
        "grid-cols-[minmax(0,1fr)]",
        "md:grid-cols-[4rem_minmax(0,1fr)]",
        "lg:grid-cols-[var(--pln-rail-w)_minmax(0,1fr)]",
        panel
          ? "xl:grid-cols-[var(--pln-rail-w)_minmax(0,1fr)_var(--pln-panel-w)]"
          : "xl:grid-cols-[var(--pln-rail-w)_minmax(0,1fr)]",
      )}
    >
      <aside
        data-testid="rail"
        className="hidden min-w-0 flex-col gap-6 border-r border-hairline px-3 py-5 md:flex"
      >
        <Brand compact />
        <NavRail />
        <div className="mt-auto hidden lg:block">{account}</div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header
          className={cn(
            "flex min-h-16 items-center gap-3 border-b border-hairline",
            "px-5 py-4 lg:px-[var(--pln-main-px)]",
          )}
        >
          <button
            type="button"
            aria-label="Abrir navegação"
            onClick={() => setNavOpen(true)}
            className="rounded-control p-2 text-muted transition-colors hover:bg-card-hover hover:text-primary md:hidden"
          >
            <Menu size={18} aria-hidden />
          </button>

          <h1 className="pln-display truncate text-2xl text-primary">{title}</h1>

          <div className="ml-auto flex items-center gap-2">
            <div className="lg:hidden">{account}</div>

            {panel ? (
              <button
                type="button"
                aria-label={`Abrir ${panelTitle.toLowerCase()}`}
                onClick={() => setPanelOpen(true)}
                className="rounded-control p-2 text-muted transition-colors hover:bg-card-hover hover:text-primary xl:hidden"
              >
                <PanelRight size={18} aria-hidden />
              </button>
            ) : null}
          </div>
        </header>

        <main
          data-testid="centre"
          className="min-w-0 flex-1 px-5 py-6 lg:px-[var(--pln-main-px)] lg:py-[var(--pln-main-py)]"
        >
          {children}
        </main>
      </div>

      {panel ? (
        <aside
          data-testid="panel"
          className="hidden min-w-0 flex-col gap-4 border-l border-hairline bg-app-soft px-5 py-6 xl:flex"
        >
          {panel}
        </aside>
      ) : null}

      <Sheet open={navOpen} onOpenChange={setNavOpen} side="left" title="Planora">
        <NavRail showLabels="always" onNavigate={() => setNavOpen(false)} />
        <div className="mt-6">{account}</div>
      </Sheet>

      {panel ? (
        <Sheet
          open={panelOpen}
          onOpenChange={setPanelOpen}
          side="right"
          title={panelTitle}
        >
          {panel}
        </Sheet>
      ) : null}
    </div>
  );
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center justify-center gap-2 px-1 lg:justify-start">
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full bg-sienna"
      />
      <span
        className={cn(
          "pln-display text-lg text-primary",
          compact && "hidden lg:inline",
        )}
      >
        Planora
      </span>
    </span>
  );
}
