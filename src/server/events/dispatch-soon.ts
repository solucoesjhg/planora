import "server-only";

import { after } from "next/server";
import { getDatabase } from "@/server/db/client";
import { dispatchPending } from "./dispatcher";

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
      await dispatchPending(getDatabase());
    } catch (error) {
      console.error("outbox dispatch failed", error);
    }
  });
}
