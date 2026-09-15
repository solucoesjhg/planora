"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { currentTheme, setTheme, type Theme } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/cn";

/**
 * The theme, chosen by name rather than toggled (§7 Phase 8). Same mechanism
 * as the rail's button: the attribute the tokens read, remembered in the
 * browser. That attribute is the state — this component subscribes to it, so
 * the rail's button and these radios never disagree — and the server, which
 * does not know this browser's theme, renders neither as chosen: guessing
 * would be the hydration mismatch of Phase 4 again.
 */
export function Appearance() {
  const theme = useSyncExternalStore(subscribeToTheme, currentTheme, () => null);

  function choose(next: Theme): void {
    setTheme(next);
  }

  return (
    <div className="flex gap-2" role="radiogroup" aria-label="Tema">
      <Choice
        label="Escuro"
        icon={<Moon size={14} aria-hidden />}
        selected={theme === "dark"}
        onSelect={() => choose("dark")}
      />
      <Choice
        label="Claro"
        icon={<Sun size={14} aria-hidden />}
        selected={theme === "light"}
        onSelect={() => choose("light")}
      />
    </div>
  );
}

function subscribeToTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

function Choice({
  label,
  icon,
  selected,
  onSelect,
}: {
  label: string;
  icon: React.ReactNode;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex items-center gap-2 rounded-control border px-3 py-2 text-[13px] transition-colors",
        selected
          ? "border-sienna bg-sienna-soft text-sienna"
          : "border-line text-secondary hover:bg-card-hover hover:text-primary",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
