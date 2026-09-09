"use client";

import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/cn";

export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "planora-theme";

/**
 * Dark is the product's own world and the default; light is supported because
 * the v1 shipped a toggle and people who work in daylight kept using it.
 *
 * There is no React state here on purpose. The theme lives in one place — the
 * `data-theme` attribute the tokens read — and the two icons are shown by CSS
 * from that same attribute. No effect, no second source of truth, and no
 * hydration mismatch between what the server rendered and what the inline
 * script in the layout already applied.
 */
export function ThemeToggle({ className }: { className?: string }) {
  return (
    <button
      type="button"
      aria-label="Alternar tema"
      onClick={toggleTheme}
      className={cn(
        "rounded-control p-2 text-muted transition-colors hover:bg-card-hover hover:text-primary",
        className,
      )}
    >
      <Sun size={16} aria-hidden className="pln-when-dark" />
      <Moon size={16} aria-hidden className="pln-when-light" />
    </button>
  );
}

function toggleTheme() {
  const root = document.documentElement;
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";

  root.dataset["theme"] = next;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // A browser with site data blocked still gets the theme for this visit.
  }
}

function currentTheme(): Theme {
  const stamped = document.documentElement.dataset["theme"];
  if (stamped === "dark" || stamped === "light") return stamped;

  // Unstamped: the system decides, and the tokens default to dark.
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}
