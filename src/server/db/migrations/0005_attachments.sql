CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid,
	"bucket" text NOT NULL,
	"path" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" bigint DEFAULT 0 NOT NULL,
	"checksum" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stored_at" timestamp with time zone,
	CONSTRAINT "attachments_workspace_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "attachments_status" CHECK (status in ('pending', 'stored'))
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_task_fk" FOREIGN KEY ("workspace_id","task_id") REFERENCES "public"."tasks"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_path_key" ON "attachments" USING btree ("bucket","path");--> statement-breakpoint
CREATE INDEX "attachments_workspace_task_idx" ON "attachments" USING btree ("workspace_id","task_id","created_at");--> statement-breakpoint
CREATE INDEX "attachments_workspace_project_idx" ON "attachments" USING btree ("workspace_id","project_id","created_at");