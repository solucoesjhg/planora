CREATE TABLE "rate_limits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limits_key_unique" UNIQUE("key")
);
