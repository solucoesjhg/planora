import { NextResponse } from "next/server";
import { isRefused } from "@/lib/result";
import { currentSession } from "@/server/auth/dal";
import { getDatabase } from "@/server/db/client";
import { linkFor } from "@/server/modules/tasks/attachments";
import { resolveTenantContext } from "@/server/modules/workspaces/repository";
import { getStorage } from "@/server/storage";

/**
 * An attachment's stable address (DEVELOPMENT_PLAN.md §7 Phase 7).
 *
 * A signed URL expires, which is right for delivering a file and wrong for
 * referring to one: an image dropped into a task body has to still load next
 * year. So the body holds this address, and this address signs a fresh URL on
 * every request — after the workspace check, which is the check the private
 * bucket exists for.
 *
 * The redirect is never cached: what it points at stops working in minutes.
 */

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ attachmentId: string }> },
): Promise<Response> {
  const { attachmentId } = await context.params;

  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const database = getDatabase();
  const tenant = await resolveTenantContext(database, session.userId);
  if (!tenant) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const link = await linkFor(database, tenant, getStorage(), attachmentId);
  if (isRefused(link)) {
    // The store not answering is not "no such file". The row was found first,
    // in this workspace, so a 503 here teaches a stranger nothing.
    if (link.reason === "storage-unavailable") {
      return NextResponse.json({ error: "storage-unavailable" }, { status: 503 });
    }
    // A file in another workspace is not found, never forbidden: a stranger
    // should not learn that it exists.
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  // Supabase signs an absolute URL; the filesystem adapter may sign a relative
  // one. This request's own URL is the base either way.
  return NextResponse.redirect(new URL(link.value.url, request.url), {
    status: 302,
    headers: { "cache-control": "no-store" },
  });
}
