"use client";

import { UserPlus } from "lucide-react";
import { useOptimistic, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/cn";

export type Person = { readonly userId: string; readonly name: string };

/**
 * Who a task belongs to (DEVELOPMENT_PLAN.md §7 Phase 8). A list of the
 * workspace's members with a box beside each; the whole set is sent on every
 * change, so what is not ticked is no longer responsible.
 */
export function AssigneePicker({
  id,
  assignees,
  members,
  disabled = false,
  onChange,
}: {
  id?: string;
  assignees: readonly Person[];
  members: readonly Person[];
  disabled?: boolean;
  onChange: (userIds: string[]) => Promise<void>;
}) {
  const [busy, startTransition] = useTransition();
  // The box ticks the moment it is clicked; the server confirms, or the
  // transition ends and the props win again.
  const [optimistic, setOptimistic] = useOptimistic(
    assignees,
    (_current, next: readonly Person[]) => next,
  );
  const chosen = new Set(optimistic.map((person) => person.userId));

  function toggle(userId: string): void {
    const next = chosen.has(userId)
      ? optimistic.filter((person) => person.userId !== userId)
      : [...optimistic, ...members.filter((member) => member.userId === userId)];

    startTransition(async () => {
      setOptimistic(next);
      await onChange(next.map((person) => person.userId));
    });
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            id={id}
            type="button"
            disabled={disabled}
            aria-label="Responsáveis"
            data-testid="assignee-picker"
            className={cn(
              "flex min-h-9 w-full items-center gap-2 rounded-control border border-line bg-input px-2.5 py-1.5 text-left text-[13px]",
              "transition-colors hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            {optimistic.length === 0 ? (
              <span className="flex items-center gap-2 text-subtle">
                <UserPlus size={14} aria-hidden />
                Ninguém ainda
              </span>
            ) : (
              <span className="flex min-w-0 items-center gap-1.5">
                <AvatarStack people={optimistic} />
                <span className="truncate text-secondary">
                  {optimistic.map((person) => person.name).join(", ")}
                </span>
              </span>
            )}
          </button>
        }
      />

      <PopoverContent align="start" className="w-64">
        <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto p-1" aria-label="Membros">
          {members.map((member) => (
            <li key={member.userId}>
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-[13px] text-primary",
                  "hover:bg-card-hover",
                  busy && "opacity-70",
                )}
              >
                <input
                  type="checkbox"
                  className="accent-sienna"
                  checked={chosen.has(member.userId)}
                  disabled={busy}
                  onChange={() => toggle(member.userId)}
                />
                <Avatar name={member.name} size="sm" />
                <span className="truncate">{member.name}</span>
              </label>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** Up to three faces, then a count — on the card, and on the picker. */
export function AvatarStack({
  people,
  max = 3,
}: {
  people: readonly Person[];
  max?: number;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;

  return (
    <span className="flex items-center -space-x-1.5" data-testid="assignee-stack">
      {shown.map((person) => (
        <Avatar
          key={person.userId}
          name={person.name}
          size="sm"
          className="size-5 border border-card text-[9px]"
        />
      ))}
      {rest > 0 ? (
        <span className="flex size-5 items-center justify-center rounded-full border border-card bg-card-hover text-[9px] text-secondary">
          +{rest}
        </span>
      ) : null}
    </span>
  );
}
