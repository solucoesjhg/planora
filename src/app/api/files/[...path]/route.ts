import { NextResponse } from "next/server";
import { authSecret } from "@/server/auth/secret";
import { MAX_ATTACHMENT_BYTES } from "@/server/modules/tasks/attachments";
import { readLocalObject, verifyLocalLink, writeLocalObject } from "@/server/storage/local";
import { getStorage } from "@/server/storage";

/**
 * The bytes, in development (DEVELOPMENT_PLAN.md §5.1).
 *
 * In production the browser talks to Supabase Storage directly and this route
 * is never reached. Locally it stands in for it: the same two operations, gated
 * by the same kind of signature — issued by `storage/local.ts`, checked here.
 *
 * There is deliberately no session check. A signature is the credential, the
 * way it is with the real bucket; the workspace check happened before the URL
 * existed, in `linkFor`.
 */

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const guard = await authorize(request, context, "read");
  if (guard.refusal) return guard.refusal;

  const object = await readLocalObject(guard.path);
  if (!object) return NextResponse.json({ error: "not-found" }, { status: 404 });

  return new Response(new Uint8Array(object.bytes), {
    headers: {
      "content-type": object.mime,
      "content-length": String(object.bytes.byteLength),
      // Private and short: the URL it came from expires anyway.
      "cache-control": "private, max-age=60",
      "content-disposition": `inline; filename="${fileNameOf(guard.path)}"`,
      "x-content-type-options": "nosniff",
    },
  });
}

export async function PUT(request: Request, context: Context): Promise<Response> {
  const guard = await authorize(request, context, "upload");
  if (guard.refusal) return guard.refusal;

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json({ error: "too-large" }, { status: 413 });
  }

  await writeLocalObject(
    guard.path,
    bytes,
    request.headers.get("content-type") ?? "application/octet-stream",
  );

  return NextResponse.json({ ok: true });
}

async function authorize(
  request: Request,
  context: Context,
  intent: "read" | "upload",
): Promise<{ path: string; refusal: Response | null }> {
  const { path: segments } = await context.params;
  const path = segments.map(decodeURIComponent).join("/");

  if (getStorage().name !== "local") {
    // Production signs its URLs at the bucket; this route would be a second,
    // weaker door onto the same objects.
    return { path, refusal: NextResponse.json({ error: "not-found" }, { status: 404 }) };
  }

  const url = new URL(request.url);
  const expires = Number(url.searchParams.get("exp"));
  const signature = url.searchParams.get("sig") ?? "";
  const valid = await verifyLocalLink(intent, path, expires, signature, authSecret());
  if (!valid) {
    return { path, refusal: NextResponse.json({ error: "expired" }, { status: 403 }) };
  }

  return { path, refusal: null };
}

function fileNameOf(path: string): string {
  return (path.split("/").at(-1) ?? "arquivo").replaceAll('"', "");
}
