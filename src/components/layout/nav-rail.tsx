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
};

export function NavRail({ showLabels = "responsive", onNavigate }: NavRailProps) {
  const pathname = usePathname();

  return (
    <nav aria-label="Navegação principal" className="flex flex-col gap-1">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            title={label}
            className={cn(
              "flex items-center gap-3 rounded-control px-3 py-2 text-[13px] transition-colors duration-150",
              showLabels === "responsive" && "justify-center lg:justify-start",
              active
                ? "bg-sienna-soft text-sienna"
                : "text-secondary hover:bg-card-hover hover:text-primary",
            )}
          >
            <Icon size={17} aria-hidden className="shrink-0" />
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
