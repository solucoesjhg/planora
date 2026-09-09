"use client";

import { Avatar as BaseAvatar } from "@base-ui/react/avatar";
import { cn } from "@/lib/cn";

export type AvatarProps = {
  readonly name: string;
  readonly src?: string | null;
  readonly size?: "sm" | "md";
  readonly className?: string;
};

const SIZES = {
  sm: "size-7 text-[11px]",
  md: "size-9 text-[13px]",
} as const;

export function Avatar({ name, src, size = "md", className }: AvatarProps) {
  return (
    <BaseAvatar.Root
      className={cn(
        "inline-flex select-none items-center justify-center overflow-hidden rounded-full",
        "border border-line bg-surface align-middle font-medium text-secondary",
        SIZES[size],
        className,
      )}
    >
      {src ? (
        <BaseAvatar.Image src={src} alt={name} className="size-full object-cover" />
      ) : null}
      <BaseAvatar.Fallback className="flex size-full items-center justify-center">
        {initialsOf(name)}
      </BaseAvatar.Fallback>
    </BaseAvatar.Root>
  );
}

/** Two letters, from the first and last word — "Maria Santos" reads MS. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";

  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}
