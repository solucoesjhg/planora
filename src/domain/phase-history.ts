/**
 * Phase history (DEVELOPMENT_PLAN.md §3.8).
 *
 * Leaving a phase consolidates that phase's internal notes into the task body,
 * under a labelled section, and clears the notes for the phase being entered.
 * A pure transformation of `(body, notes, label, at)` — which is what makes it
 * testable, and what makes the task read months later as a record of how the
 * work actually went.
 *
 * The label arrives from the caller: user-facing text is pt-BR and lives in the
 * strings module, never in the domain.
 */

export type ArchiveNotesInput = {
  readonly body: string;
  readonly notes: string;
  /** How the section is titled, e.g. "Execução". */
  readonly label: string;
  readonly at: Date;
};

export type ArchiveNotesResult = {
  readonly body: string;
  readonly notes: string;
};

export function archiveNotes({
  body,
  notes,
  label,
  at,
}: ArchiveNotesInput): ArchiveNotesResult {
  if (notes.trim().length === 0) {
    return { body, notes: "" };
  }

  const section = [
    `<section data-phase-note="${isoDate(at)}">`,
    `<h3>${escapeHtml(label)} — ${isoDate(at)}</h3>`,
    notes.trim(),
    `</section>`,
  ].join("\n");

  const separator = body.trim().length === 0 ? "" : "\n";
  return { body: `${body.trim()}${separator}${section}`, notes: "" };
}

/** How many phases this task has already archived. */
export function archivedPhaseCount(body: string): number {
  return body.split('<section data-phase-note="').length - 1;
}

function isoDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
