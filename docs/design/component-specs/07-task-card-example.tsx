import React from "react";
import { CalendarDays, CheckSquare, Flag } from "lucide-react";
import "./planora-components.css";

type TaskCardProps = {
  title: string;
  priority: "Alta" | "Média" | "Baixa";
  checklist: string;
  dueDate: string;
  avatarLabel?: string;
  accentColor?: string;
};

export function TaskCard({
  title,
  priority,
  checklist,
  dueDate,
  avatarLabel = "PL",
  accentColor = "#6EA47A",
}: TaskCardProps) {
  return (
    <article
      className="pln-task-card"
      style={{ "--pln-card-accent": accentColor } as React.CSSProperties}
    >
      <span className="pln-card-divider-1" />
      <span className="pln-card-divider-2" />

      <div className="relative z-10">
        <h3 className="line-clamp-2 text-[15px] font-medium leading-snug text-pln-text-primary">
          {title}
        </h3>

        <div className="mt-4 flex items-center gap-2 text-[11px] text-pln-text-muted">
          <span className="inline-flex items-center gap-1">
            <Flag className="h-3 w-3" />
            {priority}
          </span>
        </div>

        <div className="mt-3 flex items-center gap-5 text-xs text-pln-text-muted">
          <span className="inline-flex items-center gap-1.5">
            <CheckSquare className="h-3.5 w-3.5" />
            {checklist}
          </span>

          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" />
            {dueDate}
          </span>

          <div className="ml-auto grid h-8 w-8 place-items-center rounded-full border border-white/10 bg-white/10 text-[10px]">
            {avatarLabel}
          </div>
        </div>
      </div>
    </article>
  );
}
