import { NextResponse } from "next/server";
import { currentSession } from "@/server/auth/dal";
import { can } from "@/server/auth/tenant";
import { withTenant, withUser } from "@/server/db/client";
import { loadWorkspaceExport, toCsv, toJson } from "@/server/modules/workspaces/export";
import { resolveTenantContext } from "@/server/modules/workspaces/repository";
import { cookies } from "next/headers";
import { WORKSPACE_COOKIE } from "@/server/modules/workspaces/cookie";

/**
 * `GET /api/export?format=json|csv` — the workspace, as a file
 * (DEVELOPMENT_PLAN.md §7 Phase 8). A download, so a route handler rather than
 * a Server Action; the session and the workspace are resolved the way every
 * other route resolves them, and managing projects is the permission it takes:
 * an export is every project at once.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const chosen = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  // Which workspace this is cannot be part of the question (ADR 0002), so the
  // lookup runs on the bootstrap lane and the export itself on the tenant one.
  const tenant = await withUser(session.userId, (tx) =>
    resolveTenantContext(tx, session.userId, chosen),
  );
  if (!tenant) return NextResponse.json({ error: "not-found" }, { status: 404 });
  if (!can(tenant, "manage-project")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "json";
  const data = await withTenant(tenant, (tx) => loadWorkspaceExport(tx, tenant));
  if (!data) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const stamp = data.exportedAt.slice(0, 10);
  const slug = data.workspace.name
    .normalize("NFKD")
    .replaceAll(/[^\w-]+/g, "-")
    .replaceAll(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  const filename = `planora-${slug || "workspace"}-${stamp}.${format}`;

  return new Response(format === "csv" ? toCsv(data) : toJson(data), {
    headers: {
      "content-type":
        format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
