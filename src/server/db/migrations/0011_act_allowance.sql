-- One act buys at most ten automated actions (ADR 0004).
--
-- A run now says which act it answers — the root of its event's causal chain —
-- and how many actions that act could still pay for when the run was claimed.
-- The sum of `actions_granted` over one `chain_id` is what the allowance counts.
ALTER TABLE "automation_runs" ADD COLUMN "chain_id" uuid;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD COLUMN "actions_granted" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

-- The runs already written are filed under the root of their event, as a new
-- run would be: up the `caused_by` links until an event has none. A link to an
-- event that no longer exists leaves the run under its own event.
WITH RECURSIVE up AS (
  SELECT r.id AS run_id, e.id AS event_id, e.caused_by
  FROM "automation_runs" r
  JOIN "outbox_events" e ON e.id = r.event_id
  UNION ALL
  SELECT up.run_id, e.id, e.caused_by
  FROM up
  JOIN "outbox_events" e ON e.id = up.caused_by
)
UPDATE "automation_runs" r
SET chain_id = up.event_id
FROM up
WHERE up.run_id = r.id AND up.caused_by IS NULL;--> statement-breakpoint
UPDATE "automation_runs" SET chain_id = event_id WHERE chain_id IS NULL;--> statement-breakpoint
ALTER TABLE "automation_runs" ALTER COLUMN "chain_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "automation_runs_chain_idx" ON "automation_runs" USING btree ("chain_id");
