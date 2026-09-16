import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDatabase } from "@/server/db/client";
import { senderFromEnvironment } from "@/server/email/sender";
import { drainOutbox } from "@/server/events/dispatcher";
import { runRoutines } from "@/server/modules/automations/routines";
import { deliverPendingEmails, sendDigests } from "@/server/modules/notifications/service";

/**
 * The clock's door (DEVELOPMENT_PLAN.md §7 Phase 9). Whoever ticks — pg_cron
 * through pg_net on Supabase, a Vercel Cron, a curl in a terminal — calls this
 * with the shared secret, and one tick does the whole round: the routines,
 * the outbox (the retry path for what `after()` failed to drain), the emails
 * that have not left, and the digests that are due.
 *
 * Without `CRON_SECRET` the route does not exist: an open scheduler endpoint
 * is a way to make somebody else's server do work on demand.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  return tick(request);
}

export async function POST(request: Request): Promise<Response> {
  return tick(request);
}

async function tick(request: Request): Promise<Response> {
  const secret = process.env["CRON_SECRET"];
  if (!secret) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const presented = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!sameSecret(presented, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const database = getDatabase();
  const sender = senderFromEnvironment();
  const baseUrl = process.env["BETTER_AUTH_URL"] ?? new URL(request.url).origin;

  const routines = await runRoutines(database, now);
  const dispatched = await drainOutbox(database);
  const emails = await deliverPendingEmails(database, sender, baseUrl);
  const digests = await sendDigests(database, sender, baseUrl, now);

  return NextResponse.json(
    { ok: true, at: now.toISOString(), routines, dispatched, emails, digests },
    { headers: { "cache-control": "no-store" } },
  );
}

function sameSecret(presented: string, secret: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
