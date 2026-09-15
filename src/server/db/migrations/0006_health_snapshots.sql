CREATE TABLE "project_health_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"date" date NOT NULL,
	"score" real,
	"verdict" text NOT NULL,
	"raw_verdict" text NOT NULL,
	"flow" real,
	"pace" real,
	"punctuality" real,
	"freshness" real,
	"momentum" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_health_snapshots_verdict" CHECK (verdict in ('healthy', 'attention', 'at_risk', 'critical', 'insufficient_data')),
	CONSTRAINT "project_health_snapshots_raw_verdict" CHECK (raw_verdict in ('healthy', 'attention', 'at_risk', 'critical', 'insufficient_data'))
);
--> statement-breakpoint
ALTER TABLE "project_health_snapshots" ADD CONSTRAINT "project_health_snapshots_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_health_snapshots_day_key" ON "project_health_snapshots" USING btree ("project_id","date");--> statement-breakpoint
CREATE INDEX "project_health_snapshots_workspace_project_idx" ON "project_health_snapshots" USING btree ("workspace_id","project_id","date");