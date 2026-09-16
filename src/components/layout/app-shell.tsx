"use client";

import { ChevronRight, Menu, PanelRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ShellFrame, useShellFrame } from "@/components/layout/shell-frame";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";

export type AppShellProps = {
  readonly title: string;
  /** The small label over the title: "Projeto" on a board, for instance. */
  readonly eyebrow?: string;
  readonly account?: ReactNode;
  /** The contextual right pane: progress, health, bottlenecks (Phase 8). */
  readonly panel?: ReactNode;
  readonly panelTitle?: string;
  /**
   * The panel in one line, for a phone: a tappable strip under the title
   * that opens the panel as a drawer, in place of the icon nobody finds.
   */
  readonly panelSummary?: ReactNode;
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
 *
 * Inside a ShellFrame — every screen under `(app)`, whose layout provides
 * one — this renders only the screen: the centre and its panel. The frame
 * owns the rail and persists across navigations, which is what keeps the
 * shell from blinking on every click. On its own, as in the gallery, it
 * renders the whole shell, frame included.
 */
export function AppShell(props: AppShellProps) {
  const framed = useShellFrame() !== null;
  if (framed) return <Screen {...props} />;

  return (
    <ShellFrame account={props.account}>
      <Screen {...props} />
    </ShellFrame>
  );
}

function Screen({
  title,
  eyebrow,
  account,
  panel,
  panelTitle = "Contexto",
  panelSummary,
  children,
}: AppShellProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const hasSummary = Boolean(panel && panelSummary);

  return (
    <>
      <div className="flex min-w-0 flex-col">
        <header
          className={cn(
            "flex min-h-16 items-center gap-3 border-b border-hairline",
            "px-5 py-4 lg:min-h-[var(--pln-header-min-h)] lg:px-[var(--pln-main-px)] lg:py-6",
          )}
        >
          <NavButton />

          <div className="flex min-w-0 flex-col gap-1">
            {eyebrow ? (
              <span className="hidden text-[12px] tracking-[0.12em] text-subtle uppercase lg:block">
                {eyebrow}
              </span>
            ) : null}
            <h1 className="pln-display truncate text-2xl leading-none text-primary lg:text-[40px]">
              {title}
            </h1>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className="pln-account-compact lg:hidden">{account}</div>

            {panel ? (
              <button
                type="button"
                aria-label={`Abrir ${panelTitle.toLowerCase()}`}
                onClick={() => setPanelOpen(true)}
                className={cn(
                  "rounded-control p-2 text-muted transition-colors hover:bg-card-hover hover:text-primary xl:hidden",
                  hasSummary && "hidden md:inline-flex",
                )}
              >
                <PanelRight size={18} aria-hidden />
              </button>
            ) : null}
          </div>
        </header>

        {hasSummary ? (
          <button
            type="button"
            aria-label={`Abrir ${panelTitle.toLowerCase()}`}
            onClick={() => setPanelOpen(true)}
            data-testid="panel-summary"
            className="flex min-h-12 w-full items-center gap-3 border-b border-hairline bg-panel px-5 text-left md:hidden"
          >
            <span className="flex min-w-0 flex-1 items-center gap-3">{panelSummary}</span>
            <ChevronRight size={18} aria-hidden className="shrink-0 text-subtle" />
          </button>
        ) : null}

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
          className="hidden min-w-0 flex-col gap-4 border-l border-hairline bg-app-soft px-5 py-6 xl:flex xl:w-side-panel"
        >
          {panel}
        </aside>
      ) : null}

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
    </>
  );
}

/** Opens the frame's navigation drawer. Rendered inside the frame, always. */
function NavButton() {
  const frame = useShellFrame();

  return (
    <button
      type="button"
      aria-label="Abrir navegação"
      onClick={() => frame?.openNav()}
      className="rounded-control p-2 text-muted transition-colors hover:bg-card-hover hover:text-primary md:hidden"
    >
      <Menu size={18} aria-hidden />
    </button>
  );
}
