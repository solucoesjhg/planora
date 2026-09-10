-- Fractional index keys are base-62 strings, and they only order correctly
-- under byte comparison. The database's default collation is alphabetic and
-- case-insensitive at the primary level, which puts 'l' before 'V' and quietly
-- scrambles every board.
--
-- Written by hand: drizzle-kit does not model collation, so it neither
-- generates this nor tries to undo it.

ALTER TABLE "projects" ALTER COLUMN "position" TYPE text COLLATE "C";--> statement-breakpoint
ALTER TABLE "board_columns" ALTER COLUMN "position" TYPE text COLLATE "C";--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "position" TYPE text COLLATE "C";--> statement-breakpoint
ALTER TABLE "task_checklist_items" ALTER COLUMN "position" TYPE text COLLATE "C";
