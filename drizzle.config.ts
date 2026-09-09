import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./src/server/db/migrations",
  strict: true,
  verbose: true,
  dbCredentials: {
    // Migrations run as the owner; the application connects as a role that
    // cannot bypass RLS once Phase 10 turns it on.
    url:
      process.env.MIGRATION_DATABASE_URL ??
      process.env.DATABASE_URL ??
      "postgresql://postgres:postgres@127.0.0.1:5432/postgres",
  },
});
