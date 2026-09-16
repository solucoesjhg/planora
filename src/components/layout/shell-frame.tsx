"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { FolderKanban, LayoutDashboard, MoreHorizontal, SquareKanban } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavRail } from "@/components/layout/nav-rail";
import { useBoardHref } from "@/components/layout/use-board-href";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";
import { isActive } from "@/lib/nav";

type Frame = {
  readonly openNav: () => void;
};

const FrameContext = createContext<Frame | null>(null);

/** The frame this screen sits in, or null when it is rendering on its own. */
export function useShellFrame(): Frame | null {
  return useContext(FrameContext);
}

export type ShellFrameProps = {
  /** The account corner, in the rail and in the navigation drawer. */
  readonly account?: ReactNode;
  /** Where the rail's "Quadro" goes: the last board, or /board. */
  readonly boardHref?: string;
  readonly children: ReactNode;
};

/**
 * The part of the shell that outlives a navigation: the grid, the rail and
 * the navigation drawer. The `(app)` layout renders it once, and screens come
 * and go inside it — so the rail keeps its node, its scroll and its focus
 * while the centre changes, instead of the whole shell blinking out and back.
 *
 * The grid has three columns from `md` up. A screen puts its centre in the
 * second and, when it has one, its panel in the third; the third is `auto`,
 * sized by the panel that lands there, and collapses to nothing otherwise.
 * (See AppShell for the breakpoints at which the panes fold.)
 */
export function ShellFrame({ account, boardHref, children }: ShellFrameProps) {
  const [navOpen, setNavOpen] = useState(false);
  const frame = useMemo<Frame>(() => ({ openNav: () => setNavOpen(true) }), []);

  return (
    <FrameContext.Provider value={frame}>
      <div
        className={cn(
          "relative z-1 grid min-h-dvh w-full pb-22 md:pb-0",
          "grid-cols-[minmax(0,1fr)]",
          "md:grid-cols-[4rem_minmax(0,1fr)_auto]",
          "lg:grid-cols-[var(--pln-rail-w)_minmax(0,1fr)_auto]",
        )}
      >
        <aside
          data-testid="rail"
          className="hidden min-w-0 flex-col gap-6 border-r border-hairline px-2 py-7 md:flex lg:px-4"
        >
          <Brand compact />
          <NavRail boardHref={boardHref} />
          <div className="mt-auto hidden lg:block">{account}</div>
        </aside>

        {children}

        <TabBar boardHref={boardHref} onMore={() => setNavOpen(true)} />

        <Sheet open={navOpen} onOpenChange={setNavOpen} side="left" title="Planora">
          <NavRail
            showLabels="always"
            boardHref={boardHref}
            onNavigate={() => setNavOpen(false)}
          />
          <div className="mt-6">{account}</div>
        </Sheet>
      </div>
    </FrameContext.Provider>
  );
}

/**
 * The phone's navigation: the three screens people move between all day,
 * and "Mais" for the rest through the drawer. Fixed, under the thumb; the
 * frame leaves room for it. From md up the rail takes over and this folds.
 */
function TabBar({ boardHref, onMore }: { boardHref?: string; onMore: () => void }) {
  const pathname = usePathname();
  const board = useBoardHref(boardHref);
  const items = [
    { href: "/dashboard", to: "/dashboard", label: "Painel", icon: LayoutDashboard },
    { href: "/projects", to: "/projects", label: "Projetos", icon: FolderKanban },
    { href: "/board", to: board, label: "Quadro", icon: SquareKanban },
  ];

  return (
    <nav
      aria-label="Navegação rápida"
      data-testid="tabbar"
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 gap-1 border-t border-hairline bg-surface px-2 pt-2",
        "pb-[max(1.25rem,env(safe-area-inset-bottom))] md:hidden",
      )}
    >
      {items.map(({ href, to, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={to}
            aria-current={active ? "page" : undefined}
            className={cn(
              "pln-tab-item flex h-13 flex-col items-center justify-center gap-1 rounded-column text-[11px]",
              !active && "text-secondary",
            )}
          >
            <Icon size={22} strokeWidth={1.75} aria-hidden />
            {label}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onMore}
        className="pln-tab-item flex h-13 flex-col items-center justify-center gap-1 rounded-column text-[11px] text-secondary"
      >
        <MoreHorizontal size={22} strokeWidth={1.75} aria-hidden />
        Mais
      </button>
    </nav>
  );
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <span className="mb-6 flex items-center justify-center gap-3 px-2 lg:justify-start">
      <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-sienna" />
      <span
        className={cn(
          "pln-brand pln-display text-[31px] leading-none tracking-[-0.02em]",
          compact && "hidden lg:inline",
        )}
      >
        Planora
      </span>
    </span>
  );
}
