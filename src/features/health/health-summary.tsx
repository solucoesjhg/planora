import { Badge } from "@/components/ui/badge";
import type { HealthReport } from "@/domain/health";
import type { ProjectProgress } from "@/domain/progress";
import { toDisplay } from "@/domain/types";
import { VERDICT_LABELS } from "@/lib/strings";
import { VERDICT_TONES } from "./health-panel";

/**
 * The health pane in one line, for the strip under a board's title on a
 * phone: the verdict and the adjusted progress. Tapping the strip opens the
 * full pane as a drawer; this only has to say enough to be worth the tap.
 */
export function HealthSummary({
  report,
  progress,
}: {
  readonly report: HealthReport;
  readonly progress: ProjectProgress;
}) {
  return (
    <>
      <Badge tone={VERDICT_TONES[report.verdict]}>{VERDICT_LABELS[report.verdict]}</Badge>
      <span className="ml-auto text-[12px] text-secondary">
        <span className="pln-display text-[18px] text-primary">
          {toDisplay(progress.adjusted)}%
        </span>{" "}
        ajustado
      </span>
    </>
  );
}
