import Link from "next/link";
import { describeActivity, timeAgo } from "@/lib/activity";
import type { ActivityEntry } from "@/server/modules/activity/repository";

/**
 * The newest entries of `activity_logs`, one sentence each. A line that names
 * a task links to it; a line about a project links to its board.
 */
export function ActivityFeed({
  entries,
  now = new Date(),
}: {
  entries: readonly ActivityEntry[];
  now?: Date;
}) {
  return (
    <section className="flex flex-col gap-3" data-testid="activity-feed">
      <h2 className="text-[11px] tracking-[0.12em] text-subtle uppercase">
        Atividade recente
      </h2>

      {entries.length === 0 ? (
        <p className="text-xs text-subtle">
          Nada aconteceu ainda. Mover um cartão é o primeiro registro.
        </p>
      ) : (
        <ol className="flex flex-col">
          {entries.map((entry) => {
            const sentence = describeActivity(entry);
            const href = hrefOf(entry);
            return (
              <li
                key={entry.id}
                className="flex items-baseline justify-between gap-3 border-b border-hairline py-2 text-[13px]"
                data-testid="activity-entry"
              >
                {href ? (
                  <Link href={href} className="min-w-0 truncate text-secondary hover:text-primary">
                    {sentence}
                  </Link>
                ) : (
                  <span className="min-w-0 truncate text-secondary">{sentence}</span>
                )}
                <time
                  dateTime={entry.createdAt.toISOString()}
                  className="shrink-0 text-[11px] text-subtle"
                >
                  {timeAgo(entry.createdAt, now)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function hrefOf(entry: ActivityEntry): string | null {
  if (entry.subjectType === "task" && entry.projectId) {
    return `/projects/${entry.projectId}/tasks/${entry.subjectId}`;
  }
  if (entry.subjectType === "project" && entry.projectId) return `/projects/${entry.projectId}`;
  return null;
}
