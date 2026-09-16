"use client";

import { Check, CheckCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/activity";
import { cn } from "@/lib/cn";
import { markReadAction } from "@/server/modules/notifications/actions";

export type InboxItem = {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly href: string | null;
  readonly read: boolean;
  readonly createdAt: string;
};

export function InboxList({ items, now }: { items: readonly InboxItem[]; now: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const unread = items.filter((item) => !item.read).length;

  function mark(ids: readonly string[] | "all"): void {
    startTransition(async () => {
      await markReadAction({ ids });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="inbox">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-secondary">
          {unread === 0
            ? "Nada sem ler."
            : `${unread} ${unread === 1 ? "aviso sem ler" : "avisos sem ler"}.`}
        </p>
        {unread > 0 ? (
          <Button variant="secondary" size="sm" disabled={pending} onClick={() => mark("all")}>
            <CheckCheck size={13} aria-hidden />
            Marcar todos como lidos
          </Button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-subtle">
          Quando alguém atribuir uma tarefa a você, comentar nela, ou o prazo chegar, aparece aqui.
        </p>
      ) : (
        <ol className="flex flex-col">
          {items.map((item) => (
            <li
              key={item.id}
              data-testid="inbox-item"
              data-read={item.read ? "true" : "false"}
              className={cn(
                "flex items-start justify-between gap-3 border-b border-hairline py-3",
                item.read && "opacity-70",
              )}
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                {item.href ? (
                  <Link href={item.href} className="truncate text-[13px] font-medium text-primary hover:text-sienna">
                    {item.title}
                  </Link>
                ) : (
                  <span className="truncate text-[13px] font-medium text-primary">{item.title}</span>
                )}
                <span className="text-xs text-secondary">{item.body}</span>
                <span className="text-[11px] text-subtle">
                  {timeAgo(new Date(item.createdAt), new Date(now))}
                </span>
              </div>
              {!item.read ? (
                <button
                  type="button"
                  aria-label={`Marcar como lido: ${item.title}`}
                  disabled={pending}
                  onClick={() => mark([item.id])}
                  className="shrink-0 rounded-control p-1.5 text-subtle transition-colors hover:bg-card-hover hover:text-primary"
                >
                  <Check size={14} aria-hidden />
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
