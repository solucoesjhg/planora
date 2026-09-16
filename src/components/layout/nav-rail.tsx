"use client";

import {
  FolderKanban,
  LayoutDashboard,
  Files,
  Settings,
  Sparkles,
  SquareKanban,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { useBoardHref } from "@/components/layout/use-board-href";
import { isActive } from "@/lib/nav";

export type NavItem = {
  readonly href: string;
  readonly label: string;
  readonly icon: typeof LayoutDashboard;
};

// The v1 tabs, in the v1 order. Screens arrive over Phases 5 to 12; the rail
// shows where they will be.
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Painel", icon: LayoutDashboard },
  { href: "/projects", label: "Projetos", icon: FolderKanban },
  { href: "/board", label: "Quadro", icon: SquareKanban },
  { href: "/files", label: "Arquivos", icon: Files },
  { href: "/users", label: "Usuários", icon: Users },
  { href: "/assistant", label: "Assistente", icon: Sparkles },
  { href: "/settings", label: "Configurações", icon: Settings },
];

export type NavRailProps = {
  /** Labels are hidden on the icon rail and shown inside the drawer. */
  readonly showLabels?: "responsive" | "always";
  readonly onNavigate?: () => void;
  /**
   * Where "Quadro" goes, as the server saw it: the last board this browser
   * opened, or /board. The rail re-reads the cookie after every navigation,
   * so opening another board moves the link without a reload.
   */
  readonly boardHref?: string;
};

export function NavRail({
  showLabels = "responsive",
  onNavigate,
  boardHref = "/board",
}: NavRailProps) {
  const pathname = usePathname();

  const board = useBoardHref(boardHref);

  return (
    <nav aria-label="Navegação principal" className="flex flex-col gap-2">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);

        return (
          <Link
            key={href}
            href={href === "/board" ? board : href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            title={label}
            className={cn(
              "pln-nav-item flex items-center gap-4 rounded-column px-4 transition-colors duration-150",
              showLabels === "responsive" && "justify-center px-0 lg:justify-start lg:px-4",
              !active && "text-secondary hover:bg-card-hover hover:text-primary",
            )}
          >
            <Icon size={18} strokeWidth={1.75} aria-hidden className="shrink-0" />
            <span
              className={cn(
                "truncate",
                showLabels === "responsive" && "hidden lg:inline",
              )}
            >
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
