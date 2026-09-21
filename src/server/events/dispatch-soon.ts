import "server-only";

import { after } from "next/server";
import { getSystemDatabase } from "@/server/db/client";
import { senderFromEnvironment } from "@/server/email/sender";
import { deliverPendingEmails } from "@/server/modules/notifications/service";
import { drainOutbox } from "./dispatcher";

/**
 * Drain the outbox once this response has been sent.
 *
 * The outbox exists so a mutation and its event commit together; something
 * still has to read the rows. §7 Phase 9 gives that a clock, but a queue with
 * no consumer until then means the activity feed Phase 8 renders would be
 * empty, and the events pile up: sixteen of them had, with no activity row to
 * show for it.
 *
 * `after` runs the work when the response is already on its way, so the person
 * who moved the card does not wait for it. Failures are logged and left
 * pending — the dispatcher is idempotent, so the scheduler retries them.
 */
export function dispatchSoon(): void {
  after(async () => {
    try {
      // The outbox is drained across every workspace by design, and this
      // runs after a request that had a workspace — so it is the system lane,
      // not the request's. Missing that would empty the activity feed and the
      // whole notification inbox the day the barrier went on, silently: the
      // `catch` below is the only thing that would ever have seen it.
      const database = getSystemDatabase();
      await drainOutbox(database);
      // What the dispatch just decided to send leaves now, not on the next
      // tick of a clock that may be an hour away on a small plan.
      const baseUrl = process.env["BETTER_AUTH_URL"] ?? "http://localhost:3000";
      await deliverPendingEmails(database, senderFromEnvironment(), baseUrl);
    } catch (error) {
      console.error("outbox dispatch failed", error);
    }
  });
}
