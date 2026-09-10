import { clearRateLimits } from "./rate-limits";

/** Counters left over from the previous run would outlive it: the window is a minute. */
export default async function globalSetup(): Promise<void> {
  await clearRateLimits();
}
