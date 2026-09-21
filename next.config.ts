import type { NextConfig } from "next";
import { securityHeaders, storageOriginOf } from "./src/lib/security-headers";

/**
 * The security headers are served from here, not from `vercel.json`.
 *
 * Vercel applies that file at the edge, which means `pnpm start` — the command
 * the E2E suite boots — served none of them, and no test could tell whether a
 * header had been dropped. `headers()` runs in `next dev`, in `next start` and
 * in the Vercel build alike, so `vercel.json` has given up its copy: one
 * source, one answer, and the deployed app and the tested app agree.
 *
 * The values are computed at build time, which is the one thing to know when
 * deploying: `SUPABASE_URL` must be present in the *build* environment, not
 * only at runtime, or the policy will be missing the bucket and every task
 * image will be refused. `src/lib/security-headers.ts` explains the policy
 * itself, including why it carries no nonce.
 */
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders({
          development: process.env.NODE_ENV === "development",
          storageOrigin: storageOriginOf(process.env.SUPABASE_URL),
        }),
      },
    ];
  },
};

export default nextConfig;
