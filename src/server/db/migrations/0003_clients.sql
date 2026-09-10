CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_workspace_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "clients_workspace_name" UNIQUE("workspace_id","name")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clients_workspace_idx" ON "clients" USING btree ("workspace_id","name");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_fk" FOREIGN KEY ("workspace_id","client_id") REFERENCES "public"."clients"("workspace_id","id") ON DELETE set null ON UPDATE no action;